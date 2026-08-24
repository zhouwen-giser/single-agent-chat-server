import type {
  ConversationContextBudget,
  ConversationMessage,
} from "./index.js";
import type {
  ConversationHistoryPort,
  ConversationSummarizationModel,
} from "./ports.js";

export type ConversationSummaryRefreshResult =
  | { readonly outcome: "not_needed" }
  | {
      readonly outcome: "saved";
      readonly summarizedThroughSequence: number;
      readonly version: number;
    }
  | { readonly outcome: "failed" };

export class ConversationSummaryRefresher {
  constructor(
    private readonly history: ConversationHistoryPort,
    private readonly model: ConversationSummarizationModel,
    private readonly budget: ConversationContextBudget,
  ) {}

  async refresh(input: {
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<ConversationSummaryRefreshResult> {
    try {
      const existing = await this.history.loadSummary(input);
      const unsummarized = await this.history.loadMessagesAfter({
        ...input,
        afterSequence: existing?.summarizedThroughSequence ?? 0,
        limit: 100,
      });
      const characterCount =
        (existing?.summary.length ?? 0) +
        unsummarized.reduce(
          (total, message) => total + message.contentText.length,
          0,
        );
      if (characterCount <= this.budget.summaryTriggerCharacters) {
        return { outcome: "not_needed" };
      }
      const candidates = selectSummaryPrefix(unsummarized, this.budget);
      const summaryInput = fitSummaryInput(
        input.threadId,
        existing,
        candidates,
        this.budget,
      );
      if (summaryInput === undefined) return { outcome: "not_needed" };
      const last = summaryInput.messages.at(-1);
      if (last === undefined) return { outcome: "not_needed" };
      const summary = await this.model.summarize(summaryInput);
      const saved = await this.history.saveSummary({
        ...input,
        summary,
        summarizedThroughSequence: last.sequence,
        expectedVersion: existing?.version ?? 0,
      });
      return {
        outcome: "saved",
        summarizedThroughSequence: saved.summarizedThroughSequence,
        version: saved.version,
      };
    } catch {
      return { outcome: "failed" };
    }
  }
}

function fitSummaryInput(
  threadId: string,
  existing: Awaited<ReturnType<ConversationHistoryPort["loadSummary"]>>,
  candidates: readonly ConversationMessage[],
  budget: ConversationContextBudget,
) {
  const projected = candidates.map(
    ({ role, contentText, sequence, truncated }) => ({
      role,
      contentText,
      sequence,
      truncated,
    }),
  );
  while (projected.length > 0) {
    const input = {
      threadId,
      ...(existing === undefined
        ? {}
        : {
            previousSummary: existing.summary,
            summarizedThroughSequence: existing.summarizedThroughSequence,
          }),
      messages: projected,
    };
    if (
      JSON.stringify({ untrustedData: input }).length <=
      budget.maxContextCharacters
    ) {
      return input;
    }
    projected.pop();
  }
  return undefined;
}

function selectSummaryPrefix(
  messages: readonly ConversationMessage[],
  budget: ConversationContextBudget,
): readonly ConversationMessage[] {
  if (messages.length < 2) return [];
  const keepCharacters = Math.max(
    1,
    Math.floor(budget.summaryTriggerCharacters / 2),
  );
  let suffixCharacters = 0;
  let cutoff = messages.length;
  while (cutoff > 0) {
    const candidate = messages[cutoff - 1];
    if (candidate === undefined) break;
    if (
      cutoff < messages.length &&
      suffixCharacters + candidate.contentText.length > keepCharacters
    ) {
      break;
    }
    suffixCharacters += candidate.contentText.length;
    cutoff -= 1;
  }
  const prefixEnd = Math.min(cutoff, messages.length - 1);
  return messages.slice(0, prefixEnd);
}
