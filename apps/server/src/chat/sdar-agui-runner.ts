import type { RunAgentInput } from "../../../../packages/ag-ui-api-contract/src/index.js";
import {
  SdarTaskCoordinator,
  type TaskCoordinatorObserver,
} from "../../../../packages/chat-runtime/src/index.js";
import type { ClientHistoryMessage } from "../../../../packages/conversation-context/src/index.js";
import {
  A2aInteractionMapper,
  isWorldExplanationChatResult,
  taskRequestId,
  worldExplanationInteractionEvents,
  type DurableAgUiEventSource,
  type LegacyChatResult,
} from "../../../../packages/interaction-runtime/src/index.js";
import {
  InteractionEventFactory,
  type SdarInteractionEvent,
  type SdarTaskScope,
} from "../../../../packages/interaction-contract/src/index.js";
import type { InteractionPersistenceRepository } from "../../../../packages/persistence/src/index.js";
import type { NormalizedTaskState } from "../../../../packages/sdar-a2a-adapter/src/index.js";
import {
  ConversationApplicationService,
  type ConversationApplicationServiceOptions,
} from "./conversation-application-service.js";

export function createSdarAgUiInteractionSource(
  input: Omit<ConversationApplicationServiceOptions, "repository"> & {
    readonly repository: InteractionPersistenceRepository;
  },
): DurableAgUiEventSource {
  const application = new ConversationApplicationService({
    ...input,
    repository: adaptRepository(input.repository),
  });
  return async function* run(context) {
    const currentUser = lastUserMessage(context.input);
    if (currentUser === undefined) {
      throw new Error("AG-UI interaction requires a current user message");
    }
    yield* coordinatorInteractionEvents(context, async (observer) =>
      application.execute({
        protocol: "ag_ui",
        userText: currentUser.contentText,
        clientMessages: toClientHistoryMessages(context.input),
        userId: context.principalId,
        chatId: context.threadId,
        threadId: context.threadId,
        userMessageId: taskRequestId(context.input.runId),
        currentUserExternalMessageId: currentUser.id,
        utilityRequest: false,
        coordinatorObserver: observer,
        signal: context.signal,
      }),
    );
  };
}

export function createSdarAgUiTaskRecoverySource(
  coordinator: SdarTaskCoordinator,
): (
  context: Parameters<DurableAgUiEventSource>[0],
  taskId: string,
) => ReturnType<DurableAgUiEventSource> {
  return (context, taskId) =>
    coordinatorInteractionEvents(context, (observer) =>
      coordinator.statusForTask(
        {
          chatId: context.threadId,
          userId: context.principalId,
          taskId,
        },
        context.signal,
        observer,
      ),
    );
}

type CoordinatorOperation = (
  observer: TaskCoordinatorObserver,
) => LegacyChatResult | Promise<LegacyChatResult>;

