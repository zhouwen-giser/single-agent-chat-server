import { describe, expect, it } from "@jest/globals";
import {
  isFrozenSourceContinuation,
  isIndependentSdarMutation,
} from "../apps/server/src/chat/frozen-source-policy.js";
import type { WorldGroundingMutationTurn } from "../packages/world-grounding-runtime/src/index.js";

const turn: WorldGroundingMutationTurn = {
  protocol: "openai",
  principalId: "principal",
  threadId: "thread",
  externalRequestId: "message",
  userText: "让车去那里",
  requestKind: "new_task",
  explicitTaskReference: false,
};

describe("source-bound routing and independent mutation provenance", () => {
  it.each([
    "采用第二个",
    "第二个",
    "将第二个作为历史返回目标",
    "聚焦地图",
    "展开卡片",
    "排除暂停重新查询",
  ])("recognizes a narrow source command %s", (text) => {
    expect(isFrozenSourceContinuation(text)).toBe(true);
  });
  it.each([
    "把回答改为中文",
    "第一个例子是什么意思",
    "解释这个位置参数",
    "重新查询任务状态",
    "不要采用第二个",
    "解释‘让车前往那里’这句话",
  ])("leaves ordinary/negative/quoted text to classification %s", (text) => {
    expect(isFrozenSourceContinuation(text)).toBe(false);
  });
  it.each([
    "让车去那里",
    "让车过去",
    "让无人车到刚才的位置",
    "Drive the vehicle there",
    "Send the robot to that candidate",
    "让机器人 go there",
    "创建独立任务：让车去那里",
    "start an independent task: go there",
  ])("cannot authorize a historical/unbound target with %s", (userText) => {
    expect(isIndependentSdarMutation({ ...turn, userText })).toBe(false);
  });
  it.each([
    "创建独立任务：巡检仓库",
    "start an independent task: inspect the warehouse",
  ])("accepts an explicit independent task %s", (userText) => {
    expect(
      isIndependentSdarMutation({ ...turn, userText, taskText: userText }),
    ).toBe(true);
  });
  it("accepts the exact independent body, but rejects a model-authored target rewrite", () => {
    const userText = "创建独立任务：巡检仓库";
    expect(
      isIndependentSdarMutation({ ...turn, userText, taskText: "巡检仓库" }),
    ).toBe(true);
    expect(
      isIndependentSdarMutation({
        ...turn,
        userText,
        taskText: "前往坐标 120,30",
      }),
    ).toBe(false);
    expect(
      isIndependentSdarMutation({ ...turn, userText, taskText: "drive there" }),
    ).toBe(false);
  });
  it("allows an authorized explicit Task reference but rejects a world-target addition", () => {
    expect(
      isIndependentSdarMutation({
        ...turn,
        requestKind: "follow_up",
        userText: "继续 task-owned",
        explicitTaskReference: true,
      }),
    ).toBe(true);
    expect(
      isIndependentSdarMutation({
        ...turn,
        requestKind: "follow_up",
        userText: "让 task-owned 去那里",
        explicitTaskReference: true,
      }),
    ).toBe(false);
  });
  it.each<{ requestKind: "follow_up" | "cancel"; userText: string }>([
    { requestKind: "follow_up", userText: "确认当前方案" },
    { requestKind: "follow_up", userText: "resume the task" },
    { requestKind: "cancel", userText: "取消当前任务" },
    { requestKind: "cancel", userText: "cancel the current task" },
  ])(
    "permits independent Task control $requestKind $userText",
    ({ requestKind, userText }) => {
      expect(
        isIndependentSdarMutation({ ...turn, requestKind, userText }),
      ).toBe(true);
    },
  );
});
