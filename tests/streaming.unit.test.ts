import { describe, expect, it } from "@jest/globals";

import {
  createChatCompletionChunks,
  encodeChatCompletionStream,
} from "../packages/openai-api-contract/src/index.js";

describe("OpenAI-compatible SSE encoding", () => {
  it("encodes JSON data frames and one terminal DONE marker", () => {
    const chunks = createChatCompletionChunks({
      id: "chatcmpl-test",
      created: 1_234,
      model: "sdar-single-agent",
      content: "line one\nline two",
      includeUsage: true,
    });
    const encoded = encodeChatCompletionStream(chunks);

    expect(encoded.match(/data: \[DONE\]/gu)).toHaveLength(1);
    expect(encoded.endsWith("data: [DONE]\n\n")).toBe(true);
    expect(encoded).toContain("line one\\nline two");
    expect(encoded).not.toContain("data: line two");
    expect(chunks.at(-1)?.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });
});
