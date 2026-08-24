import { z } from "zod";

import type { ConversationContextBudget } from "./index.js";

const contextEnvironmentSchema = z.object({
  CONVERSATION_MAX_RECENT_MESSAGES: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30),
  CONVERSATION_MAX_CONTEXT_CHARS: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(60_000)
    .default(60_000),
  CONVERSATION_SUMMARY_TRIGGER_CHARS: z.coerce
    .number()
    .int()
    .min(512)
    .max(1_000_000)
    .default(45_000),
  CONVERSATION_MAX_TASK_SUMMARY_CHARS: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000)
    .default(1_000),
});

export function parseConversationContextBudget(
  environment: NodeJS.ProcessEnv,
): ConversationContextBudget {
  const parsed = contextEnvironmentSchema.parse(environment);
  if (
    parsed.CONVERSATION_SUMMARY_TRIGGER_CHARS >
    parsed.CONVERSATION_MAX_CONTEXT_CHARS
  ) {
    throw new Error(
      "CONVERSATION_SUMMARY_TRIGGER_CHARS cannot exceed the context budget",
    );
  }
  return {
    maxRecentMessages: parsed.CONVERSATION_MAX_RECENT_MESSAGES,
    maxContextCharacters: parsed.CONVERSATION_MAX_CONTEXT_CHARS,
    summaryTriggerCharacters: parsed.CONVERSATION_SUMMARY_TRIGGER_CHARS,
    maxTaskSummaryCharacters: parsed.CONVERSATION_MAX_TASK_SUMMARY_CHARS,
  };
}
