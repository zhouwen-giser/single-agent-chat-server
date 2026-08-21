import { randomUUID } from "node:crypto";

import type {
  NormalizedArtifact,
  NormalizedMessage,
  NormalizedStreamEvent,
  NormalizedTask,
  NormalizedTaskState,
  SdarA2aClient,
  SdarFollowUpAction,
} from "../../sdar-a2a-adapter/src/index.js";
import {
  ChatPersistenceRepository,
  hashJson,
  PersistenceConflictError,
  type JsonValue,
  type TaskBinding,
} from "../../persistence/src/index.js";
import {
  boundedPublishedJson,
  safePublishedText,
} from "./safe-published-content.js";

const terminalStates = new Set<NormalizedTaskState>([
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "REJECTED",
]);

export interface TaskTurnContext {
  readonly userText: string;
  readonly userId: string;
  readonly chatId: string;
  readonly userMessageId: string;
}

export interface FollowUpTurnContext extends TaskTurnContext {
  readonly action: SdarFollowUpAction;
  readonly data?: JsonValue;
}

export type TaskCoordinatorObservation =
  | {
      readonly source: "stream";
      readonly value: NormalizedStreamEvent;
      readonly fragments: readonly string[];
    }
  | {
      readonly source: "task";
      readonly value: NormalizedTask;
      readonly fragments: readonly string[];
    };

export type TaskCoordinatorObserver = (
  observation: TaskCoordinatorObservation,
) => void;

export type TaskCoordinatorRepository = Pick<
  ChatPersistenceRepository,
  | "claimRequest"
  | "completeRequest"
  | "abandonRequestClaim"
  | "claimTaskSubmissionSlot"
  | "claimTaskInteractionSlot"
  | "releaseTaskSubmissionSlot"
  | "releaseTaskInteractionSlot"
  | "listActiveTasksForChat"
  | "setFocusedTask"
  | "findAuthorizedTask"
  | "createTaskBinding"
  | "updateTaskBinding"
  | "recordEvent"
>;

export interface TaskCoordinatorOptions {
  readonly repository: TaskCoordinatorRepository;
  readonly getClient: () => Promise<SdarA2aClient>;
  readonly streamBudgetMs?: number;
  readonly pollingBudgetMs?: number;
  readonly pollingIntervalMs?: number;
  readonly now?: () => number;
  readonly delay?: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
}

export class SdarTaskCoordinator {
  private readonly streamBudgetMs: number;
  private readonly pollingBudgetMs: number;
  private readonly pollingIntervalMs: number;
  private readonly now: () => number;
  private readonly delay: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  constructor(private readonly options: TaskCoordinatorOptions) {
    this.streamBudgetMs = options.streamBudgetMs ?? 30_000;
    this.pollingBudgetMs = options.pollingBudgetMs ?? 5_000;
    this.pollingIntervalMs = options.pollingIntervalMs ?? 1_000;
    this.now = options.now ?? Date.now;
    this.delay = options.delay ?? defaultDelay;
  }

