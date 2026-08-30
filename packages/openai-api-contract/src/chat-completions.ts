import { z } from "zod";

const contentPartSchema = z.record(z.string(), z.unknown());
const worldSelectionIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export const chatMessageSchema = z
  .object({
    role: z.enum(["system", "developer", "user", "assistant", "tool"]),
    content: z.union([
      z.string().max(1_000_000),
      z.array(contentPartSchema).max(128),
      z.null(),
    ]),
    name: z.string().min(1).max(128).optional(),
    id: z.string().min(1).max(256).optional(),
    message_id: z.string().min(1).max(256).optional(),
    tool_call_id: z.string().min(1).max(256).optional(),
  })
  .passthrough();

export const chatCompletionRequestSchema = z
  .object({
    model: z.string().min(1).max(256),
    messages: z.array(chatMessageSchema).min(1).max(128),
    stream: z.boolean().default(false),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_tokens: z.number().int().positive().max(32_768).optional(),
    max_completion_tokens: z.number().int().positive().max(32_768).optional(),
    stop: z
      .union([z.string().max(1024), z.array(z.string().max(1024)).max(4)])
      .optional(),
    user: z.string().min(1).max(256).optional(),
    sacs_world_selection_ids: z
      .array(worldSelectionIdSchema)
      .max(32)
      .refine((values) => new Set(values).size === values.length)
      .optional(),
    stream_options: z
      .object({ include_usage: z.boolean().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .superRefine((request, context) => {
    if (
      request.max_tokens !== undefined &&
      request.max_completion_tokens !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["max_completion_tokens"],
        message: "max_tokens and max_completion_tokens are mutually exclusive",
      });
    }
  });

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

export interface ChatCompletionUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
}

export interface ChatCompletionResponse {
  readonly id: string;
  readonly object: "chat.completion";
  readonly created: number;
  readonly model: string;
  readonly choices: readonly [
    {
      readonly index: 0;
      readonly message: {
        readonly role: "assistant";
        readonly content: string;
      };
      readonly finish_reason: "stop";
    },
  ];
  readonly usage: ChatCompletionUsage;
}

export interface ChatCompletionChunk {
  readonly id: string;
  readonly object: "chat.completion.chunk";
  readonly created: number;
  readonly model: string;
  readonly choices: readonly {
    readonly index: 0;
    readonly delta: Readonly<{ role?: "assistant"; content?: string }>;
    readonly finish_reason: "stop" | null;
  }[];
  readonly usage?: ChatCompletionUsage;
}

export const emptyUsage: ChatCompletionUsage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
};

export function createChatCompletionResponse(input: {
  readonly id: string;
  readonly created: number;
  readonly model: string;
  readonly content: string;
}): ChatCompletionResponse {
  return {
    id: input.id,
    object: "chat.completion",
    created: input.created,
    model: input.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: input.content },
        finish_reason: "stop",
      },
    ],
    usage: emptyUsage,
  };
}

export function createChatCompletionChunks(input: {
  readonly id: string;
  readonly created: number;
  readonly model: string;
  readonly content: string;
  readonly includeUsage: boolean;
}): readonly ChatCompletionChunk[] {
  const common = {
    id: input.id,
    object: "chat.completion.chunk" as const,
    created: input.created,
    model: input.model,
  };
  return [
    {
      ...common,
      choices: [
        { index: 0, delta: { role: "assistant" }, finish_reason: null },
      ],
    },
    {
      ...common,
      choices: [
        { index: 0, delta: { content: input.content }, finish_reason: null },
      ],
    },
    {
      ...common,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
    ...(input.includeUsage
      ? [{ ...common, choices: [], usage: emptyUsage }]
      : []),
  ];
}
