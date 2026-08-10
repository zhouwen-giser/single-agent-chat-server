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
import type { InteractionPersistenceRepository } from "../../../../packages/persistence/src/index.js";
import {
  resolveQueryIntent,
  type InteractionQueryService,
} from "../../../../packages/interaction-query/src/index.js";
import { createSingleAgentChatGraph } from "../../../../src/agent/graph.js";
import type { StructuredChatModel } from "../../../../src/agent/model.js";
import type { ActiveTaskSnapshot } from "../../../../src/agent/state.js";

export function createSdarAgUiInteractionSource(input: {
  readonly repository: InteractionPersistenceRepository;
  readonly checkpointer?: BaseCheckpointSaver;
  readonly coordinator: SdarTaskCoordinator;
  readonly queryService?: InteractionQueryService;
  readonly model?: StructuredChatModel;
}): DurableAgUiEventSource {
  const graph = createSingleAgentChatGraph(input.model, input.checkpointer);
  return async function* run(context) {
    const userText = lastUserText(context.input);
    const query = resolveQueryIntent(userText);
    if (query !== undefined && input.queryService !== undefined) {
      const result = await input.queryService.execute({
        ...query,
        principalId: context.principalId,
        threadId: context.threadId,
        signal: context.signal,
      });
      yield* legacyChatResultToInteractionEvents(result, {
        runId: context.input.runId,
        threadId: context.input.threadId,
      });
      return;
    }

    const binding = await input.repository.findActiveTask({
      principalId: context.principalId,
      threadId: context.threadId,
    });
    const graphResult = await graph.invoke(
      {
        messages: [{ role: "user", content: userText }],
        threadId: context.threadId,
        userId: context.principalId,
        openWebUiChatId: context.input.threadId,
        utilityRequest: false,
        ...(binding === undefined ? {} : { activeTask: toActiveTask(binding) }),
      },
      { configurable: { thread_id: context.threadId } },
    );

    if (graphResult.requestKind === "new_task" && binding === undefined) {
      yield* coordinatorInteractionEvents(context, (observer) =>
        input.coordinator.submit(
          toTaskTurn(context, userText),
          context.signal,
          observer,
        ),
      );
      return;
    }
    if (graphResult.requestKind === "status") {
      yield* coordinatorInteractionEvents(context, (observer) =>
        input.coordinator.status(
          { chatId: context.threadId, userId: context.principalId },
          context.signal,
          observer,
        ),
      );
      return;
    }
    const followUpAction = graphResult.followUpAction;
    if (
      graphResult.requestKind === "follow_up" &&
      followUpAction !== undefined
    ) {
      yield* coordinatorInteractionEvents(context, (observer) =>
        input.coordinator.followUp(
          toFollowUpTurn(context, userText, followUpAction),
          context.signal,
          observer,
        ),
      );
      return;
    }
    if (graphResult.requestKind === "cancel") {
      yield* coordinatorInteractionEvents(context, (observer) =>
        input.coordinator.cancel(
          toTaskTurn(context, userText),
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
): FollowUpTurnContext {
  return { ...toTaskTurn(context, userText), action };
}

function toActiveTask(binding: {
  readonly sdarTaskId: string;
  readonly sdarContextId: string;
  readonly status: string;
  readonly pendingInput?: unknown;
}): ActiveTaskSnapshot {
  const status = ["SUBMITTED", "WORKING", "INPUT_REQUIRED"].includes(
    binding.status,
  )
    ? (binding.status as ActiveTaskSnapshot["status"])
    : "WORKING";
  const internalPhase = readInternalPhase(binding.pendingInput);
  return {
    taskId: binding.sdarTaskId,
    contextId: binding.sdarContextId,
    status,
    ...(internalPhase === undefined ? {} : { internalPhase }),
  };
}

function readInternalPhase(
  value: unknown,
): ActiveTaskSnapshot["internalPhase"] | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const phase = (value as { readonly internalPhase?: unknown }).internalPhase;
  return [
    "awaiting_plan_confirmation",
    "awaiting_user_input",
    "paused",
  ].includes(typeof phase === "string" ? phase : "")
    ? (phase as ActiveTaskSnapshot["internalPhase"])
    : undefined;
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
