import type { TaskCoordinatorRepository } from "../../chat-runtime/src/task-coordinator.js";
import type { CompletedRequestResult } from "../../request-result/src/index.js";
import type { InteractionProtocol } from "./interaction-types.js";
import type { JsonValue, TaskBinding } from "./types.js";
import { InteractionPersistenceRepository } from "./interaction-repository.js";

/**
 * Adapts the protocol-neutral principal/thread model to the already hardened
 * single-SDAR coordinator contract. The legacy field names are intentionally
 * contained here and never become AG-UI authorization identifiers.
 */
export class InteractionTaskCoordinatorRepository implements TaskCoordinatorRepository {
  constructor(
    private readonly repository: InteractionPersistenceRepository,
    private readonly protocol: InteractionProtocol,
  ) {}

  async claimRequest(input: {
    readonly idempotencyKey: string;
    readonly userId: string;
    readonly openWebUiChatId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }) {
    const threadId = await this.threadId(input.openWebUiChatId, input.userId);
    const claim = await this.repository.claimRequest({
      protocol: this.protocol,
      externalRequestId: input.idempotencyKey,
      principalId: input.userId,
      threadId,
      requestHash: input.requestHash,
      leaseOwner: input.leaseOwner,
      ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
    });
    if (claim.outcome !== "replay") return claim;
    return { outcome: "replay" as const, result: claim.result };
  }

  completeRequest(input: {
    readonly idempotencyKey: string;
    readonly userId: string;
    readonly openWebUiChatId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
    readonly result: CompletedRequestResult;
  }): Promise<void> {
    return this.completeRequestForThread(input);
  }

  private async completeRequestForThread(input: {
    readonly idempotencyKey: string;
    readonly userId: string;
    readonly openWebUiChatId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
    readonly result: CompletedRequestResult;
  }): Promise<void> {
    const threadId = await this.threadId(input.openWebUiChatId, input.userId);
    await this.repository.completeCoordinatorRequest({
      protocol: this.protocol,
      externalRequestId: input.idempotencyKey,
      principalId: input.userId,
      threadId,
      requestHash: input.requestHash,
      leaseOwner: input.leaseOwner,
      result: input.result,
    });
  }

