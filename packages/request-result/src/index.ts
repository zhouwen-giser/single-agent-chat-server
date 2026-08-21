import { z } from "zod";

import type { NormalizedMessage } from "../../sdar-a2a-adapter/src/index.js";

const normalizedPartSchema = z.strictObject({
  kind: z.enum(["text", "data", "url", "raw"]),
  mediaType: z.string().min(1).max(256),
  text: z.string().optional(),
  data: z.json().optional(),
  url: z.string().max(2_048).optional(),
});

export const normalizedMessageResultSchema = z.strictObject({
  messageId: z.string().min(1).max(256),
  taskId: z.string().min(1).max(256).optional(),
  contextId: z.string().min(1).max(256).optional(),
  role: z.enum(["USER", "AGENT", "UNSPECIFIED"]),
  parts: z.array(normalizedPartSchema).max(64),
});

export const completedRequestResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("task"),
    taskId: z.string().min(1).max(256),
    contextId: z.string().min(1).max(256),
  }),
  z.strictObject({
    kind: z.literal("message"),
    messageId: z.string().min(1).max(256),
    relatedTaskId: z.string().min(1).max(256).optional(),
    contextId: z.string().min(1).max(256).optional(),
    message: normalizedMessageResultSchema,
    renderedText: z.string().max(65_536),
  }),
]);

export type CompletedRequestResult =
  | {
      readonly kind: "task";
      readonly taskId: string;
      readonly contextId: string;
    }
  | {
      readonly kind: "message";
      readonly messageId: string;
      readonly relatedTaskId?: string;
      readonly contextId?: string;
      readonly message: NormalizedMessage;
      readonly renderedText: string;
    };

export function parseCompletedRequestResult(
  value: unknown,
): CompletedRequestResult {
  return completedRequestResultSchema.parse(value) as CompletedRequestResult;
}
