import type { TaskCoordinatorRepository } from "../../chat-runtime/src/task-coordinator.js";
import type { IdempotencyClaim, JsonValue, TaskBinding } from "./types.js";
import { InteractionPersistenceRepository } from "./interaction-repository.js";

/**
 * Adapts the protocol-neutral principal/thread model to the already hardened
 * single-SDAR coordinator contract. The legacy field names are intentionally
 * contained here and never become AG-UI authorization identifiers.
 */
export class AgUiTaskCoordinatorRepository implements TaskCoordinatorRepository {
  constructor(private readonly repository: InteractionPersistenceRepository) {}

  async claimRequest(input: {
    readonly idempotencyKey: string;
    readonly userId: string;
    readonly openWebUiChatId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<IdempotencyClaim> {
    const claim = await this.repository.claimRequest({
      protocol: "ag_ui",
      externalRequestId: input.idempotencyKey,
      principalId: input.userId,
      threadId: input.openWebUiChatId,
      requestHash: input.requestHash,
      leaseOwner: input.leaseOwner,
      ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
    });
    if (claim.outcome !== "replay") return claim;
    return claim.resultTaskId === undefined
      ? { outcome: "in_progress" }
      : { outcome: "replay", resultTaskId: claim.resultTaskId };
  }

  completeRequest(input: {
    readonly idempotencyKey: string;
    readonly userId: string;
    readonly openWebUiChatId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
    readonly resultTaskId: string;
  }): Promise<void> {
    return this.repository.completeCoordinatorRequest({
      protocol: "ag_ui",
      externalRequestId: input.idempotencyKey,
      principalId: input.userId,
      threadId: input.openWebUiChatId,
      requestHash: input.requestHash,
      leaseOwner: input.leaseOwner,
      resultTaskId: input.resultTaskId,
    });
  }

  abandonRequestClaim(input: {
    readonly idempotencyKey: string;
    readonly userId: string;
    readonly openWebUiChatId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    return this.repository.abandonCoordinatorRequest({
      protocol: "ag_ui",
      externalRequestId: input.idempotencyKey,
      principalId: input.userId,
      threadId: input.openWebUiChatId,
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
    return this.repository.claimTaskSubmissionSlot({
      threadId: input.chatId,
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
    return this.repository.claimTaskInteractionSlot({
      threadId: input.chatId,
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
    return this.repository.releaseTaskInteractionSlot({
      threadId: input.chatId,
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
    return this.repository.releaseTaskSubmissionSlot({
      threadId: input.chatId,
      principalId: input.userId,
      leaseOwner: input.leaseOwner,
    });
  }

  listActiveTasksForChat(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly limit?: number;
  }): Promise<readonly TaskBinding[]> {
    return this.repository.listActiveTasksForChat({
      threadId: input.chatId,
      principalId: input.userId,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  }

  setFocusedTask(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly bindingId: string;
  }): Promise<void> {
    return this.repository.setFocusedTask({
      threadId: input.chatId,
      principalId: input.userId,
      bindingId: input.bindingId,
    });
  }

  findAuthorizedTask(input: {
    readonly openWebUiChatId: string;
    readonly userId: string;
    readonly sdarTaskId: string;
  }): Promise<TaskBinding | undefined> {
    return this.repository.findAuthorizedTask({
      threadId: input.openWebUiChatId,
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
    return this.repository.createTaskBinding({
      threadId: input.openWebUiChatId,
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
}
