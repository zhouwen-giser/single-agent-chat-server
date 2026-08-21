import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type {
  ConversationMessage,
  ConversationProtocol,
  ConversationRole,
  ConversationSummary,
} from "../../conversation-context/src/index.js";
import {
  PersistenceAuthorizationError,
  PersistenceConflictError,
} from "./repository.js";

const MAX_CONTENT_CHARACTERS = 1_000_000;
const MAX_SUMMARY_CHARACTERS = 60_000;
const MAX_IDENTIFIER_CHARACTERS = 512;

export interface ConversationMessageInput {
  readonly principalId: string;
  readonly threadId: string;
  readonly protocol: ConversationProtocol;
  readonly externalMessageId?: string;
  readonly contentText: string;
  readonly requestId?: string;
  readonly taskId?: string;
  readonly truncated?: boolean;
}

export type ConversationMessageIngestResult = {
  readonly outcome: "inserted" | "duplicate";
  readonly message: ConversationMessage;
};

export type AssistantMessageReconciliation =
  | { readonly outcome: "matched"; readonly message: ConversationMessage }
  | { readonly outcome: "missing" };

export class ConversationPersistenceRepository {
  constructor(private readonly pool: Pool) {}

  ingestUserMessage(
    input: ConversationMessageInput,
  ): Promise<ConversationMessageIngestResult> {
    return this.insertMessage(input, "user");
  }

  appendAssistantMessage(
    input: ConversationMessageInput,
  ): Promise<ConversationMessageIngestResult> {
    return this.insertMessage(input, "assistant");
  }

