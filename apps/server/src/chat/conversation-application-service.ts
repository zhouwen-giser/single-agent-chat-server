import type { BaseCheckpointSaver } from "@langchain/langgraph";

import {
  SdarTaskCoordinator,
  type FollowUpTurnContext,
  type TaskCoordinatorObserver,
  type TaskTurnContext,
} from "../../../../packages/chat-runtime/src/index.js";
import type {
  ClientHistoryImportResult,
  ClientHistoryMessage,
  ConversationContext,
  ConversationProtocol,
} from "../../../../packages/conversation-context/src/index.js";
import type { LegacyChatResult } from "../../../../packages/interaction-runtime/src/index.js";
import type { TaskBinding } from "../../../../packages/persistence/src/index.js";
import { createSingleAgentChatGraph } from "../../../../src/agent/graph.js";
import type { ClassificationError } from "../../../../src/agent/classification.js";
import type { StructuredChatModel } from "../../../../src/agent/model.js";

export interface ConversationApplicationRepository {
  listActiveTasksForChat(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly limit?: number;
  }): Promise<readonly TaskBinding[]>;
  findAuthorizedTask(input: {
    readonly openWebUiChatId: string;
    readonly userId: string;
    readonly sdarTaskId: string;
  }): Promise<TaskBinding | undefined>;
  touchTaskReference(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly bindingId: string;
  }): Promise<unknown>;
}

export interface ConversationApplicationTurn {
  readonly protocol: ConversationProtocol;
  readonly userText: string;
  readonly clientMessages: readonly ClientHistoryMessage[];
  readonly userId: string;
  readonly chatId: string;
  readonly threadId: string;
  readonly userMessageId: string;
  readonly currentUserExternalMessageId?: string;
  readonly utilityRequest: boolean;
  readonly coordinatorObserver?: TaskCoordinatorObserver;
  readonly signal?: AbortSignal;
}

export interface ConversationApplicationServiceOptions {
  readonly repository: ConversationApplicationRepository;
  readonly checkpointer?: BaseCheckpointSaver;
  readonly coordinator: SdarTaskCoordinator;
  readonly model?: StructuredChatModel;
  readonly onClassificationError?: (error: ClassificationError) => void;
  readonly assembleContext?: (input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly currentUserText: string;
    readonly currentUserMessageSequence?: number;
  }) => Promise<ConversationContext>;
  readonly importHistory?: (input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly protocol: ConversationProtocol;
    readonly requestId: string;
    readonly currentUserExternalMessageId: string;
    readonly messages: readonly ClientHistoryMessage[];
  }) => Promise<ClientHistoryImportResult>;
}

export class ConversationApplicationService {
  private readonly graph;

  constructor(private readonly options: ConversationApplicationServiceOptions) {
    this.graph = createSingleAgentChatGraph(
      options.model,
      options.checkpointer,
      options.onClassificationError,
    );
  }

