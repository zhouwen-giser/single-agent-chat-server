import { structuredTurnSchema, type StructuredChatModel } from "./model.js";
import type {
  ActiveTaskSnapshot,
  FollowUpAction,
  RequestKind,
} from "./state.js";

export interface ClassificationInput {
  readonly userText: string;
  readonly utilityRequest: boolean;
  readonly activeTask?: ActiveTaskSnapshot;
}
export interface ClassificationResult {
  readonly requestKind: RequestKind;
  readonly followUpAction?: FollowUpAction;
  readonly error?:
    "invalid_structured_classification" | "invalid_state_classification";
  readonly blockedNewTask?: boolean;
}

export async function classifyTurn(
  input: ClassificationInput,
  model: StructuredChatModel,
): Promise<ClassificationResult> {
  const text = input.userText.trim();
  if (input.utilityRequest) return { requestKind: "utility" };
  if (
    /(?:\u8fdb\u5ea6|\u72b6\u6001|\u600e\u4e48\u6837\u4e86|status|progress)/iu.test(
      text,
    )
  ) {
    return { requestKind: "status" };
  }
  if (
    /(?:\u53d6\u6d88(?:\u5f53\u524d|\u8fd9\u4e2a)?\u4efb\u52a1|cancel (?:the )?task)/iu.test(
      text,
    )
  ) {
    return { requestKind: "cancel" };
  }

  const guardedAction = classifyGuardedFollowUp(text, input.activeTask);
  if (guardedAction !== undefined) {
    return { requestKind: "follow_up", followUpAction: guardedAction };
  }

  const parsed = structuredTurnSchema.safeParse(
    await model.classify({
      userText: text,
      hasActiveTask: input.activeTask !== undefined,
    }),
  );
  if (!parsed.success) {
    return {
      requestKind: "general_chat",
      error: "invalid_structured_classification",
    };
  }
  if (parsed.data.requestKind === "utility") {
    return {
      requestKind: "general_chat",
      error: "invalid_state_classification",
    };
  }
  if (
    input.activeTask !== undefined &&
    parsed.data.requestKind === "new_task"
  ) {
    return { requestKind: "general_chat", blockedNewTask: true };
  }
  if (
    parsed.data.requestKind === "follow_up" &&
    !isActionAllowedForTask(parsed.data.followUpAction, input.activeTask)
  ) {
    return {
      requestKind: "general_chat",
      error: "invalid_state_classification",
    };
  }
  return parsed.data;
}

function classifyGuardedFollowUp(
  text: string,
  task: ActiveTaskSnapshot | undefined,
): FollowUpAction | undefined {
  if (task?.status === "INPUT_REQUIRED") {
    if (task.internalPhase === "awaiting_plan_confirmation") {
      if (
        /^(?:\u786e\u8ba4|\u540c\u610f|\u6279\u51c6|confirm|approve)/iu.test(
          text,
        )
      ) {
        return "confirm_plan";
      }
      if (/^(?:\u62d2\u7edd|\u4e0d\u540c\u610f|reject)/iu.test(text))
        return "reject_plan";
      if (
        /(?:\u4fee\u6539\u8ba1\u5212|\u8c03\u6574\u8ba1\u5212|revise (?:the )?plan)/iu.test(
          text,
        )
      ) {
        return "revise_plan";
      }
      if (
        /(?:\u4fee\u6539\u76ee\u6807|\u8c03\u6574\u76ee\u6807|patch (?:the )?goal)/iu.test(
          text,
        )
      ) {
        return "patch_goal";
      }
      return undefined;
    }
    if (task.internalPhase === "awaiting_user_input" && text.length > 0) {
      return "provide_input";
    }
    if (task.internalPhase === "paused") {
      return /(?:\u6062\u590d|\u7ee7\u7eed\u6267\u884c|resume)/iu.test(text)
        ? "resume"
        : undefined;
    }
  }
  if (task !== undefined && /(?:\u6682\u505c|pause)/iu.test(text))
    return "pause";
  if (
    task !== undefined &&
    /(?:\u6062\u590d|\u7ee7\u7eed\u6267\u884c|resume)/iu.test(text)
  ) {
    return "resume";
  }
  if (
    task !== undefined &&
    /(?:\u4fee\u6539\u76ee\u6807|patch (?:the )?goal)/iu.test(text)
  ) {
    return "patch_goal";
  }
  return undefined;
}

function isActionAllowedForTask(
  action: FollowUpAction | undefined,
  task: ActiveTaskSnapshot | undefined,
): boolean {
  if (action === undefined || task === undefined) return false;
  if (task.status !== "INPUT_REQUIRED") {
    return ["patch_goal", "cancel_goal", "pause", "resume"].includes(action);
  }
  if (task.internalPhase === "awaiting_plan_confirmation") {
    return [
      "confirm_plan",
      "reject_plan",
      "revise_plan",
      "patch_goal",
    ].includes(action);
  }
  if (task.internalPhase === "awaiting_user_input") {
    return action === "provide_input";
  }
  if (task.internalPhase === "paused") return action === "resume";
  return false;
}
