import type { ConversationSummaryInput } from "../../conversation-model/src/index.js";
import type { TaskDirectorySnapshot } from "../../task-directory/src/index.js";
import type {
  ConversationMessage,
  ConversationProtocol,
  ConversationSummary,
} from "./index.js";

export interface ConversationHistoryPort {
  ingestUserMessage(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly protocol: ConversationProtocol;
    readonly externalMessageId?: string;
    readonly contentText: string;
    readonly requestId?: string;
    readonly taskId?: string;
  }): Promise<{
    readonly outcome: "inserted" | "duplicate";
    readonly message: ConversationMessage;
  }>;
  reconcileAssistantMessage(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly protocol: ConversationProtocol;
    readonly externalMessageId: string;
    readonly contentText: string;
    readonly requestId?: string;
    readonly taskId?: string;
  }): Promise<
    | { readonly outcome: "matched"; readonly message: ConversationMessage }
    | { readonly outcome: "missing" }
  >;
  loadRecentMessages(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly limit?: number;
  }): Promise<readonly ConversationMessage[]>;
  loadMessagesAfter(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly afterSequence: number;
    readonly limit?: number;
  }): Promise<readonly ConversationMessage[]>;
  loadSummary(input: {
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<ConversationSummary | undefined>;
  saveSummary(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly summary: string;
    readonly summarizedThroughSequence: number;
    readonly expectedVersion: number;
  }): Promise<ConversationSummary>;
}

export interface TaskDirectoryPort {
  loadTaskDirectory(input: {
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<TaskDirectorySnapshot>;
}

export interface ConversationSummarizationModel {
  summarize(input: ConversationSummaryInput): Promise<string>;
}

export interface ConversationContextObservation {
  readonly messageCount: number;
  readonly characterCount: number;
  readonly activeTaskCount: number;
  readonly terminalTaskCount: number;
  readonly summaryPresent: boolean;
  readonly budgetTruncated: boolean;
}

export interface ConversationContextObserver {
  recordContext(observation: ConversationContextObservation): void;
}
