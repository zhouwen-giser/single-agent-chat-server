import type { BaseCheckpointSaver } from "@langchain/langgraph";

import type { DurableAgUiEventSource } from "../../../../packages/interaction-runtime/src/index.js";
import {
  A2aInteractionMapper,
  legacyChatResultToInteractionEvents,
  taskRequestId,
  type LegacyChatResult,
} from "../../../../packages/interaction-runtime/src/index.js";
import {
  SdarTaskCoordinator,
  type FollowUpTurnContext,
  type TaskCoordinatorObserver,
  type TaskTurnContext,
} from "../../../../packages/chat-runtime/src/index.js";
import {
  InteractionEventFactory,
  type SdarInteractionEvent,
  type SdarTaskScope,
} from "../../../../packages/interaction-contract/src/index.js";
import type { NormalizedTaskState } from "../../../../packages/sdar-a2a-adapter/src/index.js";
import type {
  InteractionPersistenceRepository,
  TaskBinding,
} from "../../../../packages/persistence/src/index.js";
import type { ConversationContext } from "../../../../packages/conversation-context/src/index.js";
import { createSingleAgentChatGraph } from "../../../../src/agent/graph.js";
import type { ClassificationError } from "../../../../src/agent/classification.js";
import type { StructuredChatModel } from "../../../../src/agent/model.js";

