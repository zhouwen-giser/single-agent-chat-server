import type { ChatCompletionChunk } from "./chat-completions.js";

export const SSE_CONTENT_TYPE = "text/event-stream; charset=utf-8";

export function encodeSseData(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

export function encodeChatCompletionStream(
  chunks: readonly ChatCompletionChunk[],
): string {
  return `${chunks.map(encodeSseData).join("")}data: [DONE]\n\n`;
}
