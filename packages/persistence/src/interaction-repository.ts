import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import {
  parseCompletedRequestResult,
  type CompletedRequestResult,
} from "../../request-result/src/index.js";
import {
  PersistenceAuthorizationError,
  PersistenceConflictError,
} from "./repository.js";
import type {
  AgentCardSnapshot,
  ClientThreadBinding,
  ClientType,
  InteractionProtocol,
  InteractionRequestClaim,
  InteractionRun,
  InterruptBinding,
  InterruptResolutionClaim,
  Principal,
} from "./interaction-types.js";
import type { JsonValue, StartupReconciliation, TaskBinding } from "./types.js";
import type {
  TaskDirectorySnapshot,
  TaskSummary,
} from "../../task-directory/src/index.js";

export class InteractionPersistenceRepository {
  constructor(
    private readonly pool: Pool,
    private readonly defaultLeaseMs: number,
    private readonly maxActiveTasksPerChat = 8,
  ) {
    assertActiveTaskLimit(maxActiveTasksPerChat);
  }

  async resolvePrincipal(input: {
    readonly issuer: string;
    readonly subject: string;
    readonly role: string;
  }): Promise<Principal> {
    const result = await this.pool.query<PrincipalRow>(
      `
        INSERT INTO chat_service.principal(
          principal_id, issuer, subject, role
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (issuer, subject)
        DO UPDATE SET role = EXCLUDED.role, updated_at = now()
        RETURNING principal_id, issuer, subject, role
      `,
      [randomUUID(), input.issuer, input.subject, input.role],
    );
    return mapPrincipal(requiredRow(result.rows, "principal upsert"));
  }

  async getOrCreateThread(input: {
    readonly clientType: ClientType;
    readonly externalThreadId: string;
    readonly principalId: string;
  }): Promise<ClientThreadBinding> {
    return this.transaction(async (client) => {
      const principal = await client.query(
        `SELECT principal_id FROM chat_service.principal
         WHERE principal_id = $1 FOR UPDATE`,
        [input.principalId],
      );
      if (principal.rowCount !== 1) {
        throw new PersistenceAuthorizationError("Principal is not authorized");
      }
      const existing = await findClientThread(client, input);
      if (existing !== undefined) return existing;

      const threadId = randomUUID();
      await client.query(
        `INSERT INTO chat_service.conversation_thread(thread_id, principal_id)
         VALUES ($1, $2)`,
        [threadId, input.principalId],
      );
      const inserted = await client.query<ClientThreadRow>(
        `
          INSERT INTO chat_service.client_thread_binding(
            binding_id, client_type, external_thread_id, principal_id,
            internal_thread_id
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `,
        [
          randomUUID(),
          input.clientType,
          input.externalThreadId,
          input.principalId,
          threadId,
        ],
      );
      return mapClientThread(
        requiredRow(inserted.rows, "client thread insert"),
      );
    });
  }

  async resolveInternalThreadId(input: {
    readonly clientType: ClientType;
    readonly externalThreadId: string;
    readonly principalId: string;
  }): Promise<string> {
    const result = await this.pool.query<{
      readonly internal_thread_id: string;
    }>(
      `SELECT binding.internal_thread_id
       FROM chat_service.client_thread_binding binding
       JOIN chat_service.conversation_thread thread
         ON thread.thread_id = binding.internal_thread_id
       WHERE binding.client_type = $1
         AND binding.external_thread_id = $2
         AND binding.principal_id = $3
         AND thread.principal_id = $3`,
      [input.clientType, input.externalThreadId, input.principalId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new PersistenceAuthorizationError(
        "Client Thread is not authorized for principal",
      );
    }
    return row.internal_thread_id;
  }

  async createTaskBinding(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly sdarTaskId: string;
    readonly sdarContextId: string;
    readonly status: string;
  }): Promise<TaskBinding> {
    return this.transaction(async (client) => {
      const authorized = await client.query(
        `SELECT thread_id FROM chat_service.conversation_thread
         WHERE thread_id = $1 AND principal_id = $2 FOR UPDATE`,
        [input.threadId, input.principalId],
      );
      if (authorized.rowCount !== 1) {
        throw new PersistenceAuthorizationError("Thread is not authorized");
      }
      const shortId = await allocateShortId(
        client,
        input.threadId,
        input.sdarTaskId,
      );
      try {
        const result = await client.query<InteractionTaskRow>(
          `
          INSERT INTO chat_service.conversation_task_binding(
            binding_id, thread_id, conversation_thread_id, sdar_task_id,
            sdar_context_id, short_id, status, last_interacted_at
          ) VALUES ($1, NULL, $2, $3, $4, $5, $6, now())
          RETURNING *
        `,
          [
            randomUUID(),
            input.threadId,
            input.sdarTaskId,
            input.sdarContextId,
            shortId,
            input.status,
          ],
        );
        const binding = mapInteractionTask(
          requiredRow(result.rows, "interaction Task binding insert"),
        );
        await upsertTaskFocus(client, input.threadId, binding.bindingId);
        await upsertTaskReference(client, input.threadId, binding.bindingId);
        return binding;
      } catch (error) {
        if (postgresCode(error) === "23505") {
          throw new PersistenceConflictError(
            "The SDAR Task or generated short ID is already bound to this thread",
          );
        }
        throw error;
      }
    });
  }