  async *submit(
    input: TaskTurnContext,
    callerSignal?: AbortSignal,
    observer?: TaskCoordinatorObserver,
  ): AsyncGenerator<string> {
    const requestHash = hashJson({
      chatId: input.chatId,
      userId: input.userId,
      userMessageId: input.userMessageId,
      text: input.userText,
    });
    const leaseOwner = randomUUID();
    const claim = await this.options.repository.claimRequest({
      idempotencyKey: input.userMessageId,
      userId: input.userId,
      openWebUiChatId: input.chatId,
      requestHash,
      leaseOwner,
    });
    if (claim.outcome === "conflict") {
      yield "The same Open WebUI message ID was reused with different content; no SDAR Task was submitted.";
      return;
    }
    if (claim.outcome === "in_progress") {
      yield "This message is already being submitted. Ask for task status shortly.";
      return;
    }

    if (claim.outcome === "replay") {
      const client = await this.options.getClient();
      const binding = await this.options.repository.findAuthorizedTask({
        openWebUiChatId: input.chatId,
        userId: input.userId,
        sdarTaskId: claim.resultTaskId,
      });
      if (binding === undefined) {
        throw new Error("Idempotency replay has no authorized Task binding");
      }
      const task = await client.getTask(binding.sdarTaskId, {
        signal: callerSignal,
      });
      const observed = await this.observeTask(task, binding, true);
      if (observed.publishable) {
        observer?.({
          source: "task",
          value: task,
          fragments: observed.fragments,
        });
      }
      for (const fragment of observed.fragments) yield fragment;
      return;
    }

    const submissionSlot =
      await this.options.repository.claimTaskSubmissionSlot({
        chatId: input.chatId,
        userId: input.userId,
        leaseOwner,
      });
    if (!submissionSlot) {
      yield "Another message is already submitting a Task for this chat; no duplicate SDAR Task was created.";
      return;
    }
    try {
      const client = await this.options.getClient();
      let binding: TaskBinding | undefined;
      let latestState: NormalizedTaskState | undefined;
      let sawMessage = false;
      let completedClaim = false;
      const streamController = new AbortController();
      const streamTimer = setTimeout(
        () => streamController.abort(new Error("chat stream budget elapsed")),
        this.streamBudgetMs,
      );
      const signal =
        callerSignal === undefined
          ? streamController.signal
          : AbortSignal.any([callerSignal, streamController.signal]);
      try {
        for await (const event of client.submitTaskStream(
          {
            messageId: input.userMessageId,
            text: input.userText,
            userId: input.userId,
          },
          { signal },
        )) {
          const observed = await this.observeEvent(event, input, binding);
          binding = observed.binding ?? binding;
          latestState = eventState(event) ?? latestState;
          sawMessage ||= event.kind === "message";
          if (binding !== undefined && !completedClaim) {
            await this.options.repository.completeRequest({
              idempotencyKey: input.userMessageId,
              userId: input.userId,
              openWebUiChatId: input.chatId,
              requestHash,
              leaseOwner,
              resultTaskId: binding.sdarTaskId,
            });
            completedClaim = true;
          }
          if (
            binding !== undefined &&
            event.kind === "status" &&
            latestState !== undefined &&
            isResponseBoundary(latestState)
          ) {
            const task = await client.getTask(binding.sdarTaskId, { signal });
            assertSameTask(task, binding);
            const enriched = await this.observeTask(task, binding, true);
            binding = enriched.binding;
            if (enriched.publishable) {
              observer?.({
                source: "task",
                value: task,
                fragments: enriched.fragments,
              });
            }
            const boundaryFragments =
              enriched.fragments.length > 0
                ? enriched.fragments
                : observed.fragments;
            for (const fragment of boundaryFragments) yield fragment;
            return;
          }
          if (observed.publishable) {
            observer?.({
              source: "stream",
              value: event,
              fragments: observed.fragments,
            });
          }
          for (const fragment of observed.fragments) yield fragment;
          if (latestState !== undefined && isResponseBoundary(latestState))
            return;
        }
      } catch (error) {
        if (!signal.aborted) throw error;
      } finally {
        clearTimeout(streamTimer);
      }

      if (binding === undefined) {
        if (callerSignal?.aborted === true) return;
        if (sawMessage) return;
        throw new Error("SDAR stream ended before publishing a Task binding");
      }
      if (latestState !== undefined && isResponseBoundary(latestState)) return;

      yield* this.pollTask(client, binding, callerSignal, observer);
    } finally {
      await this.options.repository.releaseTaskSubmissionSlot({
        chatId: input.chatId,
        userId: input.userId,
        leaseOwner,
      });
    }
  }

