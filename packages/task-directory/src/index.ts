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
