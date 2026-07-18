import { describe, expect, it } from "@jest/globals";

import { graph } from "../src/agent/graph.js";

describe("maintained LangGraph template baseline", () => {
  it("runs a deterministic graph without contacting SDAR", async () => {
    const result = await graph.invoke({
      messages: [{ role: "user", content: "ping" }],
    });
    const lastMessage = result.messages.at(-1);

    expect(lastMessage?.content).toBe(
      "single-agent-chat-server template baseline is running.",
    );
  });
});