  async execute(turn: ConversationApplicationTurn): Promise<LegacyChatResult> {
    const conversationContext = turn.utilityRequest
      ? fallbackContext(turn.threadId, [])
      : await this.prepareContext(turn);
    const result = await this.graph.invoke(
      {
        messages: [{ role: "user", content: turn.userText }],
        threadId: turn.threadId,
        userId: turn.userId,
        openWebUiChatId: turn.chatId,
        utilityRequest: turn.utilityRequest,
        conversationContext,
      },
      { configurable: { thread_id: turn.threadId } },
    );
    if (result.requestKind === "new_task") {
      const input = {
        ...toTaskTurn(turn),
        userText: result.taskText ?? turn.userText,
      };
      return turn.coordinatorObserver === undefined
        ? this.options.coordinator.submit(input, turn.signal)
        : this.options.coordinator.submit(
            input,
            turn.signal,
            turn.coordinatorObserver,
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
        await this.touchResolvedTask(turn, result.targetTaskId);
        const input = {
          chatId: turn.chatId,
          userId: turn.userId,
          taskId: result.targetTaskId,
        };
        return turn.coordinatorObserver === undefined
          ? this.options.coordinator.statusForTask(input, turn.signal)
          : this.options.coordinator.statusForTask(
              input,
              turn.signal,
              turn.coordinatorObserver,
            );
      }
      return this.options.coordinator.listTaskStatuses({
        chatId: turn.chatId,
        userId: turn.userId,
      });
    }
    if (result.requestKind === "follow_up") {
      if (
        result.followUpAction === undefined ||
        result.targetTaskId === undefined
      ) {
        return "No safe SDAR Follow-up action could be determined; nothing was sent.";
      }
      await this.touchResolvedTask(turn, result.targetTaskId);
      const input = {
        ...toFollowUpTurn(turn, result.followUpAction),
        taskId: result.targetTaskId,
      };
      return turn.coordinatorObserver === undefined
        ? this.options.coordinator.followUp(input, turn.signal)
        : this.options.coordinator.followUp(
            input,
            turn.signal,
            turn.coordinatorObserver,
          );
    }
    if (result.requestKind === "cancel") {
      if (result.targetTaskId === undefined) {
        return "No unique SDAR Task could be determined; no cancellation was sent.";
      }
      await this.touchResolvedTask(turn, result.targetTaskId);
      const input = { ...toTaskTurn(turn), taskId: result.targetTaskId };
      return turn.coordinatorObserver === undefined
        ? this.options.coordinator.cancel(input, turn.signal)
        : this.options.coordinator.cancel(
            input,
            turn.signal,
            turn.coordinatorObserver,
          );
    }
    return renderGraphResult(result);
  }

  private async prepareContext(
    turn: ConversationApplicationTurn,
  ): Promise<ConversationContext> {
    const imported = await this.options.importHistory?.({
      principalId: turn.userId,
      threadId: turn.threadId,
      protocol: turn.protocol,
      requestId: turn.userMessageId,
      currentUserExternalMessageId:
        turn.currentUserExternalMessageId ?? turn.userMessageId,
      messages: turn.clientMessages,
    });
    const activeBindings = await this.options.repository.listActiveTasksForChat(
      {
        chatId: turn.chatId,
        userId: turn.userId,
        limit: 32,
      },
    );
    return this.options.assembleContext === undefined
      ? fallbackContext(turn.threadId, activeBindings)
      : this.options.assembleContext({
          principalId: turn.userId,
          threadId: turn.threadId,
          currentUserText: turn.userText,
          ...(imported?.currentUserMessageSequence === undefined
            ? {}
            : {
                currentUserMessageSequence: imported.currentUserMessageSequence,
              }),
        });
  }

  private async touchResolvedTask(
    turn: ConversationApplicationTurn,
    taskId: string,
  ): Promise<void> {
    const binding = await this.options.repository.findAuthorizedTask({
      openWebUiChatId: turn.chatId,
      userId: turn.userId,
      sdarTaskId: taskId,
    });
    if (binding === undefined) return;
    await this.options.repository.touchTaskReference({
      chatId: turn.chatId,
      userId: turn.userId,
      bindingId: binding.bindingId,
    });
  }
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

function toTaskTurn(turn: ConversationApplicationTurn): TaskTurnContext {
  return {
    userText: turn.userText,
    userId: turn.userId,
    chatId: turn.chatId,
    userMessageId: turn.userMessageId,
  };
}

function toFollowUpTurn(
  turn: ConversationApplicationTurn,
  action: FollowUpTurnContext["action"],
): Omit<FollowUpTurnContext, "taskId"> {
  return { ...toTaskTurn(turn), action };
}

function renderGraphResult(result: {
  readonly messages: readonly { readonly content: unknown }[];
}): string {
  const content = result.messages.at(-1)?.content;
  return typeof content === "string"
    ? content
    : "The response could not be rendered as conversational text.";
}
