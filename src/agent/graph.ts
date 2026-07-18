import { StateGraph } from "@langchain/langgraph";

import { StateAnnotation } from "./state.js";

const templateNode = async (): Promise<typeof StateAnnotation.Update> => ({
  messages: [
    {
      role: "assistant",
      content: "single-agent-chat-server template baseline is running.",
    },
  ],
});

const builder = new StateGraph(StateAnnotation)
  .addNode("templateNode", templateNode)
  .addEdge("__start__", "templateNode")
  .addEdge("templateNode", "__end__");

/**
 * Studio-only Phase 0 graph. It performs no SDAR operation and is not the
 * OpenAI-compatible production server.
 */
export const graph = builder.compile();
graph.name = "Single SDAR Chat Template Baseline";
