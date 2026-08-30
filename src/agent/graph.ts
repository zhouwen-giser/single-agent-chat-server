import { AIMessage } from "@langchain/core/messages";
import { StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";

import { classifyTurn } from "./classification.js";
import type { ClassificationError } from "./classification.js";
import {
  unavailableStructuredChatModel,
  type StructuredChatModel,
} from "./model.js";
import { StateAnnotation } from "./state.js";

export function createSingleAgentChatGraph(
  model: StructuredChatModel = unavailableStructuredChatModel,
  checkpointer?: BaseCheckpointSaver,
  onClassificationError?: (error: ClassificationError) => void,
) {
  const normalizeRequest = async (
    state: typeof StateAnnotation.State,
  ): Promise<typeof StateAnnotation.Update> => {
    const content = state.messages.at(-1)?.content;
    const userText = typeof content === "string" ? content : "";
    const conversationContext = state.conversationContext ?? {
      threadId: state.threadId,
      messages: [],
      activeTasks: state.activeTasks,
      recentTerminalTasks: state.recentTasks,
      ...(state.focusedTaskId === undefined
        ? {}
        : { focusedTaskId: state.focusedTaskId }),
      ...(state.lastReferencedTaskId === undefined
        ? {}
        : { lastReferencedTaskId: state.lastReferencedTaskId }),
    };
    return {
      userText,
      conversationContext,
      activeTasks: [...conversationContext.activeTasks],
      recentTasks: [...conversationContext.recentTerminalTasks],
      focusedTaskId: conversationContext.focusedTaskId,
      lastReferencedTaskId: conversationContext.lastReferencedTaskId,
    };
  };

  const classify = async (
    state: typeof StateAnnotation.State,
  ): Promise<typeof StateAnnotation.Update> => {
    const result = await classifyTurn(
      {
        currentUserText: state.userText,
        utilityRequest: state.utilityRequest,
        context:
          state.conversationContext ??
          (() => {
            throw new Error("Conversation context was not normalized");
          })(),
      },
      model,
    );
    if (result.error !== undefined) onClassificationError?.(result.error);
    return {
      requestKind: result.requestKind,
      turnPlan: result.turnPlan,
      followUpAction: result.followUpAction,
      targetTaskId: result.targetTaskId,
      taskText: result.taskText,
      includeTerminalTasks: result.includeTerminalTasks ?? false,
      lastError: result.error,
      responseFragments:
        result.responseText === undefined ? [] : [result.responseText],
    };
  };

  const respond = async (
    state: typeof StateAnnotation.State,
  ): Promise<typeof StateAnnotation.Update> => {
    if (state.responseFragments.length > 0) return {};
    if (state.requestKind === "utility") {
      return { responseFragments: ["Single SDAR chat"] };
    }
    if (state.requestKind === "general_chat") {
      const context = state.conversationContext;
      if (context === undefined) {
        throw new Error("Conversation context was not normalized");
      }
      return {
        responseFragments: [
          await model.answer({
            context,
            currentUserText: state.userText,
          }),
        ],
      };
    }
    if (
      ["world_answer", "grounded_task", "hybrid_compare"].includes(
        state.requestKind,
      )
    ) {
      return {
        responseFragments: [
          state.requestKind === "hybrid_compare"
            ? "AUTHORITY_FUSION_PREVIEW_UNAVAILABLE"
            : "WORLD_GROUNDING_RUNTIME_UNAVAILABLE",
        ],
      };
    }
    const labels = {
      new_task: "new SDAR task",
      list_tasks: "Task directory",
      status: "task status",
      follow_up: `task follow-up (${state.followUpAction ?? "invalid"})`,
      cancel: "task cancellation",
    } as const;
    const kind = state.requestKind as keyof typeof labels;
    return {
      responseFragments: [
        `Request classified as ${labels[kind]}. The A2A adapter is introduced in Phase 3; no SDAR operation was performed.`,
      ],
    };
  };

  const composeResponse = async (
    state: typeof StateAnnotation.State,
  ): Promise<typeof StateAnnotation.Update> => ({
    messages: [
      new AIMessage(
        state.responseFragments.join("\n").trim() ||
          "The request could not be composed safely.",
      ),
    ],
  });

  const builder = new StateGraph(StateAnnotation)
    .addNode("normalize_request", normalizeRequest)
    .addNode("classify_turn", classify)
    .addNode("respond_without_tools", respond)
    .addNode("compose_response", composeResponse)
    .addEdge("__start__", "normalize_request")
    .addEdge("normalize_request", "classify_turn")
    .addEdge("classify_turn", "respond_without_tools")
    .addEdge("respond_without_tools", "compose_response")
    .addEdge("compose_response", "__end__");

  const compiled = builder.compile(
    checkpointer === undefined ? {} : { checkpointer },
  );
  compiled.name = "Thin Single SDAR Chat Graph";
  return compiled;
}

export const graph = createSingleAgentChatGraph();
