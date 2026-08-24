import { z } from "zod";

import type { NormalizedMessage } from "../../sdar-a2a-adapter/src/index.js";

const normalizedPartSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    mediaType: z.string().min(1).max(256),
    text: z.string().max(65_536),
  }),
  z.strictObject({
    kind: z.literal("data"),
    mediaType: z.string().min(1).max(256),
    data: z.json(),
  }),
  z.strictObject({
    kind: z.literal("url"),
    mediaType: z.string().min(1).max(256),
    url: z
      .string()
      .url()
      .max(2_048)
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
  }),
]);

export const normalizedMessageResultSchema = z.strictObject({
  messageId: z.string().min(1).max(256),
  taskId: z.string().min(1).max(256).optional(),
  contextId: z.string().min(1).max(256).optional(),
  role: z.literal("AGENT"),
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
  const result = completedRequestResultSchema.parse(value);
  if (
    result.kind === "message" &&
    result.message.messageId !== result.messageId
  ) {
    throw new Error("Completed Message result changed Message identity");
  }
  if (JSON.stringify(result).length > 262_144) {
    throw new Error("Completed request result exceeds the persistence budget");
  }
  return result as CompletedRequestResult;
}