  async *followUp(
    input: FollowUpTurnContext,
    callerSignal?: AbortSignal,
    observer?: TaskCoordinatorObserver,
  ): AsyncGenerator<string> {
    const bindings = await this.options.repository.listActiveTasksForChat({
      chatId: input.chatId,
      userId: input.userId,
    });
    if (bindings.length === 0) {
      yield "There is no active SDAR Task for this user and chat.";
      return;
    }
    if (bindings.length !== 1) {
      yield renderAmbiguousTaskList(bindings);
      return;
    }
    const binding = bindings[0];
    if (binding === undefined) throw new Error("Active Task list changed");
    await this.options.repository.setFocusedTask({
      chatId: input.chatId,
      userId: input.userId,
      bindingId: binding.bindingId,
    });
    const pending = pendingDetails(binding.pendingInput);
    if (
      !isFollowUpAllowed(input.action, binding.status, pending.internalPhase)
    ) {
      yield wrongPhaseMessage(binding.status, pending.internalPhase);
      return;
    }
    if (input.action !== "provide_input" && input.data !== undefined) {
      yield "Structured data is allowed only for provide_input; no Follow-up was sent.";
      return;
    }

    const requestHash = hashJson({
      chatId: input.chatId,
      userId: input.userId,
      userMessageId: input.userMessageId,
      taskId: binding.sdarTaskId,
      action: input.action,
      text: input.userText,
      ...(input.data === undefined ? {} : { data: input.data }),
    });
    const leaseOwner = randomUUID();
    const claim = await this.options.repository.claimRequest({
      idempotencyKey: input.userMessageId,
      userId: input.userId,
      openWebUiChatId: input.chatId,
      requestHash,
      leaseOwner,
    });
    if (claim.outcome === "conflict") {
      yield "The same Open WebUI message ID was reused with different Follow-up content; nothing was sent.";
      return;
    }
    if (claim.outcome === "in_progress") {
      yield "This Follow-up is already being processed. Ask for task status shortly.";
      return;
    }

    const client = await this.options.getClient();
    if (claim.outcome === "replay") {
      const task = await client.getTask(binding.sdarTaskId, {
        signal: callerSignal,
      });
      const observed = await this.observeTask(task, binding, true);
      if (observed.publishable) {
        observer?.({
          source: "task",
          value: task,
          fragments: observed.fragments,
        });
      }
      for (const fragment of observed.fragments) yield fragment;
      return;
    }

    const interactionSlot =
      await this.options.repository.claimTaskInteractionSlot({
        chatId: input.chatId,
        userId: input.userId,
        bindingId: binding.bindingId,
        leaseOwner,
      });
    if (!interactionSlot) {
      await this.options.repository.abandonRequestClaim({
        idempotencyKey: input.userMessageId,
        userId: input.userId,
        openWebUiChatId: input.chatId,
        requestHash,
        leaseOwner,
      });
      yield "Another Task interaction is already in progress for this chat; no duplicate Follow-up was sent.";
      return;
    }
    try {
      const result = await client.sendFollowUp(
        {
          messageId: input.userMessageId,
          taskId: binding.sdarTaskId,
          contextId: binding.sdarContextId,
          action: input.action,
          text: input.userText,
          userId: input.userId,
          ...(pending.inputRequestId === undefined
            ? {}
            : { inputRequestId: pending.inputRequestId }),
          ...(input.data === undefined ? {} : { data: input.data }),
        },
        { signal: callerSignal },
      );
      await this.options.repository.completeRequest({
        idempotencyKey: input.userMessageId,
        userId: input.userId,
        openWebUiChatId: input.chatId,
        requestHash,
        leaseOwner,
        resultTaskId: binding.sdarTaskId,
      });
      if (result.kind === "message") {
        const fragments = renderMessage(result.message);
        if (fragments.length > 0) {
          observer?.({ source: "stream", value: result, fragments });
        }
        for (const fragment of fragments) yield fragment;
        return;
      }
      assertSameTask(result.task, binding);
      const observed = await this.observeTask(result.task, binding, true);
      if (observed.publishable) {
        observer?.({
          source: "task",
          value: result.task,
          fragments: observed.fragments,
        });
      }
      for (const fragment of observed.fragments) yield fragment;
    } finally {
      await this.options.repository.releaseTaskInteractionSlot({
        chatId: input.chatId,
        userId: input.userId,
        bindingId: binding.bindingId,
        leaseOwner,
      });
    }
  }

