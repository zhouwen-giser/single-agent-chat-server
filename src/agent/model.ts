import { z } from "zod";

import type {
  ConversationModel,
  TurnDecision,
} from "../../packages/conversation-model/src/index.js";
import { followUpActions, requestKinds } from "./state.js";

export const structuredTurnSchema = z
  .object({
    requestKind: z.enum(requestKinds),
    followUpAction: z.enum(followUpActions).optional(),
  })
  .strict()
  .superRefine((turn, context) => {
    if (turn.requestKind === "follow_up" && turn.followUpAction === undefined) {
      context.addIssue({
        code: "custom",
        path: ["followUpAction"],
        message: "follow_up requires an allowed followUpAction",
      });
    }
    if (turn.requestKind !== "follow_up" && turn.followUpAction !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["followUpAction"],
        message: "followUpAction is only valid for follow_up",
      });
    }
  });

export interface StructuredChatModel {
  classify(input: {
    readonly userText: string;
    readonly hasActiveTask: boolean;
  }): Promise<unknown>;
  answer(input: { readonly userText: string }): Promise<string>;
}

export function adaptConversationModel(
  model: ConversationModel,
): StructuredChatModel {
  return {
    async classify({ userText }) {
      const decision = (await model.decideTurn({
        context: emptyConversationContext,
        currentUserText: userText,
      })) as TurnDecision;
      return legacyDecision(decision);
    },
    answer: ({ userText }) =>
      model.answerGeneral({
        context: emptyConversationContext,
        currentUserText: userText,
      }),
  };
}

export const unavailableStructuredChatModel: StructuredChatModel = {
  classify: unavailable,
  answer: unavailable,
};

const emptyConversationContext = {
  threadId: "legacy-graph-bridge",
  messages: [],
  activeTasks: [],
  recentTerminalTasks: [],
} as const;

function legacyDecision(decision: TurnDecision): unknown {
  switch (decision.kind) {
    case "general_chat":
    case "clarification":
      return { requestKind: "general_chat" };
    case "new_task":
      return { requestKind: "new_task" };
    case "list_tasks":
    case "task_status":
      return { requestKind: "status" };
    case "task_follow_up":
      return {
        requestKind: "follow_up",
        followUpAction: decision.action,
      };
    case "task_cancel":
      return { requestKind: "cancel" };
  }
}

async function unavailable(): Promise<never> {
  throw new Error("Conversation model is not configured.");
}
