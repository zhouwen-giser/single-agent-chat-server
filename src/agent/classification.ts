import {
  turnDecisionSchema,
  type ConversationModelInput,
} from "../../packages/conversation-model/src/index.js";
import {
  resolveTaskSelector,
  type TaskDirectorySnapshot,
  type TaskSummary,
} from "../../packages/task-directory/src/index.js";
import type { StructuredChatModel } from "./model.js";
import type { FollowUpAction, RequestKind } from "./state.js";

export interface ClassificationInput extends ConversationModelInput {
  readonly utilityRequest: boolean;
}

export interface ClassificationResult {
  readonly requestKind: RequestKind;
  readonly followUpAction?: FollowUpAction;
  readonly targetTaskId?: string;
  readonly taskText?: string;
  readonly includeTerminalTasks?: boolean;
  readonly responseText?: string;
  readonly error?:
    | "invalid_structured_classification"
    | "invalid_state_classification"
    | "conversation_model_unavailable"
    | "task_reference_not_found"
    | "ambiguous_task_reference";
}

export type ClassificationError = NonNullable<ClassificationResult["error"]>;

export async function classifyTurn(
  input: ClassificationInput,
  model: StructuredChatModel,
): Promise<ClassificationResult> {
  if (input.utilityRequest) return { requestKind: "utility" };

  let rawDecision: unknown;
  try {
    rawDecision = await model.decideTurn({
      context: input.context,
      currentUserText: input.currentUserText.trim(),
    });
  } catch {
    return {
      requestKind: "general_chat",
      responseText:
        "The conversation model is unavailable, so no SDAR operation was started.",
      error: "conversation_model_unavailable",
    };
  }
  const parsed = turnDecisionSchema.safeParse(rawDecision);
  if (!parsed.success) {
    return {
      requestKind: "general_chat",
      responseText:
        "I could not determine a safe action from that request. Please clarify what you want to do; no SDAR operation was started.",
      error: "invalid_structured_classification",
    };
  }

  const decision = parsed.data;
  switch (decision.kind) {
    case "general_chat":
      return { requestKind: "general_chat" };
    case "clarification":
      return {
        requestKind: "general_chat",
        responseText: decision.question,
      };
    case "new_task":
      return { requestKind: "new_task", taskText: decision.taskText };
    case "list_tasks":
      return {
        requestKind: "list_tasks",
        includeTerminalTasks: decision.includeTerminal,
      };
    case "task_status":
      return classifyStatus(decision.selector, directory(input));
    case "task_follow_up":
      return classifyMutable(
        "follow_up",
        decision.selector,
        directory(input),
        decision.action,
      );
    case "task_cancel":
      return classifyMutable("cancel", decision.selector, directory(input));
  }
}

function classifyStatus(
  selector: Parameters<typeof resolveTaskSelector>[0] | undefined,
  directorySnapshot: TaskDirectorySnapshot,
): ClassificationResult {
  if (selector === undefined) {
    if (directorySnapshot.activeTasks.length > 1) {
      return { requestKind: "list_tasks", includeTerminalTasks: false };
    }
    if (directorySnapshot.activeTasks.length === 0) {
      return { requestKind: "status" };
    }
    return {
      requestKind: "status",
      targetTaskId: directorySnapshot.activeTasks[0]?.taskId,
    };
  }
  const resolution = resolveTaskSelector(selector, directorySnapshot);
  if (resolution.outcome === "resolved") {
    return { requestKind: "status", targetTaskId: resolution.task.taskId };
  }
  return resolutionFailure(
    resolution.outcome,
    resolution.outcome === "ambiguous" ? resolution.candidates : undefined,
  );
}

function classifyMutable(
  requestKind: "follow_up" | "cancel",
  selector: Parameters<typeof resolveTaskSelector>[0],
  directorySnapshot: TaskDirectorySnapshot,
  followUpAction?: FollowUpAction,
): ClassificationResult {
  const resolution = resolveTaskSelector(selector, directorySnapshot);
  if (resolution.outcome !== "resolved") {
    return resolutionFailure(
      resolution.outcome,
      resolution.outcome === "ambiguous" ? resolution.candidates : undefined,
    );
  }
  return {
    requestKind,
    targetTaskId: resolution.task.taskId,
    ...(followUpAction === undefined ? {} : { followUpAction }),
  };
}

function resolutionFailure(
  outcome: "ambiguous" | "not_found",
  candidates?: readonly TaskSummary[],
): ClassificationResult {
  if (outcome === "ambiguous") {
    return {
      requestKind: "general_chat",
      responseText: renderClarification(candidates ?? []),
      error: "ambiguous_task_reference",
    };
  }
  return {
    requestKind: "general_chat",
    responseText:
      "I could not find that Task in this conversation. Use its full Task ID or a short ID from the Task list; nothing was sent.",
    error: "task_reference_not_found",
  };
}

function directory(input: ClassificationInput): TaskDirectorySnapshot {
  return {
    activeTasks: [...input.context.activeTasks],
    recentTerminalTasks: [...input.context.recentTerminalTasks],
    ...(input.context.focusedTaskId === undefined
      ? {}
      : { focusedTaskId: input.context.focusedTaskId }),
    ...(input.context.lastReferencedTaskId === undefined
      ? {}
      : { lastReferencedTaskId: input.context.lastReferencedTaskId }),
  };
}

function renderClarification(candidates: readonly TaskSummary[]): string {
  return [
    "That reference matches multiple Tasks. Name exactly one; nothing was sent.",
    ...candidates.map(
      (task) =>
        `- ${task.shortId}: ${task.status}${task.summary === undefined ? "" : ` — ${task.summary}`}`,
    ),
  ].join("\n");
}
