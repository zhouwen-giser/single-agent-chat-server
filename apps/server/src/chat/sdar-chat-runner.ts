import type { BaseCheckpointSaver } from "@langchain/langgraph";

import type { ChatRunner, ChatRunnerContext } from "../api/openai-routes.js";
import {
  SdarTaskCoordinator,
  type TaskTurnContext,
} from "../../../../packages/chat-runtime/src/index.js";
import type { ChatPersistenceRepository } from "../../../../packages/persistence/src/index.js";
import { createSingleAgentChatGraph } from "../../../../src/agent/graph.js";
import type { ActiveTaskSnapshot } from "../../../../src/agent/state.js";

export function createSdarChatRunner(input: {
  readonly repository: ChatPersistenceRepository;
  readonly checkpointer: BaseCheckpointSaver;
  readonly coordinator: SdarTaskCoordinator;
}): ChatRunner {
  const graph = createSingleAgentChatGraph(undefined, input.checkpointer);
  return async (context) => {
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
    if (result.requestKind === "follow_up" || result.requestKind === "cancel") {
      return "This action is classified safely but becomes executable in Phase 7.";
    }
    return renderGraphResult(result);
  };
}

function toTaskTurn(context: ChatRunnerContext): TaskTurnContext {
  return {
    userText: context.userText,
    userId: context.identity.userId,
    chatId: context.openWebUi.chatId,
    userMessageId: context.openWebUi.userMessageId,
  };
}

function toActiveTask(binding: {
  readonly sdarTaskId: string;
  readonly sdarContextId: string;
  readonly status: string;
}): ActiveTaskSnapshot {
  const status = ["SUBMITTED", "WORKING", "INPUT_REQUIRED"].includes(
    binding.status,
  )
    ? (binding.status as ActiveTaskSnapshot["status"])
    : "WORKING";
  return {
    taskId: binding.sdarTaskId,
    contextId: binding.sdarContextId,
    status,
  };
}

function renderGraphResult(result: {
  readonly messages: readonly { readonly content: unknown }[];
}): string {
  const content = result.messages.at(-1)?.content;
  return typeof content === "string"
    ? content
    : "The response could not be rendered as conversational text.";
}
