import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type {
  IdempotencyClaim,
  JsonValue,
  StartupReconciliation,
  TaskBinding,
  ThreadBinding,
} from "./types.js";

export class PersistenceConflictError extends Error {}
export class PersistenceAuthorizationError extends Error {}

export class ChatPersistenceRepository {
  constructor(
    private readonly pool: Pool,
    private readonly defaultLeaseMs: number,
  ) {}

  async getOrCreateThread(input: {
    readonly openWebUiChatId: string;
    readonly userId: string;
    readonly userRole: string;
  }): Promise<ThreadBinding> {
    const result = await this.pool.query<ThreadRow>(
      `
        INSERT INTO chat_service.chat_thread_binding(
          thread_id, openwebui_chat_id, user_id, user_role
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (openwebui_chat_id, user_id)
        DO UPDATE SET user_role = EXCLUDED.user_role, updated_at = now()
        RETURNING thread_id, openwebui_chat_id, user_id, user_role
      `,
      [randomUUID(), input.openWebUiChatId, input.userId, input.userRole],
    );
    return mapThread(requiredRow(result.rows, "thread upsert"));
  }

  async createTaskBinding(input: {
    readonly openWebUiChatId: string;
    readonly userId: string;
    readonly sdarTaskId: string;
    readonly sdarContextId: string;
    readonly status: string;
  }): Promise<TaskBinding> {
    return this.transaction(async (client) => {
      const thread = await client.query<{ thread_id: string }>(
        `
          SELECT thread_id
          FROM chat_service.chat_thread_binding
          WHERE openwebui_chat_id = $1 AND user_id = $2
          FOR UPDATE
        `,
        [input.openWebUiChatId, input.userId],
      );
      if (thread.rowCount !== 1) {
        throw new PersistenceAuthorizationError(
          "Chat thread is not authorized",
        );
      }
      try {
        const result = await client.query<TaskRow>(
          `
            INSERT INTO chat_service.conversation_task_binding(
              binding_id, thread_id, sdar_task_id, sdar_context_id, status
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING *
          `,
          [
            randomUUID(),
            requiredRow(thread.rows, "authorized thread").thread_id,
            input.sdarTaskId,
            input.sdarContextId,
            input.status,
          ],
        );
        return mapTask(requiredRow(result.rows, "task binding insert"));
      } catch (error) {
        if (postgresCode(error) === "23505") {
          throw new PersistenceConflictError(
            "The chat already has an active SDAR Task",
          );
        }
        throw error;
      }
    });
  }

  async findAuthorizedTask(input: {
    readonly openWebUiChatId: string;
    readonly userId: string;
    readonly sdarTaskId: string;
  }): Promise<TaskBinding | undefined> {
    const result = await this.pool.query<TaskRow>(
      `
        SELECT task.*
        FROM chat_service.conversation_task_binding task
        JOIN chat_service.chat_thread_binding thread
          ON thread.thread_id = task.thread_id
        WHERE thread.openwebui_chat_id = $1
          AND thread.user_id = $2
          AND task.sdar_task_id = $3
      `,
      [input.openWebUiChatId, input.userId, input.sdarTaskId],
    );
    return result.rows[0] === undefined ? undefined : mapTask(result.rows[0]);
  }

  async findActiveTaskForChat(input: {
    readonly chatId: string;
    readonly userId: string;
  }): Promise<TaskBinding | undefined> {
    const result = await this.pool.query<TaskRow>(
      `
        SELECT task.*
        FROM chat_service.conversation_task_binding task
        JOIN chat_service.chat_thread_binding thread
          ON thread.thread_id = task.thread_id
        WHERE thread.openwebui_chat_id = $1
          AND thread.user_id = $2
          AND task.terminal_at IS NULL
      `,
      [input.chatId, input.userId],
    );
    return result.rows[0] === undefined ? undefined : mapTask(result.rows[0]);
  }
  async listActiveBindings(): Promise<readonly TaskBinding[]> {
    const result = await this.pool.query<TaskRow>(
      `
        SELECT * FROM chat_service.conversation_task_binding
        WHERE terminal_at IS NULL
        ORDER BY created_at
      `,
    );
    return result.rows.map(mapTask);
  }