  async findAuthorizedTask(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly sdarTaskId: string;
  }): Promise<TaskBinding | undefined> {
    const result = await this.pool.query<InteractionTaskRow>(
      `
        SELECT task.*
        FROM chat_service.conversation_task_binding task
        JOIN chat_service.conversation_thread thread
          ON thread.thread_id = task.conversation_thread_id
        WHERE task.conversation_thread_id = $1
          AND thread.principal_id = $2
          AND task.sdar_task_id = $3
      `,
      [input.threadId, input.principalId, input.sdarTaskId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapInteractionTask(result.rows[0]);
  }

  async listActiveTasksForChat(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly limit?: number;
  }): Promise<readonly TaskBinding[]> {
    const limit = validateDirectoryLimit(input.limit);
    const result = await this.pool.query<InteractionTaskRow>(
      `
        SELECT task.*
        FROM chat_service.conversation_task_binding task
        JOIN chat_service.conversation_thread thread
          ON thread.thread_id = task.conversation_thread_id
        WHERE task.conversation_thread_id = $1
          AND thread.principal_id = $2
          AND task.terminal_at IS NULL
        ORDER BY task.last_interacted_at DESC NULLS LAST,
                 task.created_at DESC,
                 task.sdar_task_id ASC
        LIMIT $3
      `,
      [input.threadId, input.principalId, limit],
    );
    return result.rows.map(mapInteractionTask);
  }

  async listRecentTasksForChat(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly limit?: number;
  }): Promise<readonly TaskBinding[]> {
    const limit = validateDirectoryLimit(input.limit);
    const result = await this.pool.query<InteractionTaskRow>(
      `
        SELECT task.*
        FROM chat_service.conversation_task_binding task
        JOIN chat_service.conversation_thread thread
          ON thread.thread_id = task.conversation_thread_id
        WHERE task.conversation_thread_id = $1
          AND thread.principal_id = $2
          AND task.terminal_at IS NOT NULL
        ORDER BY task.last_interacted_at DESC NULLS LAST,
                 task.created_at DESC,
                 task.sdar_task_id ASC
        LIMIT $3
      `,
      [input.threadId, input.principalId, limit],
    );
    return result.rows.map(mapInteractionTask);
  }

  async countActiveTasksForChat(input: {
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM chat_service.conversation_task_binding task
       JOIN chat_service.conversation_thread thread
         ON thread.thread_id = task.conversation_thread_id
       WHERE task.conversation_thread_id = $1 AND thread.principal_id = $2
         AND task.terminal_at IS NULL`,
      [input.threadId, input.principalId],
    );
    return Number(requiredRow(result.rows, "thread active Task count").count);
  }

  async findFocusedTaskForChat(input: {
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<TaskBinding | undefined> {
    const result = await this.pool.query<InteractionTaskRow>(
      `SELECT task.*
       FROM chat_service.conversation_task_focus focus
       JOIN chat_service.conversation_task_binding task
         ON task.conversation_thread_id = focus.conversation_thread_id
        AND task.binding_id = focus.binding_id
       JOIN chat_service.conversation_thread thread
         ON thread.thread_id = focus.conversation_thread_id
       WHERE focus.conversation_thread_id = $1 AND thread.principal_id = $2`,
      [input.threadId, input.principalId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapInteractionTask(result.rows[0]);
  }

  async setFocusedTask(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly bindingId: string;
  }): Promise<void> {
    await this.transaction(async (client) => {
      const selected = await selectAuthorizedBinding(client, input);
      if (selected === undefined) {
        throw new PersistenceAuthorizationError("Task focus is not authorized");
      }
      await upsertTaskFocus(client, input.threadId, input.bindingId);
      await touchTaskReference(client, input.threadId, input.bindingId);
      await upsertTaskReference(client, input.threadId, input.bindingId);
    });
  }

  async touchTaskReference(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly bindingId: string;
  }): Promise<void> {
    await this.transaction(async (client) => {
      const selected = await selectAuthorizedBinding(client, input);
      if (selected === undefined) {
        throw new PersistenceAuthorizationError(
          "Task reference is not authorized",
        );
      }
      await touchTaskReference(client, input.threadId, input.bindingId);
      await upsertTaskReference(client, input.threadId, input.bindingId);
    });
  }

  async loadTaskDirectory(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly activeLimit?: number;
    readonly recentLimit?: number;
  }): Promise<TaskDirectorySnapshot> {
    const [active, recent, focus, reference] = await Promise.all([
      this.listActiveTasksForChat({
        principalId: input.principalId,
        threadId: input.threadId,
        ...(input.activeLimit === undefined
          ? {}
          : { limit: input.activeLimit }),
      }),
      this.listRecentTasksForChat({
        principalId: input.principalId,
        threadId: input.threadId,
        ...(input.recentLimit === undefined
          ? {}
          : { limit: input.recentLimit }),
      }),
      this.findFocusedTaskForChat(input),
      this.findLastReferencedTaskForChat(input),
    ]);
    return {
      ...(focus === undefined ? {} : { focusedTaskId: focus.sdarTaskId }),
      ...(reference === undefined
        ? {}
        : { lastReferencedTaskId: reference.sdarTaskId }),
      activeTasks: active.map(toTaskSummary),
      recentTerminalTasks: recent.map(toTaskSummary),
    };
  }

  async listTaskBindings(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly limit?: number;
  }): Promise<readonly TaskBinding[]> {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Task binding limit must be an integer from 1 to 100");
    }
    const result = await this.pool.query<InteractionTaskRow>(
      `
        SELECT task.*
        FROM chat_service.conversation_task_binding task
        JOIN chat_service.conversation_thread thread
          ON thread.thread_id = task.conversation_thread_id
        WHERE task.conversation_thread_id = $1
          AND thread.principal_id = $2
        ORDER BY (task.terminal_at IS NULL) DESC,
                 task.last_interacted_at DESC NULLS LAST,
                 task.created_at DESC,
                 task.sdar_task_id ASC
        LIMIT $3
      `,
      [input.threadId, input.principalId, limit],
    );
    return result.rows.map(mapInteractionTask);
  }
  async recordAuthorizedTaskObservation(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly sdarTaskId: string;
    readonly status: string;
    readonly pendingInput?: JsonValue;
    readonly lastStatusTimestamp?: string;
    readonly terminal: boolean;
  }): Promise<TaskBinding | undefined> {
    const result = await this.pool.query<InteractionTaskRow>(
      `
        UPDATE chat_service.conversation_task_binding AS task
        SET status = $4,
            pending_input_json = $5,
            last_status_timestamp = COALESCE(
              $6::timestamptz,
              task.last_status_timestamp
            ),
            terminal_at = CASE
              WHEN $7 THEN COALESCE(task.terminal_at, now())
              ELSE task.terminal_at
            END,
            version = task.version + 1,
            updated_at = now()
        FROM chat_service.conversation_thread AS thread
        WHERE task.conversation_thread_id = $2
          AND task.sdar_task_id = $3
          AND task.conversation_thread_id = thread.thread_id
          AND thread.principal_id = $1
          AND task.terminal_at IS NULL
          AND (
            $6::timestamptz IS NULL
            OR task.last_status_timestamp IS NULL
            OR $6::timestamptz >= task.last_status_timestamp
          )
        RETURNING task.*
      `,
      [
        input.principalId,
        input.threadId,
        input.sdarTaskId,
        input.status,
        input.pendingInput ?? null,
        input.lastStatusTimestamp ?? null,
        input.terminal,
      ],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapInteractionTask(result.rows[0]);
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
      const result = await this.pool.query<InteractionTaskRow>(
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
        return mapInteractionTask(
          requiredRow(result.rows, "Task binding update"),
        );
      }
      const reread = await this.pool.query<InteractionTaskRow>(
        `SELECT * FROM chat_service.conversation_task_binding
         WHERE binding_id = $1`,
        [input.bindingId],
      );
      const current = reread.rows[0];
      if (current === undefined) {
        throw new PersistenceConflictError("Task binding no longer exists");
      }
      const binding = mapInteractionTask(current);
      if (preserveCurrentTaskBinding(binding, input.lastStatusTimestamp)) {
        return binding;
      }
      expectedVersion = binding.version;
    }
    throw new PersistenceConflictError(
      "Task binding version conflict after bounded retries",
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
    readonly threadId: string;
    readonly principalId: string;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<boolean> {
    const leaseMs = input.leaseMs ?? this.defaultLeaseMs;
    const result = await this.pool.query(
      `
        UPDATE chat_service.conversation_thread AS thread
        SET submission_lease_owner = $3,
            submission_lease_until =
              now() + ($4::bigint * interval '1 millisecond'),
            updated_at = now()
        WHERE thread.thread_id = $1 AND thread.principal_id = $2
          AND (
            thread.submission_lease_until IS NULL
            OR thread.submission_lease_until <= now()
            OR thread.submission_lease_owner = $3
          )
          AND (
            SELECT count(*)
            FROM chat_service.conversation_task_binding task
            WHERE task.conversation_thread_id = thread.thread_id
              AND task.terminal_at IS NULL
          ) < $5
      `,
      [
        input.threadId,
        input.principalId,
        input.leaseOwner,
        leaseMs,
        this.maxActiveTasksPerChat,
      ],
    );
    return result.rowCount === 1;
  }

  async claimTaskInteractionSlot(input: {
    readonly threadId: string;
    readonly principalId: string;
    readonly bindingId: string;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<boolean> {
    const leaseMs = input.leaseMs ?? this.defaultLeaseMs;
    const result = await this.pool.query(
      `
        UPDATE chat_service.conversation_task_binding task
        SET interaction_lease_owner = $4,
            interaction_lease_until =
              now() + ($5::bigint * interval '1 millisecond'),
            last_interacted_at = now(),
            updated_at = now()
        FROM chat_service.conversation_thread thread
        WHERE task.conversation_thread_id = $1
          AND thread.thread_id = task.conversation_thread_id
          AND thread.principal_id = $2
          AND task.binding_id = $3
          AND (
            task.interaction_lease_until IS NULL
            OR task.interaction_lease_until <= now()
            OR task.interaction_lease_owner = $4
          )
      `,
      [
        input.threadId,
        input.principalId,
        input.bindingId,
        input.leaseOwner,
        leaseMs,
      ],
    );
    return result.rowCount === 1;
  }

  async releaseTaskInteractionSlot(input: {
    readonly threadId: string;
    readonly principalId: string;
    readonly bindingId: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    await this.pool.query(
      `
        UPDATE chat_service.conversation_task_binding task
        SET interaction_lease_owner = NULL,
            interaction_lease_until = NULL,
            updated_at = now()
        FROM chat_service.conversation_thread thread
        WHERE task.conversation_thread_id = $1
          AND thread.thread_id = task.conversation_thread_id
          AND thread.principal_id = $2
          AND task.binding_id = $3
          AND task.interaction_lease_owner = $4
      `,
      [input.threadId, input.principalId, input.bindingId, input.leaseOwner],
    );
  }

  async releaseTaskSubmissionSlot(input: {
    readonly threadId: string;
    readonly principalId: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    await this.pool.query(
      `
        UPDATE chat_service.conversation_thread
        SET submission_lease_owner = NULL,
            submission_lease_until = NULL,
            updated_at = now()
        WHERE thread_id = $1
          AND principal_id = $2
          AND submission_lease_owner = $3
      `,
      [input.threadId, input.principalId, input.leaseOwner],
    );
  }
  async claimRequest(input: {
    readonly protocol: InteractionProtocol;
    readonly externalRequestId: string;
    readonly principalId: string;
    readonly threadId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<InteractionRequestClaim> {
    const leaseMs = input.leaseMs ?? this.defaultLeaseMs;
    return this.transaction(async (client) => {
      await assertThreadPrincipal(client, input.threadId, input.principalId);
      const requestId = randomUUID();
      const inserted = await client.query(
        `
          INSERT INTO chat_service.interaction_request(
            request_id, protocol, external_request_id, principal_id,
            thread_id, request_hash, status, lease_owner, lease_until
          ) VALUES ($1, $2, $3, $4, $5, $6, 'CLAIMED', $7,
            now() + ($8::bigint * interval '1 millisecond'))
          ON CONFLICT DO NOTHING
        `,
        [
          requestId,
          input.protocol,
          input.externalRequestId,
          input.principalId,
          input.threadId,
          input.requestHash,
          input.leaseOwner,
          leaseMs,
        ],
      );
      if (inserted.rowCount === 1) return { outcome: "acquired", requestId };

      const existing = await client.query<InteractionRequestRow>(
        `
          SELECT * FROM chat_service.interaction_request
          WHERE protocol = $1 AND external_request_id = $2
            AND principal_id = $3 AND thread_id = $4
          FOR UPDATE
        `,
        [
          input.protocol,
          input.externalRequestId,
          input.principalId,
          input.threadId,
        ],
      );
      const row = requiredRow(existing.rows, "interaction request lookup");
      if (row.request_hash !== input.requestHash)
        return { outcome: "conflict" };
      if (row.status === "COMPLETED") {
        return {
          outcome: "replay",
          result: mapCompletedRequestResult(row),
        };
      }
      const recovered = await client.query(
        `
          UPDATE chat_service.interaction_request
          SET lease_owner = $2,
              lease_until = now() + ($3::bigint * interval '1 millisecond'),
              updated_at = now()
          WHERE request_id = $1 AND status = 'CLAIMED'
            AND (lease_until IS NULL OR lease_until <= now())
        `,
        [row.request_id, input.leaseOwner, leaseMs],
      );
      return recovered.rowCount === 1
        ? { outcome: "acquired", requestId: row.request_id }
        : { outcome: "in_progress" };
    });
  }

  async completeRequest(input: {
    readonly requestId: string;
    readonly principalId: string;
    readonly leaseOwner: string;
    readonly result: CompletedRequestResult;
  }): Promise<void> {
    const resultValue = requestResultColumns(input.result);
    const result = await this.pool.query(
      `
        UPDATE chat_service.interaction_request
        SET status = 'COMPLETED', lease_owner = NULL, lease_until = NULL,
            result_kind = $4, result_task_id = $5, result_context_id = $6,
            result_message_id = $7, result_related_task_id = $8,
            result_message_json = $9, result_rendered_text = $10,
            result_hash = $11, updated_at = now()
        WHERE request_id = $1 AND principal_id = $2
          AND lease_owner = $3 AND status = 'CLAIMED'
      `,
      [input.requestId, input.principalId, input.leaseOwner, ...resultValue],
    );
    if (result.rowCount !== 1) {
      throw new PersistenceConflictError(
        "Interaction request completion conflict",
      );
    }
  }

  async completeCoordinatorRequest(input: {
    readonly protocol: InteractionProtocol;
    readonly externalRequestId: string;
    readonly principalId: string;
    readonly threadId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
    readonly result: CompletedRequestResult;
  }): Promise<void> {
    const resultValue = requestResultColumns(input.result);
    const result = await this.pool.query(
      `
        UPDATE chat_service.interaction_request
        SET status = 'COMPLETED', lease_owner = NULL, lease_until = NULL,
            result_kind = $7, result_task_id = $8, result_context_id = $9,
            result_message_id = $10, result_related_task_id = $11,
            result_message_json = $12, result_rendered_text = $13,
            result_hash = $14, updated_at = now()
        WHERE protocol = $1 AND external_request_id = $2
          AND principal_id = $3 AND thread_id = $4
          AND request_hash = $5 AND lease_owner = $6
          AND status = 'CLAIMED'
      `,
      [
        input.protocol,
        input.externalRequestId,
        input.principalId,
        input.threadId,
        input.requestHash,
        input.leaseOwner,
        ...resultValue,
      ],
    );
    if (result.rowCount !== 1) {
      throw new PersistenceConflictError(
        "Interaction request completion conflict",
      );
    }
  }

  async abandonCoordinatorRequest(input: {
    readonly protocol: InteractionProtocol;
    readonly externalRequestId: string;
    readonly principalId: string;
    readonly threadId: string;
    readonly requestHash: string;
    readonly leaseOwner: string;
  }): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM chat_service.interaction_request
        WHERE protocol = $1 AND external_request_id = $2
          AND principal_id = $3 AND thread_id = $4
          AND request_hash = $5 AND lease_owner = $6
          AND status = 'CLAIMED' AND result_kind IS NULL
      `,
      [
        input.protocol,
        input.externalRequestId,
        input.principalId,
        input.threadId,
        input.requestHash,
        input.leaseOwner,
      ],
    );
  }

  async findRequestResult(input: {
    readonly protocol: InteractionProtocol;
    readonly externalRequestId: string;
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<CompletedRequestResult | undefined> {
    const result = await this.pool.query<InteractionRequestRow>(
      `
        SELECT request.*
        FROM chat_service.interaction_request request
        JOIN chat_service.conversation_thread thread
          ON thread.thread_id = request.thread_id
        WHERE request.protocol = $1 AND request.external_request_id = $2
          AND request.principal_id = $3 AND request.thread_id = $4
          AND thread.principal_id = $3
          AND request.status = 'COMPLETED'
      `,
      [
        input.protocol,
        input.externalRequestId,
        input.principalId,
        input.threadId,
      ],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapCompletedRequestResult(row);
  }

  async startOrGetRun(input: {
    readonly runId: string;
    readonly protocol: InteractionProtocol;
    readonly principalId: string;
    readonly threadId: string;
    readonly externalRequestId: string;
  }): Promise<InteractionRun> {
    return this.transaction(async (client) => {
      await assertThreadPrincipal(client, input.threadId, input.principalId);
      const existing = await client.query<InteractionRunRow>(
        `SELECT * FROM chat_service.interaction_run WHERE run_id = $1 FOR UPDATE`,
        [input.runId],
      );
      const row = existing.rows[0];
      if (row !== undefined) {
        if (
          row.principal_id !== input.principalId ||
          row.thread_id !== input.threadId
        ) {
          throw new PersistenceAuthorizationError(
            "Interaction run is not authorized",
          );
        }
        if (
          row.protocol !== input.protocol ||
          row.external_request_id !== input.externalRequestId
        ) {
          throw new PersistenceConflictError(
            "Interaction run identity conflict",
          );
        }
        return mapRun(row);
      }
      const inserted = await client.query<InteractionRunRow>(
        `
          INSERT INTO chat_service.interaction_run(
            run_id, protocol, principal_id, thread_id, external_request_id,
            status
          ) VALUES ($1, $2, $3, $4, $5, 'RUNNING')
          RETURNING *
        `,
        [
          input.runId,
          input.protocol,
          input.principalId,
          input.threadId,
          input.externalRequestId,
        ],
      );
      return mapRun(requiredRow(inserted.rows, "interaction run insert"));
    });
  }

  async findAuthorizedRun(input: {
    readonly runId: string;
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<InteractionRun | undefined> {
    const result = await this.pool.query<InteractionRunRow>(
      `
        SELECT run.*
        FROM chat_service.interaction_run run
        JOIN chat_service.conversation_thread thread
          ON thread.thread_id = run.thread_id
        WHERE run.run_id = $1 AND run.principal_id = $2
          AND run.thread_id = $3 AND thread.principal_id = $2
      `,
      [input.runId, input.principalId, input.threadId],
    );
    return result.rows[0] === undefined ? undefined : mapRun(result.rows[0]);
  }

  async updateRunProgress(input: {
    readonly runId: string;
    readonly principalId: string;
    readonly lastSequence: number;
    readonly taskId?: string;
    readonly contextId?: string;
  }): Promise<InteractionRun> {
    const result = await this.pool.query<InteractionRunRow>(
      `
        UPDATE chat_service.interaction_run
        SET last_sequence = GREATEST(last_sequence, $3),
            task_id = COALESCE(task_id, $4),
            context_id = COALESCE(context_id, $5),
            updated_at = now()
        WHERE run_id = $1 AND principal_id = $2 AND status = 'RUNNING'
          AND (task_id IS NULL OR $4::text IS NULL OR task_id = $4)
          AND (context_id IS NULL OR $5::text IS NULL OR context_id = $5)
        RETURNING *
      `,
      [
        input.runId,
        input.principalId,
        input.lastSequence,
        input.taskId ?? null,
        input.contextId ?? null,
      ],
    );
    if (result.rowCount !== 1) {
      throw new PersistenceConflictError("Interaction run progress conflict");
    }
    return mapRun(requiredRow(result.rows, "interaction run progress"));
  }
  async startRun(input: {
    readonly runId: string;
    readonly protocol: InteractionProtocol;
    readonly principalId: string;
    readonly threadId: string;
    readonly externalRequestId: string;
  }): Promise<InteractionRun> {
    await this.assertThread(input.threadId, input.principalId);
    const result = await this.pool.query<InteractionRunRow>(
      `
        INSERT INTO chat_service.interaction_run(
          run_id, protocol, principal_id, thread_id, external_request_id,
          status
        ) VALUES ($1, $2, $3, $4, $5, 'RUNNING')
        RETURNING *
      `,
      [
        input.runId,
        input.protocol,
        input.principalId,
        input.threadId,
        input.externalRequestId,
      ],
    );
    return mapRun(requiredRow(result.rows, "interaction run insert"));
  }

  async finishRun(input: {
    readonly runId: string;
    readonly principalId: string;
    readonly status: "FINISHED" | "ERROR" | "INTERRUPTED";
    readonly lastSequence: number;
    readonly outcome?: JsonValue;
    readonly taskId?: string;
    readonly contextId?: string;
  }): Promise<InteractionRun> {
    const result = await this.pool.query<InteractionRunRow>(
      `
        UPDATE chat_service.interaction_run
        SET status = $3, last_sequence = GREATEST(last_sequence, $4),
            outcome_json = $5, task_id = COALESCE(task_id, $6),
            context_id = COALESCE(context_id, $7),
            ended_at = now(), updated_at = now()
        WHERE run_id = $1 AND principal_id = $2 AND status = 'RUNNING'
        RETURNING *
      `,
      [
        input.runId,
        input.principalId,
        input.status,
        input.lastSequence,
        input.outcome ?? null,
        input.taskId ?? null,
        input.contextId ?? null,
      ],
    );
    if (result.rowCount !== 1) {
      throw new PersistenceConflictError("Interaction run completion conflict");
    }
    return mapRun(requiredRow(result.rows, "interaction run update"));
  }

  async createInterrupt(
    input: Omit<
      InterruptBinding,
      | "status"
      | "version"
      | "resolutionHash"
      | "resolutionClaimedAt"
      | "resolvedAt"
    >,
  ): Promise<InterruptBinding> {
    await this.assertThread(input.threadId, input.principalId);
    const result = await this.pool.query<InterruptRow>(
      `
        INSERT INTO chat_service.agui_interrupt_binding(
          interrupt_id, run_id, principal_id, thread_id, task_id,
          context_id, internal_phase, reason, input_request_id,
          response_schema_json, response_schema_hash, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `,
      [
        input.interruptId,
        input.runId,
        input.principalId,
        input.threadId,
        input.taskId,
        input.contextId,
        input.internalPhase,
        input.reason,
        input.inputRequestId ?? null,
        input.responseSchema === undefined
          ? null
          : JSON.stringify(input.responseSchema),
        input.responseSchemaHash ?? null,
        input.expiresAt,
      ],
    );
    return mapInterrupt(requiredRow(result.rows, "interrupt insert"));
  }

  async findInterrupt(input: {
    readonly interruptId: string;
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<InterruptBinding | undefined> {
    const result = await this.pool.query<InterruptRow>(
      `
        SELECT * FROM chat_service.agui_interrupt_binding
        WHERE interrupt_id = $1 AND principal_id = $2 AND thread_id = $3
      `,
      [input.interruptId, input.principalId, input.threadId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapInterrupt(result.rows[0]);
  }

  async findOpenInterrupt(input: {
    readonly interruptId: string;
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<InterruptBinding | undefined> {
    const result = await this.pool.query<InterruptRow>(
      `
        SELECT * FROM chat_service.agui_interrupt_binding
        WHERE interrupt_id = $1 AND principal_id = $2 AND thread_id = $3
          AND status = 'OPEN' AND expires_at > now()
      `,
      [input.interruptId, input.principalId, input.threadId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapInterrupt(result.rows[0]);
  }

  async findOpenInterruptForTask(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly taskId: string;
  }): Promise<InterruptBinding | undefined> {
    const result = await this.pool.query<InterruptRow>(
      `
        SELECT * FROM chat_service.agui_interrupt_binding
        WHERE principal_id = $1 AND thread_id = $2 AND task_id = $3
          AND status = 'OPEN' AND expires_at > now()
      `,
      [input.principalId, input.threadId, input.taskId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapInterrupt(result.rows[0]);
  }

  async claimInterruptResolution(input: {
    readonly interruptId: string;
    readonly principalId: string;
    readonly threadId: string;
    readonly taskId: string;
    readonly contextId: string;
    readonly resolutionHash: string;
  }): Promise<InterruptResolutionClaim> {
    return this.transaction(async (client) => {
      const selected = await selectAuthorizedInterrupt(client, input);
      if (selected === undefined) return { outcome: "not_found" };
      if (selected.status === "RESOLVED") {
        return selected.resolutionHash === input.resolutionHash
          ? { outcome: "replay", interrupt: selected }
          : { outcome: "conflict", interrupt: selected };
      }
      if (selected.status === "RESOLVING") {
        return selected.resolutionHash === input.resolutionHash
          ? { outcome: "in_progress", interrupt: selected }
          : { outcome: "conflict", interrupt: selected };
      }
      if (selected.status === "CANCELLED") {
        return { outcome: "cancelled", interrupt: selected };
      }
      if (Date.parse(selected.expiresAt) <= Date.now()) {
        const expired = await updateInterruptStatus(client, {
          interruptId: selected.interruptId,
          expectedVersion: selected.version,
          status: "CANCELLED",
        });
        return { outcome: "expired", interrupt: expired };
      }
      const claimed = await client.query<InterruptRow>(
        `
          UPDATE chat_service.agui_interrupt_binding
          SET status = 'RESOLVING', resolution_hash = $3,
              resolution_claimed_at = now(), version = version + 1,
              updated_at = now()
          WHERE interrupt_id = $1 AND version = $2 AND status = 'OPEN'
          RETURNING *
        `,
        [selected.interruptId, selected.version, input.resolutionHash],
      );
      if (claimed.rowCount !== 1) {
        throw new PersistenceConflictError(
          "Interrupt resolution claim conflict",
        );
      }
      return {
        outcome: "acquired",
        interrupt: mapInterrupt(requiredRow(claimed.rows, "interrupt claim")),
      };
    });
  }

  async completeInterruptResolution(input: {
    readonly interruptId: string;
    readonly principalId: string;
    readonly resolutionHash: string;
  }): Promise<InterruptBinding> {
    const result = await this.pool.query<InterruptRow>(
      `
        UPDATE chat_service.agui_interrupt_binding
        SET status = 'RESOLVED', resolved_at = now(), version = version + 1,
            updated_at = now()
        WHERE interrupt_id = $1 AND principal_id = $2
          AND status = 'RESOLVING' AND resolution_hash = $3
        RETURNING *
      `,
      [input.interruptId, input.principalId, input.resolutionHash],
    );
    if (result.rowCount !== 1) {
      throw new PersistenceConflictError(
        "Interrupt resolution completion conflict",
      );
    }
    return mapInterrupt(requiredRow(result.rows, "interrupt resolution"));
  }

  async cancelInterrupt(input: {
    readonly interruptId: string;
    readonly principalId: string;
    readonly threadId: string;
    readonly taskId: string;
    readonly contextId: string;
    readonly resolutionHash: string;
  }): Promise<InterruptResolutionClaim> {
    return this.transaction(async (client) => {
      const selected = await selectAuthorizedInterrupt(client, input);
      if (selected === undefined) return { outcome: "not_found" };
      if (selected.status === "CANCELLED") {
        return selected.resolutionHash === input.resolutionHash
          ? { outcome: "replay", interrupt: selected }
          : { outcome: "conflict", interrupt: selected };
      }
      if (selected.status !== "OPEN") {
        return { outcome: "conflict", interrupt: selected };
      }
      if (Date.parse(selected.expiresAt) <= Date.now()) {
        const expired = await updateInterruptStatus(client, {
          interruptId: selected.interruptId,
          expectedVersion: selected.version,
          status: "CANCELLED",
        });
        return { outcome: "expired", interrupt: expired };
      }
      const cancelled = await client.query<InterruptRow>(
        `
          UPDATE chat_service.agui_interrupt_binding
          SET status = 'CANCELLED', resolution_hash = $3,
              resolved_at = now(), version = version + 1, updated_at = now()
          WHERE interrupt_id = $1 AND version = $2 AND status = 'OPEN'
          RETURNING *
        `,
        [selected.interruptId, selected.version, input.resolutionHash],
      );
      return {
        outcome: "acquired",
        interrupt: mapInterrupt(
          requiredRow(cancelled.rows, "interrupt cancel"),
        ),
      };
    });
  }
  async saveAgentCardSnapshot(
    input: Omit<AgentCardSnapshot, "snapshotId">,
  ): Promise<AgentCardSnapshot> {
    const result = await this.pool.query<AgentCardRow>(
      `
        INSERT INTO chat_service.agent_card_snapshot(
          snapshot_id, content_hash, protocol_version, spec_patch, binding,
          safe_skills_json, source_url_hash, observed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (content_hash, source_url_hash)
        DO UPDATE SET observed_at = EXCLUDED.observed_at
        RETURNING *
      `,
      [
        randomUUID(),
        input.contentHash,
        input.protocolVersion,
        input.specPatch,
        input.binding,
        JSON.stringify(input.safeSkills),
        input.sourceUrlHash,
        input.observedAt,
      ],
    );
    return mapAgentCard(requiredRow(result.rows, "Agent Card snapshot upsert"));
  }

  async getLatestAgentCardSnapshot(): Promise<AgentCardSnapshot | undefined> {
    const result = await this.pool.query<AgentCardRow>(
      `SELECT * FROM chat_service.agent_card_snapshot
       ORDER BY observed_at DESC LIMIT 1`,
    );
    return result.rows[0] === undefined
      ? undefined
      : mapAgentCard(result.rows[0]);
  }

  async reconcileStartup(input: {
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<StartupReconciliation> {
    const leaseMs = input.leaseMs ?? this.defaultLeaseMs;
    const recovered = await this.pool.query(
      `UPDATE chat_service.interaction_request
       SET lease_owner = $1,
           lease_until = now() + ($2::bigint * interval '1 millisecond'),
           updated_at = now()
       WHERE status = 'CLAIMED'
         AND (lease_until IS NULL OR lease_until <= now())`,
      [input.leaseOwner, leaseMs],
    );
    const releasedSubmissions = await this.pool.query(
      `UPDATE chat_service.conversation_thread
       SET submission_lease_owner = NULL, submission_lease_until = NULL,
           updated_at = now()
       WHERE submission_lease_until IS NOT NULL
         AND submission_lease_until <= now()`,
    );
    const releasedInteractions = await this.pool.query(
      `UPDATE chat_service.conversation_task_binding
       SET interaction_lease_owner = NULL, interaction_lease_until = NULL,
           updated_at = now()
       WHERE interaction_lease_until IS NOT NULL
         AND interaction_lease_until <= now()`,
    );
    const active = await this.pool.query<InteractionTaskRow>(
      `SELECT * FROM chat_service.conversation_task_binding
       WHERE terminal_at IS NULL
       ORDER BY conversation_thread_id,
                last_interacted_at DESC NULLS LAST,
                created_at DESC,
                sdar_task_id ASC`,
    );
    return {
      activeBindings: active.rows.map(mapInteractionTask),
      recoveredClaimCount: recovered.rowCount ?? 0,
      recoveredSubmissionSlotCount: releasedSubmissions.rowCount ?? 0,
      recoveredTaskInteractionSlotCount: releasedInteractions.rowCount ?? 0,
    };
  }

  private async findLastReferencedTaskForChat(input: {
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<TaskBinding | undefined> {
    const result = await this.pool.query<InteractionTaskRow>(
      `SELECT task.*
       FROM chat_service.conversation_task_reference reference
       JOIN chat_service.conversation_task_binding task
         ON task.conversation_thread_id = reference.conversation_thread_id
        AND task.binding_id = reference.binding_id
       JOIN chat_service.conversation_thread thread
         ON thread.thread_id = reference.conversation_thread_id
       WHERE reference.conversation_thread_id = $1
         AND thread.principal_id = $2`,
      [input.threadId, input.principalId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapInteractionTask(result.rows[0]);
  }
  private async assertThread(
    threadId: string,
    principalId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await assertThreadPrincipal(client, threadId, principalId);
    } finally {
      client.release();
    }
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

async function selectAuthorizedInterrupt(
  client: PoolClient,
  input: {
    readonly interruptId: string;
    readonly principalId: string;
    readonly threadId: string;
    readonly taskId: string;
    readonly contextId: string;
  },
): Promise<InterruptBinding | undefined> {
  const result = await client.query<InterruptRow>(
    `
      SELECT interrupt.*
      FROM chat_service.agui_interrupt_binding interrupt
      JOIN chat_service.conversation_task_binding task
        ON task.conversation_thread_id = interrupt.thread_id
       AND task.sdar_task_id = interrupt.task_id
       AND task.sdar_context_id = interrupt.context_id
      JOIN chat_service.conversation_thread thread
        ON thread.thread_id = interrupt.thread_id
      WHERE interrupt.interrupt_id = $1
        AND interrupt.principal_id = $2
        AND interrupt.thread_id = $3
        AND interrupt.task_id = $4
        AND interrupt.context_id = $5
        AND thread.principal_id = $2
      FOR UPDATE OF interrupt
    `,
    [
      input.interruptId,
      input.principalId,
      input.threadId,
      input.taskId,
      input.contextId,
    ],
  );
  return result.rows[0] === undefined
    ? undefined
    : mapInterrupt(result.rows[0]);
}

async function updateInterruptStatus(
  client: PoolClient,
  input: {
    readonly interruptId: string;
    readonly expectedVersion: number;
    readonly status: "CANCELLED";
  },
): Promise<InterruptBinding> {
  const result = await client.query<InterruptRow>(
    `
      UPDATE chat_service.agui_interrupt_binding
      SET status = $3, resolved_at = now(), version = version + 1,
          updated_at = now()
      WHERE interrupt_id = $1 AND version = $2 AND status = 'OPEN'
      RETURNING *
    `,
    [input.interruptId, input.expectedVersion, input.status],
  );
  return mapInterrupt(requiredRow(result.rows, "interrupt status update"));
}
async function findClientThread(
  client: PoolClient,
  input: {
    readonly clientType: ClientType;
    readonly externalThreadId: string;
    readonly principalId: string;
  },
): Promise<ClientThreadBinding | undefined> {
  const result = await client.query<ClientThreadRow>(
    `SELECT * FROM chat_service.client_thread_binding
     WHERE client_type = $1 AND external_thread_id = $2 AND principal_id = $3`,
    [input.clientType, input.externalThreadId, input.principalId],
  );
  return result.rows[0] === undefined
    ? undefined
    : mapClientThread(result.rows[0]);
}

async function assertThreadPrincipal(
  client: PoolClient,
  threadId: string,
  principalId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM chat_service.conversation_thread
     WHERE thread_id = $1 AND principal_id = $2`,
    [threadId, principalId],
  );
  if (result.rowCount !== 1) {
    throw new PersistenceAuthorizationError(
      "Thread is not authorized for principal",
    );
  }
}

interface InteractionTaskRow {
  readonly binding_id: string;
  readonly conversation_thread_id: string;
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

interface PrincipalRow {
  readonly principal_id: string;
  readonly issuer: string;
  readonly subject: string;
  readonly role: string;
}

interface ClientThreadRow {
  readonly binding_id: string;
  readonly client_type: ClientType;
  readonly external_thread_id: string;
  readonly principal_id: string;
  readonly internal_thread_id: string;
}

interface InteractionRequestRow {
  readonly request_id: string;
  readonly request_hash: string;
  readonly status: "CLAIMED" | "COMPLETED" | "FAILED";
  readonly result_kind: "TASK" | "MESSAGE" | null;
  readonly result_task_id: string | null;
  readonly result_context_id: string | null;
  readonly result_message_id: string | null;
  readonly result_related_task_id: string | null;
  readonly result_message_json: JsonValue | null;
  readonly result_rendered_text: string | null;
  readonly result_hash: string | null;
}

interface InteractionRunRow {
  readonly run_id: string;
  readonly protocol: InteractionProtocol;
  readonly principal_id: string;
  readonly thread_id: string;
  readonly external_request_id: string;
  readonly status: InteractionRun["status"];
  readonly task_id: string | null;
  readonly context_id: string | null;
  readonly last_sequence: string | number;
  readonly outcome_json: JsonValue | null;
}

interface InterruptRow {
  readonly interrupt_id: string;
  readonly run_id: string;
  readonly principal_id: string;
  readonly thread_id: string;
  readonly task_id: string;
  readonly context_id: string;
  readonly internal_phase: InterruptBinding["internalPhase"];
  readonly reason: InterruptBinding["reason"];
  readonly input_request_id: string | null;
  readonly response_schema_json: JsonValue | null;
  readonly response_schema_hash: string | null;
  readonly expires_at: Date;
  readonly status: InterruptBinding["status"];
  readonly resolution_hash: string | null;
  readonly resolution_claimed_at: Date | null;
  readonly resolved_at: Date | null;
  readonly version: string | number;
}

interface AgentCardRow {
  readonly snapshot_id: string;
  readonly content_hash: string;
  readonly protocol_version: string;
  readonly spec_patch: string;
  readonly binding: string;
  readonly safe_skills_json: JsonValue;
  readonly source_url_hash: string;
  readonly observed_at: Date;
}

const mapInteractionTask = (row: InteractionTaskRow): TaskBinding => ({
  bindingId: row.binding_id,
  threadId: row.conversation_thread_id,
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

type RequestResultColumns = readonly [
  resultKind: "TASK" | "MESSAGE",
  taskIdColumn: string | null,
  resultContextId: string | null,
  resultMessageId: string | null,
  resultRelatedTaskId: string | null,
  resultMessageJson: string | null,
  resultRenderedText: string | null,
  resultHash: string,
];

function requestResultColumns(
  value: CompletedRequestResult,
): RequestResultColumns {
  const result = parseCompletedRequestResult(value);
  if (
    result.kind === "message" &&
    result.message.messageId !== result.messageId
  ) {
    throw new PersistenceConflictError(
      "Completed Message result changed Message identity",
    );
  }
  const hash = createHash("sha256")
    .update(JSON.stringify(result))
    .digest("hex");
  return result.kind === "task"
    ? ["TASK", result.taskId, result.contextId, null, null, null, null, hash]
    : [
        "MESSAGE",
        null,
        result.contextId ?? null,
        result.messageId,
        result.relatedTaskId ?? null,
        JSON.stringify(result.message),
        result.renderedText,
        hash,
      ];
}

function mapCompletedRequestResult(
  row: InteractionRequestRow,
): CompletedRequestResult {
  if (
    row.result_kind === "TASK" &&
    row.result_task_id !== null &&
    row.result_context_id !== null
  ) {
    return parseCompletedRequestResult({
      kind: "task",
      taskId: row.result_task_id,
      contextId: row.result_context_id,
    });
  }
  if (
    row.result_kind === "MESSAGE" &&
    row.result_message_id !== null &&
    row.result_message_json !== null &&
    row.result_rendered_text !== null
  ) {
    return parseCompletedRequestResult({
      kind: "message",
      messageId: row.result_message_id,
      ...(row.result_related_task_id === null
        ? {}
        : { relatedTaskId: row.result_related_task_id }),
      ...(row.result_context_id === null
        ? {}
        : { contextId: row.result_context_id }),
      message: row.result_message_json,
      renderedText: row.result_rendered_text,
    });
  }
  throw new PersistenceConflictError(
    "Completed interaction request has no valid result",
  );
}

const mapPrincipal = (row: PrincipalRow): Principal => ({
  principalId: row.principal_id,
  issuer: row.issuer,
  subject: row.subject,
  role: row.role,
});

const mapClientThread = (row: ClientThreadRow): ClientThreadBinding => ({
  bindingId: row.binding_id,
  clientType: row.client_type,
  externalThreadId: row.external_thread_id,
  principalId: row.principal_id,
  threadId: row.internal_thread_id,
});

const mapRun = (row: InteractionRunRow): InteractionRun => ({
  runId: row.run_id,
  protocol: row.protocol,
  principalId: row.principal_id,
  threadId: row.thread_id,
  externalRequestId: row.external_request_id,
  status: row.status,
  ...(row.task_id === null ? {} : { taskId: row.task_id }),
  ...(row.context_id === null ? {} : { contextId: row.context_id }),
  lastSequence: Number(row.last_sequence),
  ...(row.outcome_json === null ? {} : { outcome: row.outcome_json }),
});

const mapInterrupt = (row: InterruptRow): InterruptBinding => ({
  interruptId: row.interrupt_id,
  runId: row.run_id,
  principalId: row.principal_id,
  threadId: row.thread_id,
  taskId: row.task_id,
  contextId: row.context_id,
  internalPhase: row.internal_phase,
  reason: row.reason,
  ...(row.input_request_id === null
    ? {}
    : { inputRequestId: row.input_request_id }),
  ...(row.response_schema_json === null
    ? {}
    : { responseSchema: row.response_schema_json }),
  ...(row.response_schema_hash === null
    ? {}
    : { responseSchemaHash: row.response_schema_hash }),
  expiresAt: row.expires_at.toISOString(),
  status: row.status,
  ...(row.resolution_hash === null
    ? {}
    : { resolutionHash: row.resolution_hash }),
  ...(row.resolution_claimed_at === null
    ? {}
    : { resolutionClaimedAt: row.resolution_claimed_at.toISOString() }),
  ...(row.resolved_at === null
    ? {}
    : { resolvedAt: row.resolved_at.toISOString() }),
  version: Number(row.version),
});

const mapAgentCard = (row: AgentCardRow): AgentCardSnapshot => ({
  snapshotId: row.snapshot_id,
  contentHash: row.content_hash,
  protocolVersion: row.protocol_version,
  specPatch: row.spec_patch,
  binding: row.binding,
  safeSkills: row.safe_skills_json,
  sourceUrlHash: row.source_url_hash,
  observedAt: row.observed_at.toISOString(),
});

function toTaskSummary(binding: TaskBinding): TaskSummary {
  if (
    binding.shortId === undefined ||
    binding.createdAt === undefined ||
    binding.updatedAt === undefined
  ) {
    throw new Error("Persisted Task binding is missing directory fields");
  }
  const pending = readPendingDirectoryFields(binding.pendingInput);
  return {
    bindingId: binding.bindingId,
    taskId: binding.sdarTaskId,
    contextId: binding.sdarContextId,
    shortId: binding.shortId,
    status: binding.status,
    ...(pending.internalPhase === undefined
      ? {}
      : { internalPhase: pending.internalPhase }),
    ...(pending.summary === undefined ? {} : { summary: pending.summary }),
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
    ...(binding.terminalAt === undefined
      ? {}
      : { terminalAt: binding.terminalAt }),
  };
}

function readPendingDirectoryFields(value: JsonValue | undefined): {
  readonly internalPhase?: string;
  readonly summary?: string;
} {
  if (value === undefined || value === null || Array.isArray(value)) return {};
  if (typeof value !== "object") return {};
  const internalPhase = value.internalPhase;
  const summary = value.summary;
  return {
    ...(typeof internalPhase === "string"
      ? { internalPhase: internalPhase.slice(0, 256) }
      : {}),
    ...(typeof summary === "string"
      ? { summary: summary.slice(0, 1_000) }
      : {}),
  };
}

async function selectAuthorizedBinding(
  client: PoolClient,
  input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly bindingId: string;
  },
): Promise<{ readonly binding_id: string } | undefined> {
  const result = await client.query<{ binding_id: string }>(
    `SELECT task.binding_id
     FROM chat_service.conversation_task_binding task
     JOIN chat_service.conversation_thread thread
       ON thread.thread_id = task.conversation_thread_id
     WHERE task.conversation_thread_id = $1 AND thread.principal_id = $2
       AND task.binding_id = $3
     FOR UPDATE OF task`,
    [input.threadId, input.principalId, input.bindingId],
  );
  return result.rows[0];
}

async function allocateShortId(
  client: PoolClient,
  threadId: string,
  taskId: string,
): Promise<string> {
  const result = await client.query<{ short_id: string }>(
    `SELECT short_id FROM chat_service.conversation_task_binding
     WHERE conversation_thread_id = $1`,
    [threadId],
  );
  const used = new Set(result.rows.map((row) => row.short_id));
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

async function touchTaskReference(
  client: PoolClient,
  threadId: string,
  bindingId: string,
): Promise<void> {
  await client.query(
    `UPDATE chat_service.conversation_task_binding
     SET last_interacted_at = now(), updated_at = now()
     WHERE conversation_thread_id = $1 AND binding_id = $2`,
    [threadId, bindingId],
  );
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

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function requiredRow<T>(rows: readonly T[], operation: string): T {
  const row = rows[0];
  if (row === undefined)
    throw new Error(`PostgreSQL returned no row for ${operation}`);
  return row;
}