  async *cancel(
    input: TaskTurnContext,
    callerSignal?: AbortSignal,
    observer?: TaskCoordinatorObserver,
  ): AsyncGenerator<string> {
    const bindings = await this.options.repository.listActiveTasksForChat({
      chatId: input.chatId,
      userId: input.userId,
    });
    if (bindings.length === 0) {
      yield "There is no active SDAR Task for this user and chat.";
      return;
    }
    if (bindings.length !== 1) {
      yield renderAmbiguousTaskList(bindings);
      return;
    }
    const binding = bindings[0];
    if (binding === undefined) throw new Error("Active Task list changed");
    await this.options.repository.setFocusedTask({
      chatId: input.chatId,
      userId: input.userId,
      bindingId: binding.bindingId,
    });
    const requestHash = hashJson({
      chatId: input.chatId,
      userId: input.userId,
      userMessageId: input.userMessageId,
      taskId: binding.sdarTaskId,
      operation: "cancelTask",
    });
    const leaseOwner = randomUUID();
    const claim = await this.options.repository.claimRequest({
      idempotencyKey: input.userMessageId,
      userId: input.userId,
      openWebUiChatId: input.chatId,
      requestHash,
      leaseOwner,
    });
    if (claim.outcome === "conflict") {
      yield "The same Open WebUI message ID was reused with different cancellation content; no cancellation was sent.";
      return;
    }
    if (claim.outcome === "in_progress") {
      yield "Cancellation is already being processed. Ask for task status shortly.";
      return;
    }
    const client = await this.options.getClient();
    let task: NormalizedTask;
    if (claim.outcome === "replay") {
      task = await client.getTask(binding.sdarTaskId, {
        signal: callerSignal,
      });
    } else {
      const interactionSlot =
        await this.options.repository.claimTaskInteractionSlot({
          chatId: input.chatId,
          userId: input.userId,
          bindingId: binding.bindingId,
          leaseOwner,
        });
      if (!interactionSlot) {
        await this.options.repository.abandonRequestClaim({
          idempotencyKey: input.userMessageId,
          userId: input.userId,
          openWebUiChatId: input.chatId,
          requestHash,
          leaseOwner,
        });
        yield "Another Task interaction is already in progress for this chat; no duplicate cancellation was sent.";
        return;
      }
      try {
        task = await client.cancelTask(binding.sdarTaskId, {
          signal: callerSignal,
        });
        await this.options.repository.completeRequest({
          idempotencyKey: input.userMessageId,
          userId: input.userId,
          openWebUiChatId: input.chatId,
          requestHash,
          leaseOwner,
          resultTaskId: binding.sdarTaskId,
        });
      } finally {
        await this.options.repository.releaseTaskInteractionSlot({
          chatId: input.chatId,
          userId: input.userId,
          bindingId: binding.bindingId,
          leaseOwner,
        });
      }
    }
    assertSameTask(task, binding);
    const observed = await this.observeTask(task, binding, true);
    if (observed.publishable) {
      observer?.({
        source: "task",
        value: task,
        fragments: observed.fragments,
      });
    }
    for (const fragment of observed.fragments) yield fragment;
    yield "This is the top-level SDAR Task state returned by cancelTask; it does not prove that every lower-level Provider has stopped.";
  }
  async *statusForTask(
    input: {
      readonly chatId: string;
      readonly userId: string;
      readonly taskId: string;
    },
    callerSignal?: AbortSignal,
    observer?: TaskCoordinatorObserver,
  ): AsyncGenerator<string> {
    const binding = await this.options.repository.findAuthorizedTask({
      openWebUiChatId: input.chatId,
      userId: input.userId,
      sdarTaskId: input.taskId,
    });
    if (binding === undefined) {
      yield "The requested SDAR Task is not bound to this user and chat.";
      return;
    }
    await this.options.repository.setFocusedTask({
      chatId: input.chatId,
      userId: input.userId,
      bindingId: binding.bindingId,
    });
    const client = await this.options.getClient();
    const task = await client.getTask(binding.sdarTaskId, {
      signal: callerSignal,
    });
    assertSameTask(task, binding);
    const observed = await this.observeTask(task, binding, true);
    if (observed.publishable) {
      observer?.({
        source: "task",
        value: task,
        fragments: observed.fragments,
      });
    }
    for (const fragment of observed.fragments) yield fragment;
  }
  async *status(
    input: Pick<TaskTurnContext, "chatId" | "userId">,
    callerSignal?: AbortSignal,
    observer?: TaskCoordinatorObserver,
  ): AsyncGenerator<string> {
    const bindings =
      await this.options.repository.listActiveTasksForChat(input);
    if (bindings.length === 0) {
      yield "There is no active SDAR Task for this user and chat.";
      return;
    }
    if (bindings.length !== 1) {
      yield renderActiveTaskList(bindings);
      return;
    }
    const binding = bindings[0];
    if (binding === undefined) throw new Error("Active Task list changed");
    const client = await this.options.getClient();
    const task = await client.getTask(binding.sdarTaskId, {
      signal: callerSignal,
    });
    const observed = await this.observeTask(task, binding, true);
    if (observed.publishable) {
      observer?.({
        source: "task",
        value: task,
        fragments: observed.fragments,
      });
    }
    for (const fragment of observed.fragments) yield fragment;
  }