  async updateTaskBinding(input: {
    readonly bindingId: string;
    readonly expectedVersion: number;
    readonly status: string;
    readonly pendingInput?: JsonValue;
    readonly lastStatusTimestamp?: string;
    readonly lastEventHash?: string;
    readonly terminal: boolean;
  }): Promise<TaskBinding> {
    const result = await this.pool.query<TaskRow>(
      `
        UPDATE chat_service.conversation_task_binding
        SET status = CASE WHEN terminal_at IS NULL THEN $3 ELSE status END,
            pending_input_json = $4,
            last_status_timestamp = $5,
            last_event_hash = $6,
            terminal_at = CASE
              WHEN $7 THEN COALESCE(terminal_at, now())
              ELSE terminal_at
            END,
            version = version + 1,
            updated_at = now()
        WHERE binding_id = $1 AND version = $2
        RETURNING *
      `,
      [
        input.bindingId,
        input.expectedVersion,
        input.status,
        input.pendingInput ?? null,
        input.lastStatusTimestamp ?? null,
        input.lastEventHash ?? null,
        input.terminal,
      ],
    );
    if (result.rowCount !== 1) {
      throw new PersistenceConflictError("Task binding version conflict");
    }
    return mapTask(requiredRow(result.rows, "task binding update"));
  }

