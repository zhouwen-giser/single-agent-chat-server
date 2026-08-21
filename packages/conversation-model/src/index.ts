import { z } from "zod";

import type { ConversationContext } from "../../conversation-context/src/index.js";
import {
  taskSelectorSchema,
  type TaskSelector,
} from "../../task-directory/src/index.js";

export const conversationFollowUpActions = [
  "confirm_plan",
  "reject_plan",
  "revise_plan",
  "patch_goal",
  "cancel_goal",
  "provide_input",
  "pause",
  "resume",
] as const;

export const turnDecisionKinds = [
  "general_chat",
  "new_task",
  "list_tasks",
  "task_status",
  "task_follow_up",
  "task_cancel",
  "clarification",
] as const;

export const turnDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("general_chat") }),
  z.strictObject({
    kind: z.literal("new_task"),
    taskText: z.string().min(1).max(32_768),
  }),
  z.strictObject({
    kind: z.literal("list_tasks"),
    includeTerminal: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("task_status"),
    selector: taskSelectorSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("task_follow_up"),
    selector: taskSelectorSchema,
    action: z.enum(conversationFollowUpActions),
    text: z.string().min(1).max(32_768),
  }),
  z.strictObject({
    kind: z.literal("task_cancel"),
    selector: taskSelectorSchema,
  }),
  z.strictObject({
    kind: z.literal("clarification"),
    question: z.string().min(1).max(4_000),
  }),
]);

export type TurnDecision = z.infer<typeof turnDecisionSchema>;

export interface ConversationModelInput {
  readonly context: ConversationContext;
  readonly currentUserText: string;
}

export interface ConversationSummaryInput {
  readonly threadId: string;
  readonly previousSummary?: string;
  readonly messages: ConversationContext["messages"];
  readonly summarizedThroughSequence?: number;
}

export interface PublishedResultInput {
  readonly context: ConversationContext;
  readonly taskId?: string;
  readonly renderedText: string;
}

export interface ConversationModel {
  decideTurn(input: ConversationModelInput): Promise<unknown>;
  answerGeneral(input: ConversationModelInput): Promise<string>;
  summarize(input: ConversationSummaryInput): Promise<string>;
  explainPublishedResult?(input: PublishedResultInput): Promise<string>;
}

export function parseTurnDecision(value: unknown): TurnDecision {
  return turnDecisionSchema.parse(value);
}

export type { TaskSelector };
