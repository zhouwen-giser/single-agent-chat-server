import { describe, expect, it } from "@jest/globals";

import { graph } from "../src/agent/graph.js";

describe("LangGraph compiled graph", () => {
  it("preserves input and appends the template response", async () => {
    const result = await graph.invoke({ messages: ["hello"] });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?._getType()).toBe("human");
    expect(result.messages[1]?._getType()).toBe("ai");
  });
});
