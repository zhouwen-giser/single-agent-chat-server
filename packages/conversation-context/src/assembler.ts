import type {
  TaskDirectorySnapshot,
  TaskSummary,
} from "../../task-directory/src/index.js";
import type {
  ConversationContext,
  ConversationContextBudget,
  ConversationMessage,
} from "./index.js";
import type {
  ConversationContextObserver,
  ConversationHistoryPort,
  TaskDirectoryPort,
} from "./ports.js";

const noOpObserver: ConversationContextObserver = {
  recordContext: () => undefined,
};

export class ConversationContextAssembler {
  constructor(
    private readonly history: ConversationHistoryPort,
    private readonly tasks: TaskDirectoryPort,
    private readonly budget: ConversationContextBudget,
    private readonly observer: ConversationContextObserver = noOpObserver,
  ) {}

  async assemble(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly currentUserText: string;
    readonly currentUserMessageSequence?: number;
  }): Promise<ConversationContext> {
    const [summary, loadedMessages, directory] = await Promise.all([
      this.history.loadSummary(input),
      this.history.loadRecentMessages({
        principalId: input.principalId,
        threadId: input.threadId,
        limit: this.budget.maxRecentMessages,
      }),
      this.tasks.loadTaskDirectory(input),
    ]);
    const eligibleMessages = loadedMessages.filter(
      (message) =>
        message.sequence > (summary?.summarizedThroughSequence ?? 0) &&
        (input.currentUserMessageSequence === undefined ||
          message.sequence < input.currentUserMessageSequence),
    );
    let budgetTruncated = false;
    let context: ConversationContext = {
      threadId: input.threadId,
      messages: [],
      activeTasks: [],
      recentTerminalTasks: [],
    };
    if (!fits(context, this.budget, input.currentUserText)) {
      throw new Error("CONVERSATION_CURRENT_TURN_EXCEEDS_CONTEXT_BUDGET");
    }

    if (summary !== undefined) {
      const fitted = fitSummary(
        context,
        summary.summary,
        summary.summarizedThroughSequence,
        this.budget,
        input.currentUserText,
      );
      if (fitted !== undefined) {
        context = {
          ...context,
          summary: fitted,
          summarizedThroughSequence: summary.summarizedThroughSequence,
        };
        budgetTruncated ||= fitted !== summary.summary;
      } else {
        budgetTruncated = true;
      }
    }

    const selectedMessages: ConversationMessage[] = [];
    for (let index = eligibleMessages.length - 1; index >= 0; index -= 1) {
      const candidate = eligibleMessages[index];
      if (candidate === undefined) continue;
      const nextMessages = [candidate, ...selectedMessages];
      const next = { ...context, messages: nextMessages };
      if (!fits(next, this.budget, input.currentUserText)) {
        budgetTruncated = true;
        break;
      }
      selectedMessages.unshift(candidate);
    }
    context = { ...context, messages: selectedMessages };

    const projectedDirectory = projectDirectory(
      directory,
      this.budget.maxTaskSummaryCharacters,
    );
    const activeTasks = fitTasks(
      context,
      projectedDirectory.activeTasks,
      "activeTasks",
      this.budget,
      input.currentUserText,
    );
    budgetTruncated ||= activeTasks.length !== directory.activeTasks.length;
    context = { ...context, activeTasks };
    const recentTerminalTasks = fitTasks(
      context,
      projectedDirectory.recentTerminalTasks,
      "recentTerminalTasks",
      this.budget,
      input.currentUserText,
    );
    budgetTruncated ||=
      recentTerminalTasks.length !== directory.recentTerminalTasks.length;
    context = { ...context, recentTerminalTasks };

    for (const [field, value] of [
      ["focusedTaskId", directory.focusedTaskId],
      ["lastReferencedTaskId", directory.lastReferencedTaskId],
    ] as const) {
      if (value === undefined) continue;
      const next = { ...context, [field]: value };
      if (fits(next, this.budget, input.currentUserText)) context = next;
      else budgetTruncated = true;
    }

    const characterCount = serializedCharacters(context, input.currentUserText);
    this.observer.recordContext({
      messageCount: context.messages.length,
      characterCount,
      activeTaskCount: context.activeTasks.length,
      terminalTaskCount: context.recentTerminalTasks.length,
      summaryPresent: context.summary !== undefined,
      budgetTruncated,
    });
    return context;
  }
}

function fitSummary(
  context: ConversationContext,
  summary: string,
  summarizedThroughSequence: number,
  budget: ConversationContextBudget,
  currentUserText: string,
): string | undefined {
  if (
    fits(
      { ...context, summary, summarizedThroughSequence },
      budget,
      currentUserText,
    )
  ) {
    return summary;
  }
  const marker = "…[context truncated]";
  let low = 0;
  let high = summary.length;
  let fitted: string | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = summary.slice(0, middle) + marker;
    if (
      fits(
        { ...context, summary: candidate, summarizedThroughSequence },
        budget,
        currentUserText,
      )
    ) {
      fitted = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return fitted;
}

function fitTasks(
  context: ConversationContext,
  tasks: readonly TaskSummary[],
  field: "activeTasks" | "recentTerminalTasks",
  budget: ConversationContextBudget,
  currentUserText: string,
): readonly TaskSummary[] {
  const selected: TaskSummary[] = [];
  for (const task of tasks) {
    const nextTasks = [...selected, task];
    const next = { ...context, [field]: nextTasks };
    if (!fits(next, budget, currentUserText)) break;
    selected.push(task);
  }
  return selected;
}

function projectDirectory(
  directory: TaskDirectorySnapshot,
  maxSummaryCharacters: number,
): TaskDirectorySnapshot {
  return {
    ...directory,
    activeTasks: directory.activeTasks.map((task) =>
      projectTask(task, maxSummaryCharacters),
    ),
    recentTerminalTasks: directory.recentTerminalTasks.map((task) =>
      projectTask(task, maxSummaryCharacters),
    ),
  };
}

function projectTask(
  task: TaskSummary,
  maxSummaryCharacters: number,
): TaskSummary {
  if (task.summary === undefined) return task;
  if (maxSummaryCharacters === 0) {
    const withoutSummary = { ...task };
    delete withoutSummary.summary;
    return withoutSummary;
  }
  return {
    ...task,
    summary: task.summary.slice(0, maxSummaryCharacters),
  };
}

function fits(
  context: ConversationContext,
  budget: ConversationContextBudget,
  currentUserText: string,
): boolean {
  return (
    serializedCharacters(context, currentUserText) <=
    budget.maxContextCharacters
  );
}

function serializedCharacters(
  context: ConversationContext,
  currentUserText: string,
): number {
  return JSON.stringify({
    untrustedData: { conversation: context, currentUserText },
  }).length;
}
