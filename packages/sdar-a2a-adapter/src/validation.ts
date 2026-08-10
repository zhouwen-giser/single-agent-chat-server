import { z } from "zod";

import { followUpActionValues, type JsonValue } from "./types.js";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const absoluteHttpUrl = z
  .string()
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "must use http or https",
  });

export const adapterConfigSchema = z.object({
  baseUrl: absoluteHttpUrl,
  endpointOverride: absoluteHttpUrl.optional(),
  discoveryTimeoutMs: z.number().int().min(100).max(120_000).default(10_000),
  operationTimeoutMs: z.number().int().min(100).max(300_000).default(30_000),
});

export const submitTaskInputSchema = z
  .object({
    messageId: z.string().min(1).max(256),
    text: z.string().trim().min(1).max(1_000_000),
    userId: z.string().min(1).max(256).optional(),
    structuredInput: jsonValueSchema.optional(),
  })
  .strict();

export const followUpInputSchema = z
  .object({
    messageId: z.string().min(1).max(256),
    taskId: z.string().min(1).max(256),
    contextId: z.string().min(1).max(256),
    action: z.enum(followUpActionValues),
    text: z.string().max(1_000_000),
    inputRequestId: z.string().min(1).max(256).optional(),
    userId: z.string().min(1).max(256).optional(),
    data: jsonValueSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.action !== "provide_input" && input.data !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["data"],
        message: "data is only allowed for provide_input",
      });
    }
    if (input.text.trim().length === 0 && input.data === undefined) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "text or data is required",
      });
    }
  });
