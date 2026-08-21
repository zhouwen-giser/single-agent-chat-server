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
import type {
  ChatPersistenceRepository,
  TaskBinding,
} from "../../../../packages/persistence/src/index.js";
import type { ConversationContext } from "../../../../packages/conversation-context/src/index.js";
import { createSingleAgentChatGraph } from "../../../../src/agent/graph.js";
import type { ClassificationError } from "../../../../src/agent/classification.js";
import type { StructuredChatModel } from "../../../../src/agent/model.js";

export function createSdarChatRunner(input: {
  readonly repository: ChatPersistenceRepository;
  readonly checkpointer?: BaseCheckpointSaver;
  readonly coordinator: SdarTaskCoordinator;
  readonly model?: StructuredChatModel;
  readonly onClassificationError?: (error: ClassificationError) => void;
  readonly assembleContext?: (input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly currentUserText: string;
  }) => Promise<ConversationContext>;
}): ChatRunner {
  const graph = createSingleAgentChatGraph(
    input.model,
    input.checkpointer,
    input.onClassificationError,
  );
  const runLegacy = async (
    context: ChatRunnerContext,
  ): Promise<LegacyChatResult> => {
    const activeBindings = await input.repository.listActiveTasksForChat({
      chatId: context.openWebUi.chatId,
      userId: context.identity.userId,
      limit: 32,
    });
    const conversationContext =
      input.assembleContext === undefined
        ? fallbackContext(context.threadId, activeBindings)
        : await input.assembleContext({
            principalId: context.identity.userId,
            threadId: context.threadId,
            currentUserText: context.userText,
          });
    const result = await graph.invoke(
      {
        messages: [{ role: "user", content: context.userText }],
        threadId: context.threadId,
        userId: context.identity.userId,
        openWebUiChatId: context.openWebUi.chatId,
        utilityRequest: context.openWebUi.utilityTask !== undefined,
        conversationContext,
      },
      { configurable: { thread_id: context.threadId } },
    );
    if (result.requestKind === "new_task") {
      return input.coordinator.submit(
        {
          ...toTaskTurn(context),
          userText: result.taskText ?? context.userText,
        },
        context.signal,
      );
    }
    if (result.requestKind === "list_tasks") {
      return renderTaskDirectory(
        conversationContext,
        result.includeTerminalTasks,
      );
    }
    if (result.requestKind === "status") {
      if (result.targetTaskId !== undefined) {
        await touchResolvedTask(input.repository, context, result.targetTaskId);
        return input.coordinator.statusForTask(
          {
            chatId: context.openWebUi.chatId,
            userId: context.identity.userId,
            taskId: result.targetTaskId,
          },
          context.signal,
        );
      }
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
      if (result.targetTaskId !== undefined) {
        await touchResolvedTask(input.repository, context, result.targetTaskId);
      }
      return input.coordinator.followUp(
        {
          ...toFollowUpTurn(context, result.followUpAction),
          ...(result.targetTaskId === undefined
            ? {}
            : { targetTaskId: result.targetTaskId }),
        },
        context.signal,
      );
    }
    if (result.requestKind === "cancel") {
      if (result.targetTaskId !== undefined) {
        await touchResolvedTask(input.repository, context, result.targetTaskId);
      }
      return input.coordinator.cancel(
        {
          ...toTaskTurn(context),
          ...(result.targetTaskId === undefined
            ? {}
            : { targetTaskId: result.targetTaskId }),
        },
        context.signal,
      );
    }
    return renderGraphResult(result);
  };
  return async (context) =>
    legacyChatResultToInteractionEvents(await runLegacy(context), {
      runId: context.runId,
      threadId: context.threadId,
    });
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
  repository: ChatPersistenceRepository,
  context: ChatRunnerContext,
  taskId: string,
): Promise<void> {
  const binding = await repository.findAuthorizedTask({
    openWebUiChatId: context.openWebUi.chatId,
    userId: context.identity.userId,
    sdarTaskId: taskId,
  });
  if (binding === undefined) return;
  await repository.touchTaskReference({
    chatId: context.openWebUi.chatId,
    userId: context.identity.userId,
    bindingId: binding.bindingId,
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
function renderGraphResult(result: {
  readonly messages: readonly { readonly content: unknown }[];
}): string {
  const content = result.messages.at(-1)?.content;
  return typeof content === "string"
    ? content
    : "The response could not be rendered as conversational text.";
}