  private async *pollTask(
    client: SdarA2aClient,
    initialBinding: TaskBinding,
    signal?: AbortSignal,
    observer?: TaskCoordinatorObserver,
  ): AsyncGenerator<string> {
    const startedAt = this.now();
    let binding = initialBinding;
    while (this.now() - startedAt < this.pollingBudgetMs) {
      if (signal?.aborted === true) return;
      await this.delay(this.pollingIntervalMs, signal);
      const task = await client.getTask(binding.sdarTaskId, { signal });
      const observed = await this.observeTask(task, binding);
      binding = observed.binding;
      if (observed.publishable) {
        observer?.({
          source: "task",
          value: task,
          fragments: observed.fragments,
        });
      }
      for (const fragment of observed.fragments) yield fragment;
      if (isResponseBoundary(task.state)) return;
    }
    yield "SDAR is still working. This chat response is ending without cancellation; ask for status to continue.";
  }

  private async observeEvent(
    event: NormalizedStreamEvent,
    turn: TaskTurnContext,
    currentBinding?: TaskBinding,
  ): Promise<{
    readonly binding?: TaskBinding;
    readonly task?: NormalizedTask;
    readonly fragments: readonly string[];
    readonly publishable: boolean;
  }> {
    if (event.kind === "message") {
      const fragments = renderMessage(event.message);
      return { fragments, publishable: fragments.length > 0 };
    }
    if (event.kind === "artifact") {
      const binding = await this.ensureBinding(
        turn,
        event.taskId,
        event.contextId,
        "WORKING",
        currentBinding,
      );
      const unique = await this.recordObservation(
        event.taskId,
        "artifact",
        event,
        "WORKING",
        summarizeArtifact(event.artifact),
      );
      return {
        binding,
        fragments: unique ? renderArtifact(event.artifact) : [],
        publishable: unique,
      };
    }
    if (event.kind === "task") {
      const binding = await this.ensureBinding(
        turn,
        event.task.taskId,
        event.task.contextId,
        event.task.state,
        currentBinding,
      );
      const observed = await this.observeTask(event.task, binding);
      return { ...observed, task: event.task };
    }

    const binding = await this.ensureBinding(
      turn,
      event.taskId,
      event.contextId,
      event.state,
      currentBinding,
    );
    const hash = observationHash(event);
    const unique = await this.options.repository.recordEvent({
      taskId: event.taskId,
      eventKind: "status",
      eventHash: hash,
      status: event.state,
      summary: observationJson(event),
      ...(event.timestamp === undefined ? {} : { occurredAt: event.timestamp }),
    });
    const updated = await this.updateBinding(binding, {
      state: event.state,
      timestamp: event.timestamp,
      eventHash: hash,
      pendingInput: pendingSnapshot(event),
    });
    const accepted =
      updated.status === event.state && updated.lastEventHash === hash;
    return {
      binding: updated,
      fragments:
        unique && accepted
          ? renderStatus(event.state, event.message, event.phaseMessage, event)
          : [],
      publishable: unique && accepted,
    };
  }

