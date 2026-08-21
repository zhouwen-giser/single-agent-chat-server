import { createHash, randomUUID } from "node:crypto";

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
    private readonly maxActiveTasksPerChat = 8,
  ) {
    assertActiveTaskLimit(maxActiveTasksPerChat);
  }

  async countActiveTaskBindings(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM chat_service.conversation_task_binding
      WHERE terminal_at IS NULL
    `);
    return Number(requiredRow(result.rows, "active task count").count);
  }

  async getOrCreateThread(input: {
    readonly openWebUiChatId: string;
    readonly userId: string;
    readonly userRole: string;
  }): Promise<ThreadBinding> {
    return this.transaction(async (client) => {
      const result = await client.query<ThreadRow>(
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
      const thread = mapThread(requiredRow(result.rows, "thread upsert"));
      const principal = await client.query<{ principal_id: string }>(
        `
          INSERT INTO chat_service.principal(principal_id, issuer, subject, role)
          VALUES ($1, 'openwebui-jwt', $1, $2)
          ON CONFLICT (issuer, subject)
          DO UPDATE SET role = EXCLUDED.role, updated_at = now()
          RETURNING principal_id
        `,
        [input.userId, input.userRole],
      );
      const principalId = requiredRow(
        principal.rows,
        "principal upsert",
      ).principal_id;
      await client.query(
        `
          INSERT INTO chat_service.conversation_thread(thread_id, principal_id)
          VALUES ($1, $2)
          ON CONFLICT (thread_id) DO UPDATE SET updated_at = now()
        `,
        [thread.threadId, principalId],
      );
      await client.query(
        `
          INSERT INTO chat_service.client_thread_binding(
            binding_id, client_type, external_thread_id, principal_id,
            internal_thread_id
          ) VALUES ($1, 'openwebui', $2, $3, $4)
          ON CONFLICT (client_type, principal_id, external_thread_id)
          DO UPDATE SET internal_thread_id = EXCLUDED.internal_thread_id,
                        updated_at = now()
        `,
        [randomUUID(), input.openWebUiChatId, principalId, thread.threadId],
      );
      return thread;
    });
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
      const threadId = requiredRow(thread.rows, "authorized thread").thread_id;
      const shortId = await allocateShortId(client, threadId, input.sdarTaskId);
      try {
        const result = await client.query<TaskRow>(
          `
            INSERT INTO chat_service.conversation_task_binding(
              binding_id, thread_id, conversation_thread_id, sdar_task_id,
              sdar_context_id, short_id, status, last_interacted_at
            ) VALUES ($1, $2, $2, $3, $4, $5, $6, now())
            RETURNING *
          `,
          [
            randomUUID(),
            threadId,
            input.sdarTaskId,
            input.sdarContextId,
            shortId,
            input.status,
          ],
        );
        const binding = mapTask(
          requiredRow(result.rows, "task binding insert"),
        );
        await upsertTaskFocus(client, threadId, binding.bindingId);
        await upsertTaskReference(client, threadId, binding.bindingId);
        return binding;
      } catch (error) {
        if (postgresCode(error) === "23505") {
          throw new PersistenceConflictError(
            "The SDAR Task or generated short ID is already bound to this chat",
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

  async listActiveTasksForChat(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly limit?: number;
  }): Promise<readonly TaskBinding[]> {
    const limit = validateDirectoryLimit(input.limit);
    const result = await this.pool.query<TaskRow>(
      `
        SELECT task.*
        FROM chat_service.conversation_task_binding task
        JOIN chat_service.chat_thread_binding thread
          ON thread.thread_id = task.thread_id
        WHERE thread.openwebui_chat_id = $1
          AND thread.user_id = $2
          AND task.terminal_at IS NULL
        ORDER BY task.last_interacted_at DESC NULLS LAST,
                 task.created_at DESC,
                 task.sdar_task_id ASC
        LIMIT $3
      `,
      [input.chatId, input.userId, limit],
    );
    return result.rows.map(mapTask);
  }

  async listRecentTasksForChat(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly limit?: number;
  }): Promise<readonly TaskBinding[]> {
    const limit = validateDirectoryLimit(input.limit);
    const result = await this.pool.query<TaskRow>(
      `
        SELECT task.*
        FROM chat_service.conversation_task_binding task
        JOIN chat_service.chat_thread_binding thread
          ON thread.thread_id = task.thread_id
        WHERE thread.openwebui_chat_id = $1
          AND thread.user_id = $2
          AND task.terminal_at IS NOT NULL
        ORDER BY task.last_interacted_at DESC NULLS LAST,
                 task.created_at DESC,
                 task.sdar_task_id ASC
        LIMIT $3
      `,
      [input.chatId, input.userId, limit],
    );
    return result.rows.map(mapTask);
  }

  async countActiveTasksForChat(input: {
    readonly chatId: string;
    readonly userId: string;
  }): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM chat_service.conversation_task_binding task
        JOIN chat_service.chat_thread_binding thread
          ON thread.thread_id = task.thread_id
        WHERE thread.openwebui_chat_id = $1
          AND thread.user_id = $2
          AND task.terminal_at IS NULL
      `,
      [input.chatId, input.userId],
    );
    return Number(requiredRow(result.rows, "chat active task count").count);
  }

  async findFocusedTaskForChat(input: {
    readonly chatId: string;
    readonly userId: string;
  }): Promise<TaskBinding | undefined> {
    const result = await this.pool.query<TaskRow>(
      `
        SELECT task.*
        FROM chat_service.conversation_task_focus focus
        JOIN chat_service.conversation_task_binding task
          ON task.conversation_thread_id = focus.conversation_thread_id
         AND task.binding_id = focus.binding_id
        JOIN chat_service.chat_thread_binding thread
          ON thread.thread_id = focus.conversation_thread_id
        WHERE thread.openwebui_chat_id = $1 AND thread.user_id = $2
      `,
      [input.chatId, input.userId],
    );
    return result.rows[0] === undefined ? undefined : mapTask(result.rows[0]);
  }

  async setFocusedTask(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly bindingId: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `
        INSERT INTO chat_service.conversation_task_focus(
          conversation_thread_id, binding_id
        )
        SELECT task.conversation_thread_id, task.binding_id
        FROM chat_service.conversation_task_binding task
        JOIN chat_service.chat_thread_binding thread
          ON thread.thread_id = task.thread_id
        WHERE thread.openwebui_chat_id = $1 AND thread.user_id = $2
          AND task.binding_id = $3
        ON CONFLICT (conversation_thread_id)
        DO UPDATE SET binding_id = EXCLUDED.binding_id, updated_at = now()
      `,
      [input.chatId, input.userId, input.bindingId],
    );
    if (result.rowCount !== 1) {
      throw new PersistenceAuthorizationError("Task focus is not authorized");
    }
    await this.touchTaskReference(input);
  }

  async touchTaskReference(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly bindingId: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `
        WITH authorized AS (
          UPDATE chat_service.conversation_task_binding task
          SET last_interacted_at = now(), updated_at = now()
          FROM chat_service.chat_thread_binding thread
          WHERE thread.thread_id = task.thread_id
            AND thread.openwebui_chat_id = $1 AND thread.user_id = $2
            AND task.binding_id = $3
          RETURNING task.conversation_thread_id, task.binding_id
        )
        INSERT INTO chat_service.conversation_task_reference(
          conversation_thread_id, binding_id
        )
        SELECT conversation_thread_id, binding_id FROM authorized
        ON CONFLICT (conversation_thread_id)
        DO UPDATE SET binding_id = EXCLUDED.binding_id, updated_at = now()
      `,
      [input.chatId, input.userId, input.bindingId],
    );
    if (result.rowCount !== 1) {
      throw new PersistenceAuthorizationError(
        "Task reference is not authorized",
      );
    }
  }
  async listActiveBindings(): Promise<readonly TaskBinding[]> {
    const result = await this.pool.query<TaskRow>(
      `
        SELECT * FROM chat_service.conversation_task_binding
        WHERE terminal_at IS NULL
        ORDER BY conversation_thread_id,
                 last_interacted_at DESC NULLS LAST,
                 created_at DESC,
                 sdar_task_id ASC
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
    let expectedVersion = input.expectedVersion;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await this.pool.query<TaskRow>(
        `
        UPDATE chat_service.conversation_task_binding
        SET status = CASE
              WHEN terminal_at IS NULL AND (
                $5::timestamptz IS NULL
                OR last_status_timestamp IS NULL
                OR $5::timestamptz >= last_status_timestamp
              ) THEN $3
              ELSE status
            END,
            pending_input_json = CASE
              WHEN terminal_at IS NULL AND (
                $5::timestamptz IS NULL
                OR last_status_timestamp IS NULL
                OR $5::timestamptz >= last_status_timestamp
              ) THEN $4
              ELSE pending_input_json
            END,
            last_status_timestamp = CASE
              WHEN terminal_at IS NULL AND (
                $5::timestamptz IS NULL
                OR last_status_timestamp IS NULL
                OR $5::timestamptz >= last_status_timestamp
              ) THEN COALESCE($5::timestamptz, last_status_timestamp)
              ELSE last_status_timestamp
            END,
            last_event_hash = CASE
              WHEN terminal_at IS NULL AND (
                $5::timestamptz IS NULL
                OR last_status_timestamp IS NULL
                OR $5::timestamptz >= last_status_timestamp
              ) THEN $6
              ELSE last_event_hash
            END,
            terminal_at = CASE
              WHEN $7 AND terminal_at IS NULL AND (
                $5::timestamptz IS NULL
                OR last_status_timestamp IS NULL
                OR $5::timestamptz >= last_status_timestamp
              ) THEN now()
              ELSE terminal_at
            END,
            version = version + 1,
            updated_at = now()
        WHERE binding_id = $1 AND version = $2
        RETURNING *
      `,
        [
          input.bindingId,
          expectedVersion,
          input.status,
          input.pendingInput ?? null,
          input.lastStatusTimestamp ?? null,
          input.lastEventHash ?? null,
          input.terminal,
        ],
      );
      if (result.rowCount === 1) {
        return mapTask(requiredRow(result.rows, "task binding update"));
      }
      const reread = await this.pool.query<TaskRow>(
        `SELECT * FROM chat_service.conversation_task_binding
         WHERE binding_id = $1`,
        [input.bindingId],
      );
      const current = reread.rows[0];
      if (current === undefined) {
        throw new PersistenceConflictError("Task binding no longer exists");
      }
      const binding = mapTask(current);
      if (preserveCurrentTaskBinding(binding, input.lastStatusTimestamp)) {
        return binding;
      }
      expectedVersion = binding.version;
    }
    throw new PersistenceConflictError(
      "Task binding version conflict after bounded retries",
    );
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

  async abandonRequestClaim(input: {
    readonly idempotencyKey: string;
    readonly userId: string;
    readonly openWebUiChatId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM chat_service.request_idempotency
        WHERE idempotency_key = $1
          AND user_id = $2
          AND openwebui_chat_id = $3
          AND request_hash = $4
          AND lease_owner = $5
          AND status = 'CLAIMED'
          AND result_task_id IS NULL
      `,
      [
        input.idempotencyKey,
        input.userId,
        input.openWebUiChatId,
        input.requestHash,
        input.leaseOwner,
      ],
    );
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

  async claimTaskSubmissionSlot(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<boolean> {
    const leaseMs = input.leaseMs ?? this.defaultLeaseMs;
    const result = await this.pool.query(
      `
        UPDATE chat_service.chat_thread_binding AS thread
        SET submission_lease_owner = $3,
            submission_lease_until = now() + ($4::bigint * interval '1 millisecond'),
            updated_at = now()
        WHERE thread.openwebui_chat_id = $1
          AND thread.user_id = $2
          AND (
            thread.submission_lease_until IS NULL
            OR thread.submission_lease_until <= now()
            OR thread.submission_lease_owner = $3
          )
          AND (
            SELECT count(*)
            FROM chat_service.conversation_task_binding AS task
            WHERE task.thread_id = thread.thread_id
              AND task.terminal_at IS NULL
          ) < $5
      `,
      [
        input.chatId,
        input.userId,
        input.leaseOwner,
        leaseMs,
        this.maxActiveTasksPerChat,
      ],
    );
    return result.rowCount === 1;
  }

  async claimTaskInteractionSlot(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly bindingId: string;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<boolean> {
    const leaseMs = input.leaseMs ?? this.defaultLeaseMs;
    const result = await this.pool.query(
      `
        UPDATE chat_service.conversation_task_binding AS task
        SET interaction_lease_owner = $4,
            interaction_lease_until = now() + ($5::bigint * interval '1 millisecond'),
            last_interacted_at = now(),
            updated_at = now()
        FROM chat_service.chat_thread_binding AS thread
        WHERE task.thread_id = thread.thread_id
          AND thread.openwebui_chat_id = $1
          AND thread.user_id = $2
          AND task.binding_id = $3
          AND (
            task.interaction_lease_until IS NULL
            OR task.interaction_lease_until <= now()
            OR task.interaction_lease_owner = $4
          )
      `,
      [input.chatId, input.userId, input.bindingId, input.leaseOwner, leaseMs],
    );
    return result.rowCount === 1;
  }

  async releaseTaskInteractionSlot(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly bindingId: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    await this.pool.query(
      `
        UPDATE chat_service.conversation_task_binding AS task
        SET interaction_lease_owner = NULL,
            interaction_lease_until = NULL,
            updated_at = now()
        FROM chat_service.chat_thread_binding AS thread
        WHERE task.thread_id = thread.thread_id
          AND thread.openwebui_chat_id = $1 AND thread.user_id = $2
          AND task.binding_id = $3 AND task.interaction_lease_owner = $4
      `,
      [input.chatId, input.userId, input.bindingId, input.leaseOwner],
    );
  }

  async releaseTaskSubmissionSlot(input: {
    readonly chatId: string;
    readonly userId: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    await this.pool.query(
      `
        UPDATE chat_service.chat_thread_binding
        SET submission_lease_owner = NULL,
            submission_lease_until = NULL,
            updated_at = now()
        WHERE openwebui_chat_id = $1
          AND user_id = $2
          AND submission_lease_owner = $3
      `,
      [input.chatId, input.userId, input.leaseOwner],
    );
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
    const releasedSubmissionSlots = await this.pool.query(`
      UPDATE chat_service.chat_thread_binding
      SET submission_lease_owner = NULL,
          submission_lease_until = NULL,
          updated_at = now()
      WHERE submission_lease_until IS NOT NULL
        AND submission_lease_until <= now()
    `);
    const releasedInteractionSlots = await this.pool.query(`
      UPDATE chat_service.conversation_task_binding
      SET interaction_lease_owner = NULL,
          interaction_lease_until = NULL,
          updated_at = now()
      WHERE interaction_lease_until IS NOT NULL
        AND interaction_lease_until <= now()
    `);
    return {
      activeBindings: await this.listActiveBindings(),
      recoveredClaimCount: recovered.rowCount ?? 0,
      recoveredSubmissionSlotCount: releasedSubmissionSlots.rowCount ?? 0,
      recoveredTaskInteractionSlotCount: releasedInteractionSlots.rowCount ?? 0,
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
  readonly short_id: string;
  readonly status: string;
  readonly pending_input_json: JsonValue | null;
  readonly last_status_timestamp: Date | null;
  readonly last_event_hash: string | null;
  readonly terminal_at: Date | null;
  readonly last_interacted_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
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
  shortId: row.short_id,
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
  ...(row.last_interacted_at === null
    ? {}
    : { lastInteractedAt: row.last_interacted_at.toISOString() }),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  version: Number(row.version),
});

function preserveCurrentTaskBinding(
  current: TaskBinding,
  incomingTimestamp: string | undefined,
): boolean {
  if (current.terminalAt !== undefined) return true;
  if (
    incomingTimestamp === undefined ||
    current.lastStatusTimestamp === undefined
  ) {
    return false;
  }
  return (
    Date.parse(incomingTimestamp) < Date.parse(current.lastStatusTimestamp)
  );
}

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

function assertActiveTaskLimit(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 32) {
    throw new Error("Active Task limit must be an integer from 1 to 32");
  }
}

function validateDirectoryLimit(value: number | undefined): number {
  const limit = value ?? 32;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Task directory limit must be an integer from 1 to 100");
  }
  return limit;
}

async function allocateShortId(
  client: PoolClient,
  threadId: string,
  taskId: string,
): Promise<string> {
  const existing = await client.query<{ short_id: string }>(
    `SELECT short_id FROM chat_service.conversation_task_binding
     WHERE conversation_thread_id = $1`,
    [threadId],
  );
  const used = new Set(existing.rows.map((row) => row.short_id));
  const normalized = taskId.toLowerCase().replace(/[^a-z0-9._:-]/gu, "");
  const source = normalized.length === 0 ? taskId : normalized;
  for (let length = Math.min(8, source.length); length <= source.length;) {
    const candidate = source.slice(0, Math.min(length, 64));
    if (candidate.length > 0 && !used.has(candidate)) return candidate;
    if (length >= Math.min(source.length, 64)) break;
    length = Math.min(length + 4, source.length, 64);
  }
  const digest = createHash("sha256").update(taskId).digest("hex").slice(0, 16);
  const candidate = `${source.slice(0, 47)}-${digest}`;
  if (!used.has(candidate)) return candidate;
  throw new PersistenceConflictError(
    "Task short ID collision requires the full SDAR Task ID",
  );
}

async function upsertTaskFocus(
  client: PoolClient,
  threadId: string,
  bindingId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO chat_service.conversation_task_focus(
       conversation_thread_id, binding_id
     ) VALUES ($1, $2)
     ON CONFLICT (conversation_thread_id)
     DO UPDATE SET binding_id = EXCLUDED.binding_id, updated_at = now()`,
    [threadId, bindingId],
  );
}

async function upsertTaskReference(
  client: PoolClient,
  threadId: string,
  bindingId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO chat_service.conversation_task_reference(
       conversation_thread_id, binding_id
     ) VALUES ($1, $2)
     ON CONFLICT (conversation_thread_id)
     DO UPDATE SET binding_id = EXCLUDED.binding_id, updated_at = now()`,
    [threadId, bindingId],
  );
}