  async claimRequest(input: {
    readonly idempotencyKey: string;
    readonly userId: string;
    readonly openWebUiChatId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<IdempotencyClaim> {
    const leaseMs = input.leaseMs ?? this.defaultLeaseMs;
    return this.transaction(async (client) => {
      const inserted = await client.query(
        `
          INSERT INTO chat_service.request_idempotency(
            idempotency_key, user_id, openwebui_chat_id, request_hash,
            status, lease_owner, lease_until
          ) VALUES ($1, $2, $3, $4, 'CLAIMED', $5,
            now() + ($6::bigint * interval '1 millisecond'))
          ON CONFLICT DO NOTHING
        `,
        [
          input.idempotencyKey,
          input.userId,
          input.openWebUiChatId,
          input.requestHash,
          input.leaseOwner,
          leaseMs,
        ],
      );
      if (inserted.rowCount === 1) return { outcome: "acquired" };

      const existing = await client.query<IdempotencyRow>(
        `
          SELECT * FROM chat_service.request_idempotency
          WHERE idempotency_key = $1 AND user_id = $2 AND openwebui_chat_id = $3
          FOR UPDATE
        `,
        [input.idempotencyKey, input.userId, input.openWebUiChatId],
      );
      const row = requiredRow(existing.rows, "idempotency claim lookup");
      if (row.request_hash !== input.requestHash)
        return { outcome: "conflict" };
      if (row.status === "COMPLETED" && row.result_task_id !== null) {
        return { outcome: "replay", resultTaskId: row.result_task_id };
      }
      if (row.lease_owner === input.leaseOwner) return { outcome: "acquired" };

      const recovered = await client.query(
        `
          UPDATE chat_service.request_idempotency
          SET lease_owner = $4,
              lease_until = now() + ($5::bigint * interval '1 millisecond'),
              updated_at = now()
          WHERE idempotency_key = $1 AND user_id = $2 AND openwebui_chat_id = $3
            AND status = 'CLAIMED'
            AND (lease_until IS NULL OR lease_until <= now())
        `,
        [
          input.idempotencyKey,
          input.userId,
          input.openWebUiChatId,
          input.leaseOwner,
          leaseMs,
        ],
      );
      return recovered.rowCount === 1
        ? { outcome: "acquired" }
        : {
            outcome: "in_progress",
            ...(row.lease_until === null
              ? {}
              : { leaseUntil: row.lease_until.toISOString() }),
          };
    });
  }

  async completeRequest(input: {
    readonly idempotencyKey: string;
    readonly userId: string;
    readonly openWebUiChatId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
    readonly resultTaskId: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `
        UPDATE chat_service.request_idempotency
        SET status = 'COMPLETED', result_task_id = $6,
            lease_owner = NULL, lease_until = NULL, updated_at = now()
        WHERE idempotency_key = $1 AND user_id = $2 AND openwebui_chat_id = $3
          AND request_hash = $4 AND lease_owner = $5 AND status = 'CLAIMED'
      `,
      [
        input.idempotencyKey,
        input.userId,
        input.openWebUiChatId,
        input.requestHash,
        input.leaseOwner,
        input.resultTaskId,
      ],
    );
    if (result.rowCount !== 1) {
      throw new PersistenceConflictError("Idempotency completion conflict");
    }
  }

  async recordEvent(input: {
    readonly taskId: string;
    readonly eventKind: string;
    readonly eventHash: string;
    readonly status: string;
    readonly summary: JsonValue;
    readonly occurredAt?: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `
        INSERT INTO chat_service.a2a_event_cache(
          event_id, task_id, event_kind, event_hash, status,
          summary_json, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (task_id, event_hash) DO NOTHING
      `,
      [
        randomUUID(),
        input.taskId,
        input.eventKind,
        input.eventHash,
        input.status,
        input.summary,
        input.occurredAt ?? null,
      ],
    );
    return result.rowCount === 1;
  }

  async reconcileStartup(input: {
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<StartupReconciliation> {
    const leaseMs = input.leaseMs ?? this.defaultLeaseMs;
    const recovered = await this.pool.query(
      `
        UPDATE chat_service.request_idempotency
        SET lease_owner = $1,
            lease_until = now() + ($2::bigint * interval '1 millisecond'),
            updated_at = now()
        WHERE status = 'CLAIMED'
          AND (lease_until IS NULL OR lease_until <= now())
      `,
      [input.leaseOwner, leaseMs],
    );
    return {
      activeBindings: await this.listActiveBindings(),
      recoveredClaimCount: recovered.rowCount ?? 0,
    };
  }

  private async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

interface ThreadRow {
  readonly thread_id: string;
  readonly openwebui_chat_id: string;
  readonly user_id: string;
  readonly user_role: string;
}

interface TaskRow {
  readonly binding_id: string;
  readonly thread_id: string;
  readonly sdar_task_id: string;
  readonly sdar_context_id: string;
  readonly status: string;
  readonly pending_input_json: JsonValue | null;
  readonly last_status_timestamp: Date | null;
  readonly last_event_hash: string | null;
  readonly terminal_at: Date | null;
  readonly version: string | number;
}

interface IdempotencyRow {
  readonly request_hash: string;
  readonly result_task_id: string | null;
  readonly status: "CLAIMED" | "COMPLETED";
  readonly lease_owner: string | null;
  readonly lease_until: Date | null;
}

const mapThread = (row: ThreadRow): ThreadBinding => ({
  threadId: row.thread_id,
  openWebUiChatId: row.openwebui_chat_id,
  userId: row.user_id,
  userRole: row.user_role,
});

const mapTask = (row: TaskRow): TaskBinding => ({
  bindingId: row.binding_id,
  threadId: row.thread_id,
  sdarTaskId: row.sdar_task_id,
  sdarContextId: row.sdar_context_id,
  status: row.status,
  ...(row.pending_input_json === null
    ? {}
    : { pendingInput: row.pending_input_json }),
  ...(row.last_status_timestamp === null
    ? {}
    : { lastStatusTimestamp: row.last_status_timestamp.toISOString() }),
  ...(row.last_event_hash === null
    ? {}
    : { lastEventHash: row.last_event_hash }),
  ...(row.terminal_at === null
    ? {}
    : { terminalAt: row.terminal_at.toISOString() }),
  version: Number(row.version),
});

function requiredRow<T>(rows: readonly T[], operation: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("PostgreSQL returned no row for " + operation);
  }
  return row;
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}