export function createSdarAgUiInteractionSource(input: {
  readonly repository: InteractionPersistenceRepository;
  readonly checkpointer?: BaseCheckpointSaver;
  readonly coordinator: SdarTaskCoordinator;
  readonly model?: StructuredChatModel;
  readonly onClassificationError?: (error: ClassificationError) => void;
  readonly assembleContext?: (input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly currentUserText: string;
  }) => Promise<ConversationContext>;
}): DurableAgUiEventSource {
  const graph = createSingleAgentChatGraph(
    input.model,
    input.checkpointer,
    input.onClassificationError,
  );
  return async function* run(context) {
    const userText = lastUserText(context.input);
    const activeBindings = await input.repository.listActiveTasksForChat({
      principalId: context.principalId,
      threadId: context.threadId,
      limit: 32,
    });
    const conversationContext =
      input.assembleContext === undefined
        ? fallbackContext(context.threadId, activeBindings)
        : await input.assembleContext({
            principalId: context.principalId,
            threadId: context.threadId,
            currentUserText: userText,
          });
    const graphResult = await graph.invoke(
      {
        messages: [{ role: "user", content: userText }],
        threadId: context.threadId,
        userId: context.principalId,
        openWebUiChatId: context.input.threadId,
        utilityRequest: false,
        conversationContext,
      },
      { configurable: { thread_id: context.threadId } },
    );

    if (graphResult.requestKind === "new_task") {
      yield* coordinatorInteractionEvents(context, (observer) =>
        input.coordinator.submit(
          toTaskTurn(context, graphResult.taskText ?? userText),
          context.signal,
          observer,
        ),
      );
      return;
    }
    if (graphResult.requestKind === "list_tasks") {
      yield* legacyChatResultToInteractionEvents(
        renderTaskDirectory(
          conversationContext,
          graphResult.includeTerminalTasks,
        ),
        { runId: context.input.runId, threadId: context.input.threadId },
      );
      return;
    }
    if (graphResult.requestKind === "status") {
      if (graphResult.targetTaskId !== undefined) {
        const targetTaskId = graphResult.targetTaskId;
        await touchResolvedTask(
          input.repository,
          context.principalId,
          context.threadId,
          targetTaskId,
        );
        yield* coordinatorInteractionEvents(context, (observer) =>
          input.coordinator.statusForTask(
            {
              chatId: context.threadId,
              userId: context.principalId,
              taskId: targetTaskId,
            },
            context.signal,
            observer,
          ),
        );
        return;
      }
      yield* coordinatorInteractionEvents(context, () =>
        input.coordinator.listTaskStatuses({
          chatId: context.threadId,
          userId: context.principalId,
        }),
      );
      return;
    }
    const followUpAction = graphResult.followUpAction;
    if (
      graphResult.requestKind === "follow_up" &&
      followUpAction !== undefined &&
      graphResult.targetTaskId !== undefined
    ) {
      const targetTaskId = graphResult.targetTaskId;
      await touchResolvedTask(
        input.repository,
        context.principalId,
        context.threadId,
        targetTaskId,
      );
      yield* coordinatorInteractionEvents(context, (observer) =>
        input.coordinator.followUp(
          {
            ...toFollowUpTurn(context, userText, followUpAction),
            taskId: targetTaskId,
          },
          context.signal,
          observer,
        ),
      );
      return;
    }
    if (graphResult.requestKind === "cancel") {
      if (graphResult.targetTaskId === undefined) {
        yield* legacyChatResultToInteractionEvents(
          "No unique SDAR Task could be determined; no cancellation was sent.",
          { runId: context.input.runId, threadId: context.input.threadId },
        );
        return;
      }
      const targetTaskId = graphResult.targetTaskId;
      await touchResolvedTask(
        input.repository,
        context.principalId,
        context.threadId,
        targetTaskId,
      );
      yield* coordinatorInteractionEvents(context, (observer) =>
        input.coordinator.cancel(
          {
            ...toTaskTurn(context, userText),
            taskId: targetTaskId,
          },
          context.signal,
          observer,
        ),
      );
      return;
    }

    const result: LegacyChatResult =
      graphResult.requestKind === "follow_up"
        ? "No safe SDAR Follow-up action could be determined; nothing was sent."
        : renderGraphResult(graphResult);
    yield* legacyChatResultToInteractionEvents(result, {
      runId: context.input.runId,
      threadId: context.input.threadId,
    });
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
) => AsyncIterable<string>;

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

  for await (const fragment of operation(observer)) {
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

function isTerminalState(state: NormalizedTaskState): boolean {
  return ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(state);
}
function toTaskTurn(
  context: Parameters<DurableAgUiEventSource>[0],
  userText: string,
): TaskTurnContext {
  return {
    userText,
    userId: context.principalId,
    chatId: context.threadId,
    userMessageId: taskRequestId(context.input.runId),
  };
}

function toFollowUpTurn(
  context: Parameters<DurableAgUiEventSource>[0],
  userText: string,
  action: FollowUpTurnContext["action"],
): Omit<FollowUpTurnContext, "taskId"> {
  return { ...toTaskTurn(context, userText), action };
}

function fallbackContext(
  threadId: string,
  activeBindings: readonly TaskBinding[],
): ConversationContext {
  return {
    threadId,
    messages: [],
    activeTasks: activeBindings.map((binding) => ({
      bindingId: binding.bindingId,
      taskId: binding.sdarTaskId,
      contextId: binding.sdarContextId,
      shortId: binding.shortId ?? binding.sdarTaskId.slice(0, 64),
      status: binding.status,
      createdAt: binding.createdAt ?? "1970-01-01T00:00:00.000Z",
      updatedAt: binding.updatedAt ?? "1970-01-01T00:00:00.000Z",
    })),
    recentTerminalTasks: [],
  };
}

function renderTaskDirectory(
  context: ConversationContext,
  includeTerminal: boolean,
): string {
  const tasks = [
    ...context.activeTasks,
    ...(includeTerminal ? context.recentTerminalTasks : []),
  ];
  if (tasks.length === 0) return "No Tasks are bound to this conversation.";
  return [
    "Tasks in this conversation:",
    ...tasks.map(
      (task, index) =>
        `${index + 1}. ${task.shortId}: ${task.status}${task.summary === undefined ? "" : ` — ${task.summary}`}`,
    ),
  ].join("\n");
}

async function touchResolvedTask(
  repository: InteractionPersistenceRepository,
  principalId: string,
  threadId: string,
  taskId: string,
): Promise<void> {
  const binding = await repository.findAuthorizedTask({
    principalId,
    threadId,
    sdarTaskId: taskId,
  });
  if (binding === undefined) return;
  await repository.touchTaskReference({
    principalId,
    threadId,
    bindingId: binding.bindingId,
  });
}

function lastUserText(input: {
  readonly messages: readonly unknown[];
}): string {
  const message = [...input.messages]
    .reverse()
    .find(
      (
        candidate,
      ): candidate is { readonly role: string; readonly content: unknown } =>
        candidate !== null &&
        typeof candidate === "object" &&
        "role" in candidate &&
        candidate.role === "user",
    );
  return typeof message?.content === "string" ? message.content : "";
}

function renderGraphResult(result: {
  readonly messages: readonly { readonly content: unknown }[];
}): string {
  const content = result.messages.at(-1)?.content;
  return typeof content === "string"
    ? content
    : "The response could not be rendered as conversational text.";
}
