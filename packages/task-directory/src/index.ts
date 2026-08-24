import { z } from "zod";

export const taskSelectorSchema = z.union([
  z.strictObject({ taskId: z.string().min(1).max(256) }),
  z.strictObject({ shortId: z.string().min(1).max(64) }),
  z.strictObject({ ordinal: z.number().int().min(1).max(100) }),
  z.strictObject({
    reference: z.enum(["focused", "latest", "previous", "only_active"]),
  }),
  z.strictObject({ summaryQuery: z.string().min(1).max(256) }),
]);

export type TaskSelector = z.infer<typeof taskSelectorSchema>;

export const taskSummarySchema = z.strictObject({
  bindingId: z.string().min(1).max(256),
  taskId: z.string().min(1).max(256),
  contextId: z.string().min(1).max(256),
  shortId: z.string().min(1).max(64),
  status: z.string().min(1).max(64),
  internalPhase: z.string().max(256).optional(),
  summary: z.string().max(1_000).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  terminalAt: z.iso.datetime({ offset: true }).optional(),
});

export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const taskDirectorySnapshotSchema = z.strictObject({
  focusedTaskId: z.string().min(1).max(256).optional(),
  lastReferencedTaskId: z.string().min(1).max(256).optional(),
  activeTasks: z.array(taskSummarySchema).max(32),
  recentTerminalTasks: z.array(taskSummarySchema).max(32),
});

export type TaskDirectorySnapshot = z.infer<typeof taskDirectorySnapshotSchema>;

export function parseTaskSelector(value: unknown): TaskSelector {
  return taskSelectorSchema.parse(value);
}

export function parseTaskDirectorySnapshot(
  value: unknown,
): TaskDirectorySnapshot {
  return taskDirectorySnapshotSchema.parse(value);
}

export type TaskResolution =
  | { readonly outcome: "resolved"; readonly task: TaskSummary }
  | {
      readonly outcome: "ambiguous";
      readonly candidates: readonly TaskSummary[];
    }
  | { readonly outcome: "not_found" };

export function resolveTaskSelector(
  selector: TaskSelector,
  directory: TaskDirectorySnapshot,
): TaskResolution {
  const tasks = allDirectoryTasks(directory);
  if ("taskId" in selector) {
    return one(tasks.filter((task) => task.taskId === selector.taskId));
  }
  if ("shortId" in selector) {
    return one(tasks.filter((task) => task.shortId === selector.shortId));
  }
  if ("ordinal" in selector) {
    const task = tasks[selector.ordinal - 1];
    return task === undefined
      ? { outcome: "not_found" }
      : { outcome: "resolved", task };
  }
  if ("summaryQuery" in selector) {
    const query = normalizeSummary(selector.summaryQuery);
    if (query.length === 0) return { outcome: "not_found" };
    return one(
      tasks.filter((task) =>
        normalizeSummary(task.summary ?? "").includes(query),
      ),
    );
  }
  switch (selector.reference) {
    case "focused":
      return resolveTaskId(directory.focusedTaskId, tasks);
    case "latest":
      return tasks[0] === undefined
        ? { outcome: "not_found" }
        : { outcome: "resolved", task: tasks[0] };
    case "previous": {
      const previous =
        directory.recentTerminalTasks[0] ??
        tasks.find((task) => task.taskId === directory.lastReferencedTaskId);
      return previous === undefined
        ? { outcome: "not_found" }
        : { outcome: "resolved", task: previous };
    }
    case "only_active":
      return one(directory.activeTasks);
  }
}

export function allDirectoryTasks(
  directory: TaskDirectorySnapshot,
): readonly TaskSummary[] {
  return [...directory.activeTasks, ...directory.recentTerminalTasks];
}

function resolveTaskId(
  taskId: string | undefined,
  tasks: readonly TaskSummary[],
): TaskResolution {
  return taskId === undefined
    ? { outcome: "not_found" }
    : one(tasks.filter((task) => task.taskId === taskId));
}

function one(tasks: readonly TaskSummary[]): TaskResolution {
  if (tasks.length === 0) return { outcome: "not_found" };
  if (tasks.length > 1) return { outcome: "ambiguous", candidates: tasks };
  const task = tasks[0];
  if (task === undefined) return { outcome: "not_found" };
  return { outcome: "resolved", task };
}

function normalizeSummary(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}
