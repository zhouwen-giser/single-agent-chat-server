import { describe, expect, it } from "@jest/globals";

import { createSingleAgentChatGraph } from "../src/agent/graph.js";
import type { StructuredChatModel } from "../src/agent/model.js";

const fixtureModel: StructuredChatModel = {
  decideTurn: async () => ({ kind: "general_chat" }),
  answer: async () => "fixture response",
};

describe("LangGraph compiled graph", () => {
  it("preserves input and appends a safe local response", async () => {
    const result = await createSingleAgentChatGraph(fixtureModel).invoke({
      messages: ["hello"],
      utilityRequest: false,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?._getType()).toBe("human");
    expect(result.messages[1]?._getType()).toBe("ai");
    expect(result.requestKind).toBe("general_chat");
  });
});
