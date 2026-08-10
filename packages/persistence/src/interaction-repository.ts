import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

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
  Principal,
} from "./interaction-types.js";
import type { JsonValue, TaskBinding } from "./types.js";

export class InteractionPersistenceRepository {
  constructor(
    private readonly pool: Pool,
    private readonly defaultLeaseMs: number,
  ) {}

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

  async createTaskBinding(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly sdarTaskId: string;
    readonly sdarContextId: string;
    readonly status: string;
  }): Promise<TaskBinding> {
    await this.assertThread(input.threadId, input.principalId);
    try {
      const result = await this.pool.query<InteractionTaskRow>(
        `
          INSERT INTO chat_service.conversation_task_binding(
            binding_id, thread_id, conversation_thread_id, sdar_task_id,
            sdar_context_id, status
          ) VALUES ($1, NULL, $2, $3, $4, $5)
          RETURNING *
        `,
        [
          randomUUID(),
          input.threadId,
          input.sdarTaskId,
          input.sdarContextId,
          input.status,
        ],
      );
      return mapInteractionTask(
        requiredRow(result.rows, "interaction Task binding insert"),
      );
    } catch (error) {
      if (postgresCode(error) === "23505") {
        throw new PersistenceConflictError(
          "The interaction thread already has an active SDAR Task",
        );
      }
      throw error;
    }
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

  async findActiveTask(input: {
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<TaskBinding | undefined> {
    const result = await this.pool.query<InteractionTaskRow>(
      `
        SELECT task.*
        FROM chat_service.conversation_task_binding task
        JOIN chat_service.conversation_thread thread
          ON thread.thread_id = task.conversation_thread_id
        WHERE task.conversation_thread_id = $1
          AND thread.principal_id = $2
          AND task.terminal_at IS NULL
      `,
      [input.threadId, input.principalId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapInteractionTask(result.rows[0]);
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
          ...(row.result_task_id === null
            ? {}
            : { resultTaskId: row.result_task_id }),
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
    readonly resultTaskId?: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `
        UPDATE chat_service.interaction_request
        SET status = 'COMPLETED', lease_owner = NULL, lease_until = NULL,
            result_task_id = $4, updated_at = now()
        WHERE request_id = $1 AND principal_id = $2
          AND lease_owner = $3 AND status = 'CLAIMED'
      `,
      [
        input.requestId,
        input.principalId,
        input.leaseOwner,
        input.resultTaskId ?? null,
      ],
    );
    if (result.rowCount !== 1) {
      throw new PersistenceConflictError(
        "Interaction request completion conflict",
      );
    }
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
        SET status = $3, last_sequence = $4, outcome_json = $5,
            task_id = $6, context_id = $7, ended_at = now(), updated_at = now()
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
    input: Omit<InterruptBinding, "status" | "version" | "resolutionHash">,
  ): Promise<InterruptBinding> {
    await this.assertThread(input.threadId, input.principalId);
    const result = await this.pool.query<InterruptRow>(
      `
        INSERT INTO chat_service.agui_interrupt_binding(
          interrupt_id, run_id, principal_id, thread_id, task_id,
          context_id, internal_phase, input_request_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
        input.inputRequestId ?? null,
      ],
    );
    return mapInterrupt(requiredRow(result.rows, "interrupt insert"));
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
          AND status = 'OPEN'
      `,
      [input.interruptId, input.principalId, input.threadId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapInterrupt(result.rows[0]);
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
  readonly status: string;
  readonly pending_input_json: JsonValue | null;
  readonly last_status_timestamp: Date | null;
  readonly last_event_hash: string | null;
  readonly terminal_at: Date | null;
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
  readonly result_task_id: string | null;
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
  readonly input_request_id: string | null;
  readonly status: InterruptBinding["status"];
  readonly resolution_hash: string | null;
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
  ...(row.input_request_id === null
    ? {}
    : { inputRequestId: row.input_request_id }),
  status: row.status,
  ...(row.resolution_hash === null
    ? {}
    : { resolutionHash: row.resolution_hash }),
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