  private async observeTask(
    task: NormalizedTask,
    binding: TaskBinding,
    forceRender = false,
  ): Promise<{
    readonly binding: TaskBinding;
    readonly fragments: string[];
    readonly publishable: boolean;
  }> {
    const hash = observationHash(task);
    const unique = await this.options.repository.recordEvent({
      taskId: task.taskId,
      eventKind: "task",
      eventHash: hash,
      status: task.state,
      summary: observationJson(task),
      ...(task.statusTimestamp === undefined
        ? {}
        : { occurredAt: task.statusTimestamp }),
    });
    const updated = await this.updateBinding(binding, {
      state: task.state,
      timestamp: task.statusTimestamp,
      eventHash: hash,
      pendingInput: pendingSnapshot(task),
    });
    const accepted =
      updated.status === task.state && updated.lastEventHash === hash;
    if (!accepted || (!unique && !forceRender)) {
      return { binding: updated, fragments: [], publishable: false };
    }
    return {
      binding: updated,
      fragments: [
        ...renderStatus(
          task.state,
          task.statusMessage,
          task.phaseMessage,
          task,
        ),
        ...(isTerminal(task.state)
          ? task.artifacts.flatMap(renderArtifact)
          : []),
      ],
      publishable: true,
    };
  }

  private async ensureBinding(
    turn: TaskTurnContext,
    taskId: string,
    contextId: string,
    state: NormalizedTaskState,
    current?: TaskBinding,
  ): Promise<TaskBinding> {
    if (current !== undefined) {
      if (
        current.sdarTaskId !== taskId ||
        current.sdarContextId !== contextId
      ) {
        throw new Error("A2A stream changed Task identity");
      }
      return current;
    }
    const existing = await this.options.repository.findAuthorizedTask({
      openWebUiChatId: turn.chatId,
      userId: turn.userId,
      sdarTaskId: taskId,
    });
    if (existing !== undefined) return existing;
    try {
      return await this.options.repository.createTaskBinding({
        openWebUiChatId: turn.chatId,
        userId: turn.userId,
        sdarTaskId: taskId,
        sdarContextId: contextId,
        status: state,
      });
    } catch (error) {
      if (!(error instanceof PersistenceConflictError)) throw error;
      const raced = await this.options.repository.findAuthorizedTask({
        openWebUiChatId: turn.chatId,
        userId: turn.userId,
        sdarTaskId: taskId,
      });
      if (raced === undefined) throw error;
      return raced;
    }
  }

  private async updateBinding(
    binding: TaskBinding,
    observation: {
      readonly state: NormalizedTaskState;
      readonly timestamp?: string;
      readonly eventHash: string;
      readonly pendingInput?: JsonValue;
    },
  ): Promise<TaskBinding> {
    return this.options.repository.updateTaskBinding({
      bindingId: binding.bindingId,
      expectedVersion: binding.version,
      status: observation.state,
      lastEventHash: observation.eventHash,
      pendingInput: observation.pendingInput,
      ...(observation.timestamp === undefined
        ? {}
        : { lastStatusTimestamp: observation.timestamp }),
      terminal: isTerminal(observation.state),
    });
  }

