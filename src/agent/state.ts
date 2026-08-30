import type { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

import type { ConversationContext } from "../../packages/conversation-context/src/index.js";
import type { TaskSummary } from "../../packages/task-directory/src/index.js";
import type { TurnPlan } from "../../packages/world-grounding-contract/src/index.js";

export const requestKinds = [
  "utility",
  "general_chat",
  "world_answer",
  "grounded_task",
  "hybrid_compare",
  "new_task",
  "list_tasks",
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
  turnPlan: Annotation<TurnPlan | undefined>,
  followUpAction: Annotation<FollowUpAction | undefined>,
  activeTasks: Annotation<TaskSummary[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  recentTasks: Annotation<TaskSummary[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  focusedTaskId: Annotation<string | undefined>,
  lastReferencedTaskId: Annotation<string | undefined>,
  targetTaskId: Annotation<string | undefined>,
  taskText: Annotation<string | undefined>,
  includeTerminalTasks: Annotation<boolean>,
  conversationContext: Annotation<ConversationContext | undefined>,
  userText: Annotation<string>,
  responseFragments: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  lastError: Annotation<string | undefined>,
});

export type SingleAgentChatState = typeof StateAnnotation.State;
