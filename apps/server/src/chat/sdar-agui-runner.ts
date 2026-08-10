import type { BaseCheckpointSaver } from "@langchain/langgraph";

import type { DurableAgUiEventSource } from "../../../../packages/interaction-runtime/src/index.js";
import {
  legacyChatResultToInteractionEvents,
  taskRequestId,
  type LegacyChatResult,
} from "../../../../packages/interaction-runtime/src/index.js";
import {
  SdarTaskCoordinator,
  type FollowUpTurnContext,
  type TaskTurnContext,
} from "../../../../packages/chat-runtime/src/index.js";
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
    let result: LegacyChatResult;
    if (query !== undefined && input.queryService !== undefined) {
      result = await input.queryService.execute({
        ...query,
        principalId: context.principalId,
        threadId: context.threadId,
        signal: context.signal,
      });
    } else {
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
          ...(binding === undefined
            ? {}
            : { activeTask: toActiveTask(binding) }),
        },
        { configurable: { thread_id: context.threadId } },
      );
      if (graphResult.requestKind === "new_task") {
        result =
          binding === undefined
            ? input.coordinator.submit(
                toTaskTurn(context, userText),
                context.signal,
              )
            : renderGraphResult(graphResult);
      } else if (graphResult.requestKind === "status") {
        result = input.coordinator.status(
          { chatId: context.threadId, userId: context.principalId },
          context.signal,
        );
      } else if (graphResult.requestKind === "follow_up") {
        result =
          graphResult.followUpAction === undefined
            ? "No safe SDAR Follow-up action could be determined; nothing was sent."
            : input.coordinator.followUp(
                toFollowUpTurn(context, userText, graphResult.followUpAction),
                context.signal,
              );
      } else if (graphResult.requestKind === "cancel") {
        result = input.coordinator.cancel(
          toTaskTurn(context, userText),
          context.signal,
        );
      } else {
        result = renderGraphResult(graphResult);
      }
    }
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
    legacyChatResultToInteractionEvents(
      coordinator.statusForTask(
        {
          chatId: context.threadId,
          userId: context.principalId,
          taskId,
        },
        context.signal,
      ),
      { runId: context.input.runId, threadId: context.input.threadId },
    );
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