  async reconcileAssistantMessage(
    input: Omit<ConversationMessageInput, "truncated"> & {
      readonly externalMessageId: string;
    },
  ): Promise<AssistantMessageReconciliation> {
    validateMessageInput(input);
    const result = await this.pool.query<ConversationMessageRow>(
      `
        SELECT message.*
        FROM chat_service.conversation_message AS message
        JOIN chat_service.conversation_thread AS thread
          ON thread.thread_id = message.thread_id
        WHERE message.protocol = $1
          AND message.thread_id = $2
          AND message.external_message_id = $3
          AND thread.principal_id = $4
      `,
      [
        input.protocol,
        input.threadId,
        input.externalMessageId,
        input.principalId,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) return { outcome: "missing" };
    if (
      row.role !== "assistant" ||
      row.content_hash !== hashText(input.contentText)
    ) {
      throw new PersistenceConflictError(
        "Assistant message reconciliation conflict",
      );
    }
    return { outcome: "matched", message: mapConversationMessage(row) };
  }

  async loadRecentMessages(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly limit?: number;
  }): Promise<readonly ConversationMessage[]> {
    const limit = input.limit ?? 30;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Conversation message limit must be from 1 to 100");
    }
    const result = await this.pool.query<ConversationMessageRow>(
      `
        SELECT recent.*
        FROM (
          SELECT message.*
          FROM chat_service.conversation_message AS message
          JOIN chat_service.conversation_thread AS thread
            ON thread.thread_id = message.thread_id
          WHERE message.thread_id = $1 AND thread.principal_id = $2
          ORDER BY message.sequence DESC
          LIMIT $3
        ) AS recent
        ORDER BY recent.sequence ASC
      `,
      [input.threadId, input.principalId, limit],
    );
    return result.rows.map(mapConversationMessage);
  }

  async loadMessagesAfter(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly afterSequence: number;
    readonly limit?: number;
  }): Promise<readonly ConversationMessage[]> {
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(input.afterSequence) || input.afterSequence < 0) {
      throw new Error("Conversation sequence must be a nonnegative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Conversation message limit must be from 1 to 100");
    }
    const result = await this.pool.query<ConversationMessageRow>(
      `
        SELECT message.*
        FROM chat_service.conversation_message AS message
        JOIN chat_service.conversation_thread AS thread
          ON thread.thread_id = message.thread_id
        WHERE message.thread_id = $1
          AND thread.principal_id = $2
          AND message.sequence > $3
        ORDER BY message.sequence ASC
        LIMIT $4
      `,
      [input.threadId, input.principalId, input.afterSequence, limit],
    );
    return result.rows.map(mapConversationMessage);
  }

  async markAssistantMessageTruncated(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly messageId: string;
  }): Promise<ConversationMessage> {
    const result = await this.pool.query<ConversationMessageRow>(
      `
        UPDATE chat_service.conversation_message AS message
        SET truncated = true
        FROM chat_service.conversation_thread AS thread
        WHERE message.message_id = $1
          AND message.thread_id = $2
          AND message.role = 'assistant'
          AND message.thread_id = thread.thread_id
          AND thread.principal_id = $3
        RETURNING message.*
      `,
      [input.messageId, input.threadId, input.principalId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new PersistenceAuthorizationError(
        "Assistant message is not authorized",
      );
    }
    return mapConversationMessage(row);
  }

  async loadSummary(input: {
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<ConversationSummary | undefined> {
    const result = await this.pool.query<ConversationSummaryRow>(
      `
        SELECT summary.*
        FROM chat_service.conversation_summary AS summary
        JOIN chat_service.conversation_thread AS thread
          ON thread.thread_id = summary.thread_id
        WHERE summary.thread_id = $1 AND thread.principal_id = $2
      `,
      [input.threadId, input.principalId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapConversationSummary(result.rows[0]);
  }

  async saveSummary(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly summary: string;
    readonly summarizedThroughSequence: number;
    readonly expectedVersion: number;
  }): Promise<ConversationSummary> {
    validateSummaryInput(input);
    return this.transaction(async (client) => {
      const thread = await client.query<ConversationThreadSequenceRow>(
        `
          SELECT next_message_sequence
          FROM chat_service.conversation_thread
          WHERE thread_id = $1 AND principal_id = $2
          FOR UPDATE
        `,
        [input.threadId, input.principalId],
      );
      const threadRow = thread.rows[0];
      if (threadRow === undefined) {
        throw new PersistenceAuthorizationError(
          "Conversation thread is not authorized",
        );
      }
      if (
        input.summarizedThroughSequence >=
        Number(threadRow.next_message_sequence)
      ) {
        throw new PersistenceConflictError(
          "Summary cannot advance beyond persisted messages",
        );
      }
      const existing = await client.query<ConversationSummaryRow>(
        `SELECT * FROM chat_service.conversation_summary
         WHERE thread_id = $1 FOR UPDATE`,
        [input.threadId],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        if (input.expectedVersion !== 0) {
          throw new PersistenceConflictError("Summary version conflict");
        }
        const inserted = await client.query<ConversationSummaryRow>(
          `
            INSERT INTO chat_service.conversation_summary(
              thread_id, summary_text, summarized_through_sequence, version
            ) VALUES ($1, $2, $3, 1)
            RETURNING *
          `,
          [input.threadId, input.summary, input.summarizedThroughSequence],
        );
        return mapConversationSummary(
          requiredRow(inserted.rows, "conversation summary insert"),
        );
      }
      if (
        Number(row.version) !== input.expectedVersion ||
        input.summarizedThroughSequence <
          Number(row.summarized_through_sequence)
      ) {
        throw new PersistenceConflictError("Summary version conflict");
      }
      const updated = await client.query<ConversationSummaryRow>(
        `
          UPDATE chat_service.conversation_summary
          SET summary_text = $2,
              summarized_through_sequence = $3,
              version = version + 1,
              updated_at = now()
          WHERE thread_id = $1 AND version = $4
          RETURNING *
        `,
        [
          input.threadId,
          input.summary,
          input.summarizedThroughSequence,
          input.expectedVersion,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new PersistenceConflictError("Summary version conflict");
      }
      return mapConversationSummary(
        requiredRow(updated.rows, "conversation summary update"),
      );
    });
  }

  private async insertMessage(
    input: ConversationMessageInput,
    role: ConversationRole,
  ): Promise<ConversationMessageIngestResult> {
    validateMessageInput(input);
    if (role === "user" && input.truncated === true) {
      throw new Error("Only assistant messages may be marked truncated");
    }
    const externalMessageId = resolveExternalMessageId(input, role);
    const contentHash = hashText(input.contentText);
    return this.transaction(async (client) => {
      const thread = await client.query<ConversationThreadSequenceRow>(
        `
          SELECT next_message_sequence
          FROM chat_service.conversation_thread
          WHERE thread_id = $1 AND principal_id = $2
          FOR UPDATE
        `,
        [input.threadId, input.principalId],
      );
      if (thread.rowCount !== 1) {
        throw new PersistenceAuthorizationError(
          "Conversation thread is not authorized",
        );
      }
      const existing = await client.query<ConversationMessageRow>(
        `
          SELECT * FROM chat_service.conversation_message
          WHERE protocol = $1 AND thread_id = $2
            AND external_message_id = $3
        `,
        [input.protocol, input.threadId, externalMessageId],
      );
      const existingRow = existing.rows[0];
      if (existingRow !== undefined) {
        if (
          existingRow.role !== role ||
          existingRow.content_hash !== contentHash
        ) {
          throw new PersistenceConflictError(
            "Conversation external message ID conflict",
          );
        }
        return {
          outcome: "duplicate",
          message: mapConversationMessage(existingRow),
        };
      }
      const sequence = Number(
        requiredRow(thread.rows, "conversation thread sequence")
          .next_message_sequence,
      );
      await client.query(
        `
          UPDATE chat_service.conversation_thread
          SET next_message_sequence = next_message_sequence + 1,
              updated_at = now()
          WHERE thread_id = $1 AND principal_id = $2
        `,
        [input.threadId, input.principalId],
      );
      const inserted = await client.query<ConversationMessageRow>(
        `
          INSERT INTO chat_service.conversation_message(
            message_id, thread_id, protocol, external_message_id, role,
            content_text, content_hash, request_id, task_id, sequence,
            truncated
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `,
        [
          randomUUID(),
          input.threadId,
          input.protocol,
          externalMessageId,
          role,
          input.contentText,
          contentHash,
          input.requestId ?? null,
          input.taskId ?? null,
          sequence,
          input.truncated ?? false,
        ],
      );
      return {
        outcome: "inserted",
        message: mapConversationMessage(
          requiredRow(inserted.rows, "conversation message insert"),
        ),
      };
    });
  }

  private async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function validateMessageInput(input: ConversationMessageInput): void {
  validateEnum(input.protocol, ["openai", "ag_ui"], "protocol");
  validateText(input.contentText, MAX_CONTENT_CHARACTERS, "content");
  validateOptionalIdentifier(input.externalMessageId, "external message ID");
  validateOptionalIdentifier(input.requestId, "request ID");
  validateOptionalIdentifier(input.taskId, "Task ID");
  if (input.externalMessageId === undefined && input.requestId === undefined) {
    throw new Error(
      "Conversation message needs an external message ID or request ID",
    );
  }
}

function validateSummaryInput(input: {
  readonly summary: string;
  readonly summarizedThroughSequence: number;
  readonly expectedVersion: number;
}): void {
  validateText(input.summary, MAX_SUMMARY_CHARACTERS, "summary");
  if (
    !Number.isSafeInteger(input.summarizedThroughSequence) ||
    input.summarizedThroughSequence < 0
  ) {
    throw new Error("Summarized sequence must be a nonnegative integer");
  }
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0
  ) {
    throw new Error("Expected summary version must be a nonnegative integer");
  }
}

function validateText(value: string, maximum: number, label: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new Error(`Conversation ${label} size is invalid`);
  }
}

function validateOptionalIdentifier(
  value: string | undefined,
  label: string,
): void {
  if (
    value !== undefined &&
    (typeof value !== "string" ||
      value.length < 1 ||
      value.length > MAX_IDENTIFIER_CHARACTERS)
  ) {
    throw new Error(`Conversation ${label} is invalid`);
  }
}

function validateEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new Error(`Conversation ${label} is invalid`);
  }
}

function resolveExternalMessageId(
  input: ConversationMessageInput,
  role: ConversationRole,
): string {
  if (input.externalMessageId !== undefined) return input.externalMessageId;
  return `server:${hashText(
    `${input.protocol}\u0000${input.threadId}\u0000${role}\u0000${input.requestId ?? ""}`,
  )}`;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface ConversationThreadSequenceRow {
  readonly next_message_sequence: string | number;
}

interface ConversationMessageRow {
  readonly message_id: string;
  readonly thread_id: string;
  readonly protocol: ConversationProtocol;
  readonly external_message_id: string;
  readonly role: ConversationRole;
  readonly content_text: string;
  readonly content_hash: string;
  readonly request_id: string | null;
  readonly task_id: string | null;
  readonly sequence: string | number;
  readonly truncated: boolean;
  readonly created_at: Date;
}

interface ConversationSummaryRow {
  readonly thread_id: string;
  readonly summary_text: string;
  readonly summarized_through_sequence: string | number;
  readonly version: string | number;
  readonly updated_at: Date;
}

const mapConversationMessage = (
  row: ConversationMessageRow,
): ConversationMessage => ({
  messageId: row.message_id,
  threadId: row.thread_id,
  protocol: row.protocol,
  externalMessageId: row.external_message_id,
  role: row.role,
  contentText: row.content_text,
  contentHash: row.content_hash,
  ...(row.request_id === null ? {} : { requestId: row.request_id }),
  ...(row.task_id === null ? {} : { taskId: row.task_id }),
  sequence: Number(row.sequence),
  truncated: row.truncated,
  createdAt: row.created_at.toISOString(),
});

const mapConversationSummary = (
  row: ConversationSummaryRow,
): ConversationSummary => ({
  threadId: row.thread_id,
  summary: row.summary_text,
  summarizedThroughSequence: Number(row.summarized_through_sequence),
  version: Number(row.version),
  updatedAt: row.updated_at.toISOString(),
});

function requiredRow<T>(rows: readonly T[], operation: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`PostgreSQL returned no row for ${operation}`);
  }
  return row;
}