  private async recordObservation(
    taskId: string,
    kind: string,
    value: unknown,
    state: NormalizedTaskState,
    summary: JsonValue,
  ): Promise<boolean> {
    return this.options.repository.recordEvent({
      taskId,
      eventKind: kind,
      eventHash: observationHash(value),
      status: state,
      summary,
    });
  }
}

function pendingSnapshot(
  value: PublishedStatusDetails & {
    readonly state: NormalizedTaskState;
    readonly phaseMessage?: string;
  },
): JsonValue | undefined {
  if (value.state !== "INPUT_REQUIRED") return undefined;
  return {
    ...(value.internalPhase === undefined
      ? {}
      : { internalPhase: value.internalPhase }),
    ...(value.inputRequestId === undefined
      ? {}
      : { inputRequestId: value.inputRequestId }),
    ...(value.phaseMessage === undefined
      ? {}
      : { phaseMessage: value.phaseMessage }),
  };
}

function pendingDetails(value: JsonValue | undefined): {
  readonly internalPhase?: string;
  readonly inputRequestId?: string;
} {
  if (value === undefined || value === null || Array.isArray(value)) return {};
  if (typeof value !== "object") return {};
  const internalPhase = value.internalPhase;
  const inputRequestId = value.inputRequestId;
  return {
    ...(typeof internalPhase === "string" ? { internalPhase } : {}),
    ...(typeof inputRequestId === "string" ? { inputRequestId } : {}),
  };
}

function isFollowUpAllowed(
  action: SdarFollowUpAction,
  status: string,
  internalPhase?: string,
): boolean {
  if (status === "INPUT_REQUIRED") {
    if (internalPhase === "awaiting_plan_confirmation") {
      return [
        "confirm_plan",
        "reject_plan",
        "revise_plan",
        "patch_goal",
      ].includes(action);
    }
    if (internalPhase === "awaiting_user_input") {
      return action === "provide_input";
    }
    if (internalPhase === "paused") return action === "resume";
    return false;
  }
  return ["patch_goal", "cancel_goal", "pause"].includes(action);
}

function wrongPhaseMessage(status: string, internalPhase?: string): string {
  const phase =
    safePublishedText(internalPhase, 128) ?? "unpublished or invalid";
  return `Follow-up was not sent: action is not allowed for SDAR status ${status} and internalPhase ${phase}.`;
}

function assertSameTask(task: NormalizedTask, binding: TaskBinding): void {
  if (
    task.taskId !== binding.sdarTaskId ||
    task.contextId !== binding.sdarContextId
  ) {
    throw new Error("SDAR returned a mismatched Task identity");
  }
}

function inputRequiredExplanation(internalPhase?: string): string {
  if (internalPhase === "awaiting_plan_confirmation") {
    return "SDAR is waiting for an explicit plan decision: confirm, reject, revise the plan, or patch the goal. No decision is inferred automatically.";
  }
  if (internalPhase === "awaiting_user_input") {
    return "SDAR is waiting for the requested user input. A substantive reply will be sent as provide_input.";
  }
  if (internalPhase === "paused") {
    return "SDAR is paused. Send an explicit resume request to continue.";
  }
  return "SDAR requires input, but its published internalPhase is missing or unsupported. No Follow-up will be inferred.";
}

function isCapabilityGap(details: PublishedStatusDetails): boolean {
  return (
    details.internalPhase === "capability_gap" ||
    details.errorCode === "CAPABILITY_GAP" ||
    details.capabilityGap !== undefined
  );
}