async function* coordinatorInteractionEvents(
  context: Parameters<DurableAgUiEventSource>[0],
  operation: CoordinatorOperation,
): AsyncGenerator<SdarInteractionEvent> {
  const factory = new InteractionEventFactory({
    runId: context.input.runId,
    threadId: context.input.threadId,
  });
  const mapper = new A2aInteractionMapper(factory);
  const started = factory.create("run.started", {
    boundary: "bounded_interaction",
  });
  if (started !== undefined) yield started;

  const pendingEvents: SdarInteractionEvent[] = [];
  const fallbackFragments: string[] = [];
  const suppressedFragments = new Map<string, number>();
  let observed = false;
  let latestState: NormalizedTaskState | undefined;
  let taskScope: SdarTaskScope | undefined;
  const observer: TaskCoordinatorObserver = (observation) => {
    observed = true;
    for (const fragment of observation.fragments) {
      suppressedFragments.set(
        fragment,
        (suppressedFragments.get(fragment) ?? 0) + 1,
      );
    }
    if (observation.source === "task") {
      latestState = observation.value.state;
      taskScope = {
        taskId: observation.value.taskId,
        contextId: observation.value.contextId,
      };
      pendingEvents.push(...mapper.mapTask(observation.value));
      return;
    }
    const value = observation.value;
    if (value.kind === "task") {
      latestState = value.task.state;
      taskScope = {
        taskId: value.task.taskId,
        contextId: value.task.contextId,
      };
    } else if (value.kind === "status") {
      latestState = value.state;
      taskScope = { taskId: value.taskId, contextId: value.contextId };
    } else if (value.kind === "artifact") {
      taskScope = { taskId: value.taskId, contextId: value.contextId };
    }
    pendingEvents.push(...mapper.mapStreamEvent(value));
  };

  const result = await operation(observer);
  if (isWorldExplanationChatResult(result)) {
    while (pendingEvents.length > 0) {
      const event = pendingEvents.shift();
      if (event !== undefined) yield event;
    }
    for (const event of worldExplanationInteractionEvents(
      factory,
      result.explanation,
    )) {
      yield event;
    }
    const finished = factory.create("run.finished", {
      reason: "world_explanation_complete",
      taskTerminal: false,
    });
    if (finished !== undefined) yield finished;
    return;
  }
  for await (const fragment of fragments(result)) {
    while (pendingEvents.length > 0) {
      const event = pendingEvents.shift();
      if (event !== undefined) yield event;
    }
    const suppressed = suppressedFragments.get(fragment) ?? 0;
    if (suppressed > 0) {
      if (suppressed === 1) suppressedFragments.delete(fragment);
      else suppressedFragments.set(fragment, suppressed - 1);
    } else {
      fallbackFragments.push(fragment);
    }
  }
  while (pendingEvents.length > 0) {
    const event = pendingEvents.shift();
    if (event !== undefined) yield event;
  }
  for (const fragment of fallbackFragments) {
    const event = factory.publicText(fragment, {
      ...(taskScope === undefined ? {} : { task: taskScope }),
    });
    if (event !== undefined) yield event;
  }

  if (latestState === "INPUT_REQUIRED") return;
  if (latestState !== undefined) {
    const ended = mapper.observationEnded({
      state: latestState,
      taskContinues: !isTerminalState(latestState),
    });
    if (ended !== undefined) yield ended;
    return;
  }
  const finished = factory.create("run.finished", {
    reason: observed
      ? "message_observation_complete"
      : "local_response_complete",
    taskTerminal: false,
  });
  if (finished !== undefined) yield finished;
}

function adaptRepository(repository: InteractionPersistenceRepository) {
  return {
    listActiveTasksForChat: (input: {
      readonly chatId: string;
      readonly userId: string;
      readonly limit?: number;
    }) =>
      repository.listActiveTasksForChat({
        threadId: input.chatId,
        principalId: input.userId,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
    findAuthorizedTask: (input: {
      readonly openWebUiChatId: string;
      readonly userId: string;
      readonly sdarTaskId: string;
    }) =>
      repository.findAuthorizedTask({
        threadId: input.openWebUiChatId,
        principalId: input.userId,
        sdarTaskId: input.sdarTaskId,
      }),
    touchTaskReference: (input: {
      readonly chatId: string;
      readonly userId: string;
      readonly bindingId: string;
    }) =>
      repository.touchTaskReference({
        threadId: input.chatId,
        principalId: input.userId,
        bindingId: input.bindingId,
      }),
  };
}

function toClientHistoryMessages(
  input: RunAgentInput,
): readonly ClientHistoryMessage[] {
  return input.messages.flatMap((message) => {
    if (message.role === "tool") return [];
    const contentText = messageContentText(message.content);
    if (contentText.length === 0) return [];
    if (!["user", "assistant", "system", "developer"].includes(message.role)) {
      return [];
    }
    return [
      {
        role: message.role as ClientHistoryMessage["role"],
        contentText,
        externalMessageId: message.id,
      },
    ];
  });
}

function lastUserMessage(
  input: RunAgentInput,
): { readonly id: string; readonly contentText: string } | undefined {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message?.role !== "user") continue;
    const contentText = messageContentText(message.content);
    if (contentText.length > 0) return { id: message.id, contentText };
  }
  return undefined;
}

function messageContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (part === null || typeof part !== "object") return [];
      const value = part as Readonly<Record<string, unknown>>;
      return typeof value.text === "string" ? [value.text] : [];
    })
    .join("\n");
}

async function* fragments(result: LegacyChatResult): AsyncGenerator<string> {
  if (typeof result === "string") {
    yield result;
    return;
  }
  if (isWorldExplanationChatResult(result)) return;
  yield* result;
}

function isTerminalState(state: NormalizedTaskState): boolean {
  return ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(state);
}
