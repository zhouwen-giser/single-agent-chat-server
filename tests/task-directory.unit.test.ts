import { describe, expect, it } from "@jest/globals";

import {
  resolveTaskSelector,
  type TaskDirectorySnapshot,
  type TaskSelector,
  type TaskSummary,
} from "../packages/task-directory/src/index.js";

const alpha = task("task-alpha-full", "alpha001", "Alpha audit", false);
const bravo = task("task-bravo-full", "bravo02", "Bravo rollout", false);
const previous = task("task-previous", "prev0001", "Previous audit", true);

describe("deterministic Task selector", () => {
  const selectorCases: Array<[TaskSelector, string]> = [
    [{ taskId: alpha.taskId }, alpha.taskId],
    [{ shortId: bravo.shortId }, bravo.taskId],
    [{ ordinal: 2 }, bravo.taskId],
    [{ reference: "focused" }, bravo.taskId],
    [{ reference: "latest" }, alpha.taskId],
    [{ reference: "previous" }, previous.taskId],
  ];

  it.each(selectorCases)("resolves %j", (selector, expectedTaskId) => {
    expect(resolveTaskSelector(selector, directory())).toMatchObject({
      outcome: "resolved",
      task: { taskId: expectedTaskId },
    });
  });

  it("matches a unique bounded summary and rejects ambiguous summaries", () => {
    expect(
      resolveTaskSelector({ summaryQuery: "bravo rollout" }, directory()),
    ).toMatchObject({ outcome: "resolved", task: { taskId: bravo.taskId } });
    expect(
      resolveTaskSelector(
        { summaryQuery: "audit" },
        directory({
          activeTasks: [alpha, { ...bravo, summary: "Secondary audit" }],
          recentTerminalTasks: [],
        }),
      ),
    ).toMatchObject({
      outcome: "ambiguous",
      candidates: [{ taskId: alpha.taskId }, { taskId: bravo.taskId }],
    });
  });

  it("resolves only_active only when exactly one active Task exists", () => {
    expect(
      resolveTaskSelector(
        { reference: "only_active" },
        directory({ activeTasks: [alpha] }),
      ),
    ).toMatchObject({ outcome: "resolved", task: alpha });
    expect(
      resolveTaskSelector({ reference: "only_active" }, directory()),
    ).toMatchObject({ outcome: "ambiguous" });
  });

  it("returns not_found without guessing", () => {
    expect(resolveTaskSelector({ shortId: "missing" }, directory())).toEqual({
      outcome: "not_found",
    });
    expect(resolveTaskSelector({ ordinal: 99 }, directory())).toEqual({
      outcome: "not_found",
    });
  });
});

function directory(
  overrides: Partial<TaskDirectorySnapshot> = {},
): TaskDirectorySnapshot {
  return {
    activeTasks: [alpha, bravo],
    recentTerminalTasks: [previous],
    focusedTaskId: bravo.taskId,
    lastReferencedTaskId: alpha.taskId,
    ...overrides,
  };
}

function task(
  taskId: string,
  shortId: string,
  summary: string,
  terminal: boolean,
): TaskSummary {
  return {
    bindingId: `binding-${shortId}`,
    taskId,
    contextId: `context-${shortId}`,
    shortId,
    status: terminal ? "COMPLETED" : "WORKING",
    summary,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...(terminal ? { terminalAt: "2026-08-21T00:01:00.000Z" } : {}),
  };
}