  abandonRequestClaim(input: {
    readonly idempotencyKey: string;
    readonly userId: string;
    readonly openWebUiChatId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    return this.abandonRequestForThread(input);
  }

  private async abandonRequestForThread(input: {
    readonly idempotencyKey: string;
    readonly userId: string;
    readonly openWebUiChatId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    const threadId = await this.threadId(input.openWebUiChatId, input.userId);
    await this.repository.abandonCoordinatorRequest({
      protocol: this.protocol,
      externalRequestId: input.idempotencyKey,
      principalId: input.userId,
      threadId,
      requestHash: input.requestHash,
      leaseOwner: input.leaseOwner,
    });
  }

  claimTaskSubmissionSlot(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<boolean> {
    return this.claimSubmissionForThread(input);
  }

  private async claimSubmissionForThread(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<boolean> {
    const threadId = await this.threadId(input.chatId, input.userId);
    return this.repository.claimTaskSubmissionSlot({
      threadId,
      principalId: input.userId,
      leaseOwner: input.leaseOwner,
      ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
    });
  }

  claimTaskInteractionSlot(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly bindingId: string;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<boolean> {
    return this.claimInteractionForThread(input);
  }

  private async claimInteractionForThread(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly bindingId: string;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<boolean> {
    const threadId = await this.threadId(input.chatId, input.userId);
    return this.repository.claimTaskInteractionSlot({
      threadId,
      principalId: input.userId,
      bindingId: input.bindingId,
      leaseOwner: input.leaseOwner,
      ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
    });
  }

  releaseTaskInteractionSlot(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly bindingId: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    return this.releaseInteractionForThread(input);
  }

  private async releaseInteractionForThread(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly bindingId: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    const threadId = await this.threadId(input.chatId, input.userId);
    await this.repository.releaseTaskInteractionSlot({
      threadId,
      principalId: input.userId,
      bindingId: input.bindingId,
      leaseOwner: input.leaseOwner,
    });
  }

  releaseTaskSubmissionSlot(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    return this.releaseSubmissionForThread(input);
  }

  private async releaseSubmissionForThread(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    const threadId = await this.threadId(input.chatId, input.userId);
    await this.repository.releaseTaskSubmissionSlot({
      threadId,
      principalId: input.userId,
      leaseOwner: input.leaseOwner,
    });
  }

  listActiveTasksForChat(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly limit?: number;
  }): Promise<readonly TaskBinding[]> {
    return this.listTasksForThread(input);
  }

  private async listTasksForThread(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly limit?: number;
  }): Promise<readonly TaskBinding[]> {
    const threadId = await this.threadId(input.chatId, input.userId);
    return this.repository.listActiveTasksForChat({
      threadId,
      principalId: input.userId,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  }

  setFocusedTask(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly bindingId: string;
  }): Promise<void> {
    return this.focusTaskForThread(input);
  }

  private async focusTaskForThread(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly bindingId: string;
  }): Promise<void> {
    const threadId = await this.threadId(input.chatId, input.userId);
    await this.repository.setFocusedTask({
      threadId,
      principalId: input.userId,
      bindingId: input.bindingId,
    });
  }

  findAuthorizedTask(input: {
    readonly openWebUiChatId: string;
    readonly userId: string;
    readonly sdarTaskId: string;
  }): Promise<TaskBinding | undefined> {
    return this.findTaskForThread(input);
  }

  private async findTaskForThread(input: {
    readonly openWebUiChatId: string;
    readonly userId: string;
    readonly sdarTaskId: string;
  }): Promise<TaskBinding | undefined> {
    const threadId = await this.threadId(input.openWebUiChatId, input.userId);
    return this.repository.findAuthorizedTask({
      threadId,
      principalId: input.userId,
      sdarTaskId: input.sdarTaskId,
    });
  }

  createTaskBinding(input: {
    readonly openWebUiChatId: string;
    readonly userId: string;
    readonly sdarTaskId: string;
    readonly sdarContextId: string;
    readonly status: string;
  }): Promise<TaskBinding> {
    return this.createTaskForThread(input);
  }

  private async createTaskForThread(input: {
    readonly openWebUiChatId: string;
    readonly userId: string;
    readonly sdarTaskId: string;
    readonly sdarContextId: string;
    readonly status: string;
  }): Promise<TaskBinding> {
    const threadId = await this.threadId(input.openWebUiChatId, input.userId);
    return this.repository.createTaskBinding({
      threadId,
      principalId: input.userId,
      sdarTaskId: input.sdarTaskId,
      sdarContextId: input.sdarContextId,
      status: input.status,
    });
  }

  updateTaskBinding(input: {
    readonly bindingId: string;
    readonly expectedVersion: number;
    readonly status: string;
    readonly pendingInput?: JsonValue;
    readonly lastStatusTimestamp?: string;
    readonly lastEventHash?: string;
    readonly terminal: boolean;
  }): Promise<TaskBinding> {
    return this.repository.updateTaskBinding(input);
  }

  recordEvent(input: {
    readonly taskId: string;
    readonly eventKind: string;
    readonly eventHash: string;
    readonly status: string;
    readonly summary: JsonValue;
    readonly occurredAt?: string;
  }): Promise<boolean> {
    return this.repository.recordEvent(input);
  }

  private threadId(threadId: string, principalId: string): Promise<string> {
    return this.protocol === "ag_ui"
      ? Promise.resolve(threadId)
      : this.repository.resolveInternalThreadId({
          clientType: "openwebui",
          externalThreadId: threadId,
          principalId,
        });
  }
}
