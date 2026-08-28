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
import type { NormalizedTask } from "../../../../packages/sdar-a2a-adapter/src/index.js";
import type { TaskBinding } from "../../../../packages/persistence/src/index.js";
import { createSingleAgentChatGraph } from "../../../../src/agent/graph.js";
import type { ClassificationError } from "../../../../src/agent/classification.js";
import type { StructuredChatModel } from "../../../../src/agent/model.js";
import type { TurnPlan } from "../../../../packages/world-grounding-contract/src/index.js";

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
  readonly worldGrounding?: WorldGroundingApplication;
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

export interface WorldGroundingApplication {
  continuePendingChoice?(
    input: Omit<WorldGroundingTurn, "turnPlan">,
  ): Promise<string | undefined>;
  answerWorld(input: WorldGroundingTurn): Promise<string>;
  compareHybrid(input: HybridWorldGroundingTurn): Promise<string>;
  submitOperational(input: WorldGroundingTurn): Promise<string>;
}

export interface WorldGroundingTurn {
  readonly protocol: ConversationProtocol;
  readonly principalId: string;
  readonly threadId: string;
  readonly externalRequestId: string;
  readonly userText: string;
  readonly turnPlan: TurnPlan;
  readonly signal?: AbortSignal;
}

export interface HybridWorldGroundingTurn extends WorldGroundingTurn {
  readonly sdarPlan: {
    readonly taskId: string;
    readonly observedStatus: "INPUT_REQUIRED";
    readonly internalPhase: "awaiting_plan_confirmation";
    readonly publishedSummary: string;
  };
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
    if (
      !turn.utilityRequest &&
      this.options.worldGrounding?.continuePendingChoice !== undefined
    ) {
      const continuation =
        await this.options.worldGrounding.continuePendingChoice(
          toWorldGroundingControlTurn(turn),
        );
      if (continuation !== undefined) return continuation;
    }
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
    if (result.requestKind === "world_answer") {
      return this.options.worldGrounding === undefined ||
        result.turnPlan === undefined
        ? "WORLD_GROUNDING_RUNTIME_UNAVAILABLE"
        : this.options.worldGrounding.answerWorld(
            toWorldGroundingTurn(turn, result.turnPlan),
          );
    }
    if (result.requestKind === "grounded_task") {
      return this.options.worldGrounding === undefined ||
        result.turnPlan === undefined
        ? "SDAR_GROUNDING_EXTENSION_UNAVAILABLE"
        : this.options.worldGrounding.submitOperational(
            toWorldGroundingTurn(turn, result.turnPlan),
          );
    }
    if (result.requestKind === "hybrid_compare") {
      if (
        this.options.worldGrounding === undefined ||
        result.turnPlan === undefined ||
        result.targetTaskId === undefined
      ) {
        return "AUTHORITY_FUSION_PREVIEW_UNAVAILABLE";
      }
      const sdarPlan = await this.readPublishedPlanSnapshot(
        turn,
        result.targetTaskId,
      );
      if (sdarPlan === undefined) {
        return "AUTHORITY_FUSION_PLAN_UNAVAILABLE";
      }
      return this.options.worldGrounding.compareHybrid({
        ...toWorldGroundingTurn(turn, result.turnPlan),
        sdarPlan,
      });
    }
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

  private async readPublishedPlanSnapshot(
    turn: ConversationApplicationTurn,
    taskId: string,
  ): Promise<HybridWorldGroundingTurn["sdarPlan"] | undefined> {
    let observedTask: NormalizedTask | undefined;
    const fragments: string[] = [];
    let totalLength = 0;
    let invalid = false;
    const observer: TaskCoordinatorObserver = (observation) => {
      turn.coordinatorObserver?.(observation);
      if (observation.source !== "task") return;
      observedTask = observation.value;
      for (const fragment of observation.fragments) {
        if (fragments.length >= 128 || totalLength + fragment.length > 8_000) {
          invalid = true;
          return;
        }
        fragments.push(fragment);
        totalLength += fragment.length;
      }
    };
    for await (const fragment of this.options.coordinator.statusForTask(
      { chatId: turn.chatId, userId: turn.userId, taskId },
      turn.signal,
      observer,
    )) {
      // The observer is the authoritative published snapshot. Iteration ensures
      // the official A2A getTask() operation and persistence complete.
      void fragment;
    }
    const task = observedTask;
    const publishedSummary = fragments.join("\n").trim();
    if (
      invalid ||
      task === undefined ||
      task.taskId !== taskId ||
      task.state !== "INPUT_REQUIRED" ||
      task.internalPhase !== "awaiting_plan_confirmation" ||
      task.phaseMessage === undefined ||
      task.phaseMessage.trim() === "" ||
      publishedSummary.length === 0
    ) {
      return undefined;
    }
    return {
      taskId,
      observedStatus: task.state,
      internalPhase: task.internalPhase,
      publishedSummary,
    };
  }
}

function toWorldGroundingTurn(
  turn: ConversationApplicationTurn,
  turnPlan: TurnPlan,
): WorldGroundingTurn {
  return {
    protocol: turn.protocol,
    principalId: turn.userId,
    threadId: turn.threadId,
    externalRequestId: turn.userMessageId,
    userText: turn.userText,
    turnPlan,
    ...(turn.signal === undefined ? {} : { signal: turn.signal }),
  };
}

function toWorldGroundingControlTurn(
  turn: ConversationApplicationTurn,
): Omit<WorldGroundingTurn, "turnPlan"> {
  return {
    protocol: turn.protocol,
    principalId: turn.userId,
    threadId: turn.threadId,
    externalRequestId: turn.userMessageId,
    userText: turn.userText,
    ...(turn.signal === undefined ? {} : { signal: turn.signal }),
  };
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
