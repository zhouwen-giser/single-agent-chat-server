import type { TaskSummary } from "../../task-directory/src/index.js";

export type ConversationProtocol = "openai" | "ag_ui";
export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  readonly messageId: string;
  readonly threadId: string;
  readonly protocol: ConversationProtocol;
  readonly externalMessageId: string;
  readonly role: ConversationRole;
  readonly contentText: string;
  readonly contentHash: string;
  readonly requestId?: string;
  readonly taskId?: string;
  readonly sequence: number;
  readonly truncated: boolean;
  readonly createdAt: string;
}

export interface ConversationSummary {
  readonly threadId: string;
  readonly summary: string;
  readonly summarizedThroughSequence: number;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ConversationContext {
  readonly threadId: string;
  readonly summary?: string;
  readonly summarizedThroughSequence?: number;
  readonly messages: readonly ConversationMessage[];
  readonly activeTasks: readonly TaskSummary[];
  readonly recentTerminalTasks: readonly TaskSummary[];
  readonly focusedTaskId?: string;
  readonly lastReferencedTaskId?: string;
}

export interface ConversationContextBudget {
  readonly maxRecentMessages: number;
  readonly maxContextCharacters: number;
  readonly summaryTriggerCharacters: number;
  readonly maxTaskSummaryCharacters: number;
}

export { ConversationContextAssembler } from "./assembler.js";
export { parseConversationContextBudget } from "./config.js";
export {
  ClientHistoryImporter,
  type ClientHistoryImportResult,
  type ClientHistoryMessage,
  type ClientHistoryRole,
} from "./importer.js";
export type {
  ConversationContextObservation,
  ConversationContextObserver,
  ConversationHistoryPort,
  ConversationSummarizationModel,
  TaskDirectoryPort,
} from "./ports.js";
export {
  ConversationSummaryRefresher,
  type ConversationSummaryRefreshResult,
} from "./summarizer.js";
