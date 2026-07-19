import { z } from "zod";

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

/**
 * Stable local fallback until a configured chat-model backend is added.
 * It has no A2A, planning, workflow, tool, or MCP surface.
 */
export const localFallbackChatModel: StructuredChatModel = {
  async classify({ userText }) {
    return {
      requestKind: isExplicitTaskRequest(userText)
        ? "new_task"
        : "general_chat",
    };
  },
  async answer({ userText }) {
    const normalized = userText.trim();
    if (/^(hi|hello|hey|你好|您好)[!！,.，。 ]*$/iu.test(normalized)) {
      return "你好，我是单个 SDAR Agent 的聊天入口。你可以和我对话，或明确描述希望 SDAR 执行的任务。";
    }
    return "我已收到这条普通聊天消息。当前本地简化回答器未配置外部模型；如果你希望交给 SDAR 执行，请明确描述任务目标。";
  },
};
function isExplicitTaskRequest(userText: string): boolean {
  const text = userText.trim();
  return (
    /^(?:please\s+)?(?:(?:ask\s+)?sdar\s+(?:to\s+)?|sdar\s*[:,-]\s*)?(?:execute|run|perform|complete|create|inspect|analyze|prepare|build|verify)\b/iu.test(
      text,
    ) ||
    /^(?:请|请让\s*SDAR\s*)?(?:执行|完成|创建|检查|分析|准备|构建|验证)/u.test(
      text,
    )
  );
}