function safeErrorCode(value: string | undefined): string | undefined {
  return value !== undefined && /^[A-Z0-9_.-]{1,128}$/u.test(value)
    ? value
    : undefined;
}

interface PublishedStatusDetails {
  readonly internalPhase?: string;
  readonly inputRequestId?: string;
  readonly errorCode?: string;
  readonly capabilityGap?: JsonValue;
  readonly nextAction?: string;
}

function renderStatus(
  state: NormalizedTaskState,
  message?: NormalizedMessage,
  phaseMessage?: string,
  details: PublishedStatusDetails = {},
): string[] {
  const text = message === undefined ? [] : renderMessage(message);
  const phase = safePublishedText(phaseMessage, 4_000);
  const base = [
    `**SDAR status: ${state}**`,
    ...text,
    ...(phase === undefined ? [] : [phase]),
  ];
  if (state === "INPUT_REQUIRED") {
    return [...base, inputRequiredExplanation(details.internalPhase)];
  }
  if (state === "FAILED" && isCapabilityGap(details)) {
    return [
      ...base,
      "SDAR reported a Capability Gap, not a chat-server protocol failure.",
      ...(details.capabilityGap === undefined
        ? []
        : [
            "```json\n" + boundedPublishedJson(details.capabilityGap) + "\n```",
          ]),
      ...(safePublishedText(details.nextAction, 512) === undefined
        ? []
        : [
            "Next action published by SDAR: " +
              safePublishedText(details.nextAction, 512),
          ]),
    ];
  }
  if (state === "FAILED") {
    const code = safeErrorCode(details.errorCode);
    return [
      ...base,
      "SDAR reported a business failure.",
      ...(code === undefined ? [] : ["Published error code: `" + code + "`"]),
    ];
  }
  return base;
}

function renderMessage(message: NormalizedMessage): string[] {
  return message.parts.flatMap((part) =>
    part.kind === "text" && part.text !== undefined
      ? [safePublishedText(part.text, 8_000)].filter(
          (value): value is string => value !== undefined,
        )
      : [],
  );
}

function renderArtifact(artifact: NormalizedArtifact): string[] {
  return artifact.parts.flatMap((part) => {
    if (part.kind === "text" && part.text !== undefined) {
      return [safePublishedText(part.text, 16_000)].filter(
        (value): value is string => value !== undefined,
      );
    }
    if (part.kind === "data" && part.data !== undefined) {
      return ["```json\n" + boundedPublishedJson(part.data) + "\n```"];
    }
    return [];
  });
}

function renderAmbiguousTaskList(bindings: readonly TaskBinding[]): string {
  return [
    "More than one active SDAR Task matches this mutable operation. Name exactly one Task; nothing was sent.",
    ...bindings.map(
      (binding) =>
        `- ${binding.shortId ?? binding.sdarTaskId}: ${binding.status}`,
    ),
  ].join("\n");
}

function renderActiveTaskList(bindings: readonly TaskBinding[]): string {
  return [
    "Multiple SDAR Tasks are active in this chat:",
    ...bindings.map(
      (binding) =>
        `- ${binding.shortId ?? binding.sdarTaskId}: ${binding.status}`,
    ),
  ].join("\n");
}

function summarizeArtifact(artifact: NormalizedArtifact): JsonValue {
  return {
    artifactId: artifact.artifactId,
    partKinds: artifact.parts.map(({ kind }) => kind),
  };
}

function observationHash(value: unknown): string {
  return hashJson(observationJson(value));
}

function observationJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function isTerminal(state: NormalizedTaskState): boolean {
  return terminalStates.has(state);
}

function isResponseBoundary(state: NormalizedTaskState): boolean {
  return isTerminal(state) || state === "INPUT_REQUIRED";
}
function eventState(
  event: NormalizedStreamEvent,
): NormalizedTaskState | undefined {
  if (event.kind === "task") return event.task.state;
  if (event.kind === "status") return event.state;
  return undefined;
}
function defaultDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
