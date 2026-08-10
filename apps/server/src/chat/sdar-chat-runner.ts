import type { BaseCheckpointSaver } from "@langchain/langgraph";

import type { ChatRunner, ChatRunnerContext } from "../api/openai-routes.js";
import {
  legacyChatResultToInteractionEvents,
  type LegacyChatResult,
} from "../../../../packages/interaction-runtime/src/index.js";
import {
  SdarTaskCoordinator,
  type FollowUpTurnContext,
  type TaskTurnContext,
} from "../../../../packages/chat-runtime/src/index.js";
import type { ChatPersistenceRepository } from "../../../../packages/persistence/src/index.js";
import { createSingleAgentChatGraph } from "../../../../src/agent/graph.js";
import type { StructuredChatModel } from "../../../../src/agent/model.js";
import type { ActiveTaskSnapshot } from "../../../../src/agent/state.js";

export function createSdarChatRunner(input: {
  readonly repository: ChatPersistenceRepository;
  readonly checkpointer: BaseCheckpointSaver;
  readonly coordinator: SdarTaskCoordinator;
  readonly model?: StructuredChatModel;
}): ChatRunner {
  const graph = createSingleAgentChatGraph(input.model, input.checkpointer);
  const runLegacy = async (
    context: ChatRunnerContext,
  ): Promise<LegacyChatResult> => {
    const binding = await input.repository.findActiveTaskForChat({
      chatId: context.openWebUi.chatId,
      userId: context.identity.userId,
    });
    const result = await graph.invoke(
      {
        messages: [{ role: "user", content: context.userText }],
        threadId: context.threadId,
        userId: context.identity.userId,
        openWebUiChatId: context.openWebUi.chatId,
        utilityRequest: context.openWebUi.utilityTask !== undefined,
        ...(binding === undefined ? {} : { activeTask: toActiveTask(binding) }),
      },
      { configurable: { thread_id: context.threadId } },
    );
    if (result.requestKind === "new_task") {
      if (binding !== undefined) return renderGraphResult(result);
      return input.coordinator.submit(toTaskTurn(context), context.signal);
    }
    if (result.requestKind === "status") {
      return input.coordinator.status(
        {
          chatId: context.openWebUi.chatId,
          userId: context.identity.userId,
        },
        context.signal,
      );
    }
    if (result.requestKind === "follow_up") {
      if (result.followUpAction === undefined) {
        return "No safe SDAR Follow-up action could be determined; nothing was sent.";
      }
      return input.coordinator.followUp(
        toFollowUpTurn(context, result.followUpAction),
        context.signal,
      );
    }
    if (result.requestKind === "cancel") {
      return input.coordinator.cancel(toTaskTurn(context), context.signal);
    }
    return renderGraphResult(result);
  };
  return async (context) =>
    legacyChatResultToInteractionEvents(await runLegacy(context), {
      runId: context.runId,
      threadId: context.threadId,
    });
}

function toTaskTurn(context: ChatRunnerContext): TaskTurnContext {
  return {
    userText: context.userText,
    userId: context.identity.userId,
    chatId: context.openWebUi.chatId,
    userMessageId: context.openWebUi.userMessageId,
  };
}

function toFollowUpTurn(
  context: ChatRunnerContext,
  action: FollowUpTurnContext["action"],
): FollowUpTurnContext {
  return { ...toTaskTurn(context), action };
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
function renderGraphResult(result: {
  readonly messages: readonly { readonly content: unknown }[];
}): string {
  const content = result.messages.at(-1)?.content;
  return typeof content === "string"
    ? content
    : "The response could not be rendered as conversational text.";
}
