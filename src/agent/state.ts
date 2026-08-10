import type { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

export const requestKinds = [
  "utility",
  "general_chat",
  "new_task",
  "status",
  "follow_up",
  "cancel",
] as const;
export type RequestKind = (typeof requestKinds)[number];

export const followUpActions = [
  "confirm_plan",
  "reject_plan",
  "revise_plan",
  "patch_goal",
  "cancel_goal",
  "provide_input",
  "pause",
  "resume",
] as const;
export type FollowUpAction = (typeof followUpActions)[number];
export type InternalPhase =
  "awaiting_plan_confirmation" | "awaiting_user_input" | "paused";

export interface ActiveTaskSnapshot {
  readonly taskId: string;
  readonly contextId: string;
  readonly status: "SUBMITTED" | "WORKING" | "INPUT_REQUIRED";
  readonly internalPhase?: InternalPhase;
}

export const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[], BaseMessageLike[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  threadId: Annotation<string>,
  userId: Annotation<string>,
  openWebUiChatId: Annotation<string>,
  utilityRequest: Annotation<boolean>,
  requestKind: Annotation<RequestKind>,
  followUpAction: Annotation<FollowUpAction | undefined>,
  activeTask: Annotation<ActiveTaskSnapshot | undefined>,
  userText: Annotation<string>,
  responseFragments: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  lastError: Annotation<string | undefined>,
});

export type SingleAgentChatState = typeof StateAnnotation.State;
