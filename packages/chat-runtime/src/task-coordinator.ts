import { randomUUID } from "node:crypto";

import type {
  NormalizedArtifact,
  NormalizedMessage,
  NormalizedStreamEvent,
  NormalizedTask,
  NormalizedTaskState,
  SdarA2aClient,
} from "../../sdar-a2a-adapter/src/index.js";
import {
  ChatPersistenceRepository,
  hashJson,
  PersistenceConflictError,
  type JsonValue,
  type TaskBinding,
} from "../../persistence/src/index.js";

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

export interface TaskCoordinatorOptions {
  readonly repository: ChatPersistenceRepository;
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

    const client = await this.options.getClient();
    if (claim.outcome === "replay") {
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
      for (const fragment of observed.fragments) yield fragment;
      return;
    }

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
        for (const fragment of observed.fragments) yield fragment;
        if (latestState !== undefined && isTerminal(latestState)) return;
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
    if (latestState !== undefined && isTerminal(latestState)) return;

    yield* this.pollTask(client, binding, callerSignal);
  }

  async *status(
    input: Pick<TaskTurnContext, "chatId" | "userId">,
    callerSignal?: AbortSignal,
  ): AsyncGenerator<string> {
    const binding = await this.options.repository.findActiveTaskForChat(input);
    if (binding === undefined) {
      yield "There is no active SDAR Task for this user and chat.";
      return;
    }
    const client = await this.options.getClient();
    const task = await client.getTask(binding.sdarTaskId, {
      signal: callerSignal,
    });
    const observed = await this.observeTask(task, binding, true);
    for (const fragment of observed.fragments) yield fragment;
  }

  private async *pollTask(
    client: SdarA2aClient,
    initialBinding: TaskBinding,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const startedAt = this.now();
    let binding = initialBinding;
    while (this.now() - startedAt < this.pollingBudgetMs) {
      if (signal?.aborted === true) return;
      await this.delay(this.pollingIntervalMs, signal);
      const task = await client.getTask(binding.sdarTaskId, { signal });
      const observed = await this.observeTask(task, binding);
      binding = observed.binding;
      for (const fragment of observed.fragments) yield fragment;
      if (isTerminal(task.state)) return;
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
  }> {
    if (event.kind === "message") {
      return { fragments: renderMessage(event.message) };
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
    });
    return {
      binding: updated,
      fragments: unique
        ? renderStatus(event.state, event.message, event.phaseMessage)
        : [],
    };
  }

  private async observeTask(
    task: NormalizedTask,
    binding: TaskBinding,
    forceRender = false,
  ): Promise<{ readonly binding: TaskBinding; readonly fragments: string[] }> {
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
    });
    if (!unique && !forceRender) return { binding: updated, fragments: [] };
    return {
      binding: updated,
      fragments: [
        ...renderStatus(task.state, task.statusMessage, task.phaseMessage),
        ...(isTerminal(task.state)
          ? task.artifacts.flatMap(renderArtifact)
          : []),
      ],
    };
  }

  private async ensureBinding(
    turn: TaskTurnContext,
    taskId: string,
    contextId: string,
    state: NormalizedTaskState,
    current?: TaskBinding,
  ): Promise<TaskBinding> {
    if (current !== undefined) return current;
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
    },
  ): Promise<TaskBinding> {
    return this.options.repository.updateTaskBinding({
      bindingId: binding.bindingId,
      expectedVersion: binding.version,
      status: observation.state,
      lastEventHash: observation.eventHash,
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

function renderStatus(
  state: NormalizedTaskState,
  message?: NormalizedMessage,
  phaseMessage?: string,
): string[] {
  const text = message === undefined ? [] : renderMessage(message);
  const phase =
    phaseMessage === undefined || phaseMessage.trim().length === 0
      ? []
      : [phaseMessage.trim()];
  return [`**SDAR status: ${state}**`, ...text, ...phase];
}

function renderMessage(message: NormalizedMessage): string[] {
  return message.parts.flatMap((part) =>
    part.kind === "text" && part.text !== undefined
      ? [part.text.trim()].filter(Boolean)
      : [],
  );
}

function renderArtifact(artifact: NormalizedArtifact): string[] {
  return artifact.parts.flatMap((part) => {
    if (part.kind === "text" && part.text !== undefined) {
      return [part.text.trim()].filter(Boolean);
    }
    if (part.kind === "data" && part.data !== undefined) {
      return ["```json\n" + boundedJson(part.data) + "\n```"];
    }
    return [];
  });
}

function summarizeArtifact(artifact: NormalizedArtifact): JsonValue {
  return {
    artifactId: artifact.artifactId,
    partKinds: artifact.parts.map(({ kind }) => kind),
  };
}

function boundedJson(value: JsonValue): string {
  const rendered = JSON.stringify(value, null, 2);
  return rendered.length <= 4_000
    ? rendered
    : rendered.slice(0, 4_000) + "\n... truncated";
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
