import { AIMessage } from "@langchain/core/messages";
import { StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";

import { classifyTurn } from "./classification.js";
import {
  unavailableStructuredChatModel,
  type StructuredChatModel,
} from "./model.js";
import { StateAnnotation } from "./state.js";

export function createSingleAgentChatGraph(
  model: StructuredChatModel = unavailableStructuredChatModel,
  checkpointer?: BaseCheckpointSaver,
) {
  const normalizeRequest = async (
    state: typeof StateAnnotation.State,
  ): Promise<typeof StateAnnotation.Update> => {
    const content = state.messages.at(-1)?.content;
    return { userText: typeof content === "string" ? content : "" };
  };

  const classify = async (
    state: typeof StateAnnotation.State,
  ): Promise<typeof StateAnnotation.Update> => {
    const result = await classifyTurn(
      {
        userText: state.userText,
        utilityRequest: state.utilityRequest,
        ...(state.activeTask === undefined
          ? {}
          : { activeTask: state.activeTask }),
      },
      model,
    );
    return {
      requestKind: result.requestKind,
      followUpAction: result.followUpAction,
      lastError: result.error,
      responseFragments:
        result.blockedNewTask === true
          ? [
              "当前聊天已有活动中的 SDAR Task。请先查询状态、完成或明确取消当前任务，再创建新任务。",
            ]
          : [],
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
      return {
        responseFragments: [await model.answer({ userText: state.userText })],
      };
    }
    const labels = {
      new_task: "new SDAR task",
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
