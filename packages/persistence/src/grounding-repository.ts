import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { hashJson } from "./hash.js";
import {
  PersistenceAuthorizationError,
  PersistenceConflictError,
} from "./repository.js";
import type { JsonValue } from "./types.js";

export const groundingStates = [
  "GROUNDING_PENDING",
  "GROUNDING_READY",
  "SDAR_SUBMISSION_RESERVED",
  "SDAR_SUBMITTED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type GroundingState = (typeof groundingStates)[number];

export interface GroundingExecution {
  readonly groundingId: string;
  readonly principalId: string;
  readonly threadId: string;
  readonly interactionRequestId: string;
  readonly wsgsRequestId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly wsgsOperation: string;
  readonly requestedProducts: readonly string[];
  readonly contextUsage: Readonly<Record<string, JsonValue>>;
  readonly state: GroundingState;
  readonly wsgsGroundingId?: string;
  readonly groundingResultHash?: string;
  readonly groundingResult?: JsonValue;
  readonly operationalBundleHash?: string;
  readonly operationalBundle?: JsonValue;
  readonly sdarSubmissionKey?: string;
  readonly sdarTaskId?: string;
  readonly sdarContextId?: string;
  readonly failureCode?: string;
  readonly leaseOwner?: string;
  readonly leaseUntil?: Date;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly terminalAt?: Date;
}

export interface GroundingEvent {
  readonly eventId: string;
  readonly groundingId: string;
  readonly sequence: number;
  readonly eventKind: string;
  readonly fromState?: GroundingState;
  readonly toState: GroundingState;
  readonly eventHash: string;
  readonly payload: Readonly<Record<string, JsonValue>>;
  readonly createdAt: Date;
}

export type GroundingClaim =
  | { readonly kind: "CREATED"; readonly execution: GroundingExecution }
  | { readonly kind: "ACQUIRED"; readonly execution: GroundingExecution }
  | { readonly kind: "BUSY"; readonly execution: GroundingExecution }
  | { readonly kind: "REPLAY"; readonly execution: GroundingExecution };

export class GroundingPersistenceRepository {
  constructor(
    private readonly pool: Pool,
    private readonly defaultLeaseMs: number,
  ) {}

  async claim(input: {
    readonly groundingId: string;
    readonly principalId: string;
    readonly threadId: string;
    readonly interactionRequestId: string;
    readonly wsgsRequestId: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly wsgsOperation: string;
    readonly requestedProducts: readonly string[];
    readonly contextUsage: Readonly<Record<string, JsonValue>>;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<GroundingClaim> {
    const leaseMs = input.leaseMs ?? this.defaultLeaseMs;
    assertLeaseMs(leaseMs);
    return this.transaction(async (client) => {
      await assertAuthorizedRequest(client, input);
      const inserted = await client.query<GroundingRow>(
        `
          INSERT INTO chat_service.grounding_execution(
            grounding_id, principal_id, thread_id, interaction_request_id,
            wsgs_request_id, idempotency_key, request_hash, wsgs_operation,
            requested_products_json, context_usage_json, state,
            lease_owner, lease_until
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
            'GROUNDING_PENDING', $11,
            now() + ($12::bigint * interval '1 millisecond')
          )
          ON CONFLICT (principal_id, thread_id, idempotency_key) DO NOTHING
          RETURNING *
        `,
        [
          input.groundingId,
          input.principalId,
          input.threadId,
          input.interactionRequestId,
          input.wsgsRequestId,
          input.idempotencyKey,
          input.requestHash,
          input.wsgsOperation,
          JSON.stringify(input.requestedProducts),
          JSON.stringify(input.contextUsage),
          input.leaseOwner,
          leaseMs,
        ],
      );
      const created = inserted.rows[0];
      if (created !== undefined) {
        await appendEvent(client, {
          groundingId: created.grounding_id,
          eventKind: "GROUNDING_CLAIMED",
          toState: "GROUNDING_PENDING",
          payload: { leaseOwner: input.leaseOwner },
        });
        return { kind: "CREATED", execution: mapExecution(created) };
      }

      const existing = await selectByIdempotencyForUpdate(client, input);
      if (existing.request_hash !== input.requestHash) {
        throw new PersistenceConflictError(
          "Grounding idempotency key was reused with a different request",
        );
      }
      if (existing.state !== "GROUNDING_PENDING") {
        return { kind: "REPLAY", execution: mapExecution(existing) };
      }
      if (
        existing.lease_owner !== null &&
        existing.lease_owner !== input.leaseOwner &&
        existing.lease_until !== null &&
        existing.lease_until.getTime() > Date.now()
      ) {
        return { kind: "BUSY", execution: mapExecution(existing) };
      }
      const acquired = await client.query<GroundingRow>(
        `
          UPDATE chat_service.grounding_execution
          SET lease_owner = $2,
              lease_until = now() + ($3::bigint * interval '1 millisecond'),
              version = version + 1
          WHERE grounding_id = $1
          RETURNING *
        `,
        [existing.grounding_id, input.leaseOwner, leaseMs],
      );
      const row = requiredRow(acquired.rows, "grounding lease acquisition");
      await appendEvent(client, {
        groundingId: row.grounding_id,
        eventKind: "GROUNDING_LEASE_ACQUIRED",
        fromState: row.state,
        toState: row.state,
        payload: { leaseOwner: input.leaseOwner },
      });
      return { kind: "ACQUIRED", execution: mapExecution(row) };
    });
  }

  async recordGroundingReady(input: {
    readonly groundingId: string;
    readonly principalId: string;
    readonly threadId: string;
    readonly leaseOwner: string;
    readonly wsgsGroundingId: string;
    readonly resultHash: string;
    readonly result: JsonValue;
  }): Promise<GroundingExecution> {
    return this.transaction(async (client) => {
      const current = await selectAuthorizedForUpdate(client, input);
      if (current.state !== "GROUNDING_PENDING") {
        if (
          current.wsgs_grounding_id === input.wsgsGroundingId &&
          current.grounding_result_hash === input.resultHash
        ) {
          return mapExecution(current);
        }
        throw new PersistenceConflictError(
          "Grounding result conflicts with durable state",
        );
      }
      assertActiveLease(current, input.leaseOwner);
      const updated = await client.query<GroundingRow>(
        `
          UPDATE chat_service.grounding_execution
          SET state = 'GROUNDING_READY',
              wsgs_grounding_id = $4,
              grounding_result_hash = $5,
              grounding_result_json = $6::jsonb,
              lease_owner = NULL,
              lease_until = NULL,
              version = version + 1
          WHERE grounding_id = $1 AND principal_id = $2 AND thread_id = $3
          RETURNING *
        `,
        [
          input.groundingId,
          input.principalId,
          input.threadId,
          input.wsgsGroundingId,
          input.resultHash,
          JSON.stringify(input.result),
        ],
      );
      const row = requiredRow(updated.rows, "grounding ready transition");
      await appendTransition(client, current, row, "GROUNDING_READY", {
        resultHash: input.resultHash,
      });
      return mapExecution(row);
    });
  }

  async reserveSdarSubmission(input: {
    readonly groundingId: string;
    readonly principalId: string;
    readonly threadId: string;
    readonly submissionKey: string;
    readonly bundleHash: string;
    readonly bundle: JsonValue;
    readonly leaseOwner: string;
    readonly leaseMs?: number;
  }): Promise<GroundingExecution> {
    const leaseMs = input.leaseMs ?? this.defaultLeaseMs;
    assertLeaseMs(leaseMs);
    return this.transaction(async (client) => {
      const current = await selectAuthorizedForUpdate(client, input);
      if (current.state !== "GROUNDING_READY") {
        if (
          current.sdar_submission_key === input.submissionKey &&
          current.operational_bundle_hash === input.bundleHash
        ) {
          return mapExecution(current);
        }
        throw new PersistenceConflictError(
          "SDAR submission reservation conflicts with durable state",
        );
      }
      const updated = await client.query<GroundingRow>(
        `
          UPDATE chat_service.grounding_execution
          SET state = 'SDAR_SUBMISSION_RESERVED',
              sdar_submission_key = $4,
              operational_bundle_hash = $5,
              operational_bundle_json = $6::jsonb,
              lease_owner = $7,
              lease_until = now() + ($8::bigint * interval '1 millisecond'),
              version = version + 1
          WHERE grounding_id = $1 AND principal_id = $2 AND thread_id = $3
          RETURNING *
        `,
        [
          input.groundingId,
          input.principalId,
          input.threadId,
          input.submissionKey,
          input.bundleHash,
          JSON.stringify(input.bundle),
          input.leaseOwner,
          leaseMs,
        ],
      );
      const row = requiredRow(updated.rows, "SDAR reservation transition");
      await appendTransition(client, current, row, "SDAR_SUBMISSION_RESERVED", {
        submissionKey: input.submissionKey,
        bundleHash: input.bundleHash,
      });
      return mapExecution(row);
    });
  }

  async recordSdarSubmitted(input: {
    readonly groundingId: string;
    readonly principalId: string;
    readonly threadId: string;
    readonly leaseOwner: string;
    readonly submissionKey: string;
    readonly taskId: string;
    readonly contextId: string;
  }): Promise<GroundingExecution> {
    return this.transaction(async (client) => {
      const current = await selectAuthorizedForUpdate(client, input);
      if (current.state !== "SDAR_SUBMISSION_RESERVED") {
        if (
          current.sdar_submission_key === input.submissionKey &&
          current.sdar_task_id === input.taskId &&
          current.sdar_context_id === input.contextId
        ) {
          return mapExecution(current);
        }
        throw new PersistenceConflictError(
          "SDAR submission result conflicts with durable state",
        );
      }
      if (current.sdar_submission_key !== input.submissionKey) {
        throw new PersistenceConflictError("SDAR submission key changed");
      }
      assertActiveLease(current, input.leaseOwner);
      const updated = await client.query<GroundingRow>(
        `
          UPDATE chat_service.grounding_execution
          SET state = 'SDAR_SUBMITTED',
              sdar_task_id = $4,
              sdar_context_id = $5,
              lease_owner = NULL,
              lease_until = NULL,
              version = version + 1
          WHERE grounding_id = $1 AND principal_id = $2 AND thread_id = $3
          RETURNING *
        `,
        [
          input.groundingId,
          input.principalId,
          input.threadId,
          input.taskId,
          input.contextId,
        ],
      );
      const row = requiredRow(updated.rows, "SDAR submitted transition");
      await appendTransition(client, current, row, "SDAR_SUBMITTED", {
        submissionKey: input.submissionKey,
        taskId: input.taskId,
        contextId: input.contextId,
      });
      return mapExecution(row);
    });
  }

  complete(input: GroundingIdentity): Promise<GroundingExecution> {
    return this.transitionTerminal(input, "COMPLETED", "GROUNDING_COMPLETED");
  }

  fail(
    input: GroundingIdentity & { readonly failureCode: string },
  ): Promise<GroundingExecution> {
    return this.transitionTerminal(
      input,
      "FAILED",
      "GROUNDING_FAILED",
      input.failureCode,
    );
  }

  cancel(input: GroundingIdentity): Promise<GroundingExecution> {
    return this.transitionTerminal(input, "CANCELLED", "GROUNDING_CANCELLED");
  }

  async claimRecoverable(input: {
    readonly leaseOwner: string;
    readonly leaseMs?: number;
    readonly limit?: number;
  }): Promise<readonly GroundingExecution[]> {
    const leaseMs = input.leaseMs ?? this.defaultLeaseMs;
    const limit = input.limit ?? 32;
    assertLeaseMs(leaseMs);
    if (!Number.isInteger(limit) || limit < 1 || limit > 256) {
      throw new Error("recovery limit must be an integer from 1 to 256");
    }
    return this.transaction(async (client) => {
      const candidates = await client.query<GroundingRow>(
        `
          SELECT *
          FROM chat_service.grounding_execution
          WHERE state IN ('GROUNDING_PENDING', 'SDAR_SUBMISSION_RESERVED')
            AND (lease_until IS NULL OR lease_until <= now())
          ORDER BY created_at, grounding_id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        `,
        [limit],
      );
      const recovered: GroundingExecution[] = [];
      for (const candidate of candidates.rows) {
        const updated = await client.query<GroundingRow>(
          `
            UPDATE chat_service.grounding_execution
            SET lease_owner = $2,
                lease_until = now() + ($3::bigint * interval '1 millisecond'),
                version = version + 1
            WHERE grounding_id = $1
            RETURNING *
          `,
          [candidate.grounding_id, input.leaseOwner, leaseMs],
        );
        const row = requiredRow(updated.rows, "grounding recovery lease");
        await appendEvent(client, {
          groundingId: row.grounding_id,
          eventKind: "GROUNDING_RECOVERED",
          fromState: row.state,
          toState: row.state,
          payload: { leaseOwner: input.leaseOwner },
        });
        recovered.push(mapExecution(row));
      }
      return recovered;
    });
  }

  async releaseLease(
    input: GroundingIdentity & { readonly leaseOwner: string },
  ): Promise<boolean> {
    return this.transaction(async (client) => {
      const current = await selectAuthorizedForUpdate(client, input);
      if (current.lease_owner !== input.leaseOwner) return false;
      const released = await client.query<GroundingRow>(
        `
          UPDATE chat_service.grounding_execution
          SET lease_owner = NULL, lease_until = NULL, version = version + 1
          WHERE grounding_id = $1 AND principal_id = $2 AND thread_id = $3
          RETURNING *
        `,
        [input.groundingId, input.principalId, input.threadId],
      );
      const row = requiredRow(released.rows, "grounding lease release");
      await appendEvent(client, {
        groundingId: row.grounding_id,
        eventKind: "GROUNDING_LEASE_RELEASED",
        fromState: row.state,
        toState: row.state,
        payload: { leaseOwner: input.leaseOwner },
      });
      return true;
    });
  }

  async get(input: GroundingIdentity): Promise<GroundingExecution | undefined> {
    const result = await this.pool.query<GroundingRow>(
      `
        SELECT execution.*
        FROM chat_service.grounding_execution execution
        JOIN chat_service.conversation_thread thread
          ON thread.thread_id = execution.thread_id
        WHERE execution.grounding_id = $1
          AND execution.principal_id = $2
          AND execution.thread_id = $3
          AND thread.principal_id = $2
      `,
      [input.groundingId, input.principalId, input.threadId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapExecution(result.rows[0]);
  }

  async events(input: GroundingIdentity): Promise<readonly GroundingEvent[]> {
    if ((await this.get(input)) === undefined) {
      throw new PersistenceAuthorizationError(
        "Grounding is not authorized for principal",
      );
    }
    const result = await this.pool.query<GroundingEventRow>(
      `
        SELECT *
        FROM chat_service.grounding_event
        WHERE grounding_id = $1
        ORDER BY sequence
      `,
      [input.groundingId],
    );
    return result.rows.map(mapEvent);
  }

  private async transitionTerminal(
    input: GroundingIdentity,
    state: "COMPLETED" | "FAILED" | "CANCELLED",
    eventKind: string,
    failureCode?: string,
  ): Promise<GroundingExecution> {
    return this.transaction(async (client) => {
      const current = await selectAuthorizedForUpdate(client, input);
      if (current.state === state) return mapExecution(current);
      if (isTerminal(current.state)) {
        throw new PersistenceConflictError(
          "Terminal grounding state cannot be reopened",
        );
      }
      if (
        state === "COMPLETED" &&
        !["GROUNDING_READY", "SDAR_SUBMITTED"].includes(current.state)
      ) {
        throw new PersistenceConflictError(
          "Grounding cannot complete from the current state",
        );
      }
      const updated = await client.query<GroundingRow>(
        `
          UPDATE chat_service.grounding_execution
          SET state = $4,
              failure_code = $5,
              lease_owner = NULL,
              lease_until = NULL,
              terminal_at = now(),
              version = version + 1
          WHERE grounding_id = $1 AND principal_id = $2 AND thread_id = $3
          RETURNING *
        `,
        [
          input.groundingId,
          input.principalId,
          input.threadId,
          state,
          failureCode ?? null,
        ],
      );
      const row = requiredRow(updated.rows, "grounding terminal transition");
      await appendTransition(client, current, row, eventKind, {
        ...(failureCode === undefined ? {} : { failureCode }),
      });
      return mapExecution(row);
    });
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

interface GroundingIdentity {
  readonly groundingId: string;
  readonly principalId: string;
  readonly threadId: string;
}

interface GroundingRow {
  grounding_id: string;
  principal_id: string;
  thread_id: string;
  interaction_request_id: string;
  wsgs_request_id: string;
  idempotency_key: string;
  request_hash: string;
  wsgs_operation: string;
  requested_products_json: string[];
  context_usage_json: Record<string, JsonValue>;
  state: GroundingState;
  wsgs_grounding_id: string | null;
  grounding_result_hash: string | null;
  grounding_result_json: JsonValue | null;
  operational_bundle_hash: string | null;
  operational_bundle_json: JsonValue | null;
  sdar_submission_key: string | null;
  sdar_task_id: string | null;
  sdar_context_id: string | null;
  failure_code: string | null;
  lease_owner: string | null;
  lease_until: Date | null;
  version: string | number;
  created_at: Date;
  updated_at: Date;
  terminal_at: Date | null;
}

interface GroundingEventRow {
  event_id: string;
  grounding_id: string;
  sequence: string | number;
  event_kind: string;
  from_state: GroundingState | null;
  to_state: GroundingState;
  event_hash: string;
  payload_json: Record<string, JsonValue>;
  created_at: Date;
}

async function assertAuthorizedRequest(
  client: PoolClient,
  input: {
    readonly interactionRequestId: string;
    readonly principalId: string;
    readonly threadId: string;
  },
): Promise<void> {
  const result = await client.query(
    `
      SELECT request.request_id
      FROM chat_service.interaction_request request
      JOIN chat_service.conversation_thread thread
        ON thread.thread_id = request.thread_id
      WHERE request.request_id = $1
        AND request.principal_id = $2
        AND request.thread_id = $3
        AND thread.principal_id = $2
      FOR UPDATE OF request
    `,
    [input.interactionRequestId, input.principalId, input.threadId],
  );
  if (result.rowCount !== 1) {
    throw new PersistenceAuthorizationError(
      "Interaction request is not authorized for grounding",
    );
  }
}

async function selectByIdempotencyForUpdate(
  client: PoolClient,
  input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly idempotencyKey: string;
  },
): Promise<GroundingRow> {
  const result = await client.query<GroundingRow>(
    `
      SELECT *
      FROM chat_service.grounding_execution
      WHERE principal_id = $1 AND thread_id = $2 AND idempotency_key = $3
      FOR UPDATE
    `,
    [input.principalId, input.threadId, input.idempotencyKey],
  );
  return requiredRow(result.rows, "grounding idempotency lookup");
}

async function selectAuthorizedForUpdate(
  client: PoolClient,
  input: GroundingIdentity,
): Promise<GroundingRow> {
  const result = await client.query<GroundingRow>(
    `
      SELECT execution.*
      FROM chat_service.grounding_execution execution
      JOIN chat_service.conversation_thread thread
        ON thread.thread_id = execution.thread_id
      WHERE execution.grounding_id = $1
        AND execution.principal_id = $2
        AND execution.thread_id = $3
        AND thread.principal_id = $2
      FOR UPDATE OF execution
    `,
    [input.groundingId, input.principalId, input.threadId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new PersistenceAuthorizationError(
      "Grounding is not authorized for principal",
    );
  }
  return row;
}

async function appendTransition(
  client: PoolClient,
  from: GroundingRow,
  to: GroundingRow,
  eventKind: string,
  payload: Record<string, JsonValue>,
): Promise<void> {
  await appendEvent(client, {
    groundingId: to.grounding_id,
    eventKind,
    fromState: from.state,
    toState: to.state,
    payload,
  });
}

async function appendEvent(
  client: PoolClient,
  input: {
    readonly groundingId: string;
    readonly eventKind: string;
    readonly fromState?: GroundingState;
    readonly toState: GroundingState;
    readonly payload: Record<string, JsonValue>;
  },
): Promise<void> {
  const sequenceResult = await client.query<{ next_sequence: string | number }>(
    `
      SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
      FROM chat_service.grounding_event
      WHERE grounding_id = $1
    `,
    [input.groundingId],
  );
  const sequence = Number(
    requiredRow(sequenceResult.rows, "grounding event sequence").next_sequence,
  );
  const eventId = randomUUID();
  const eventHash = hashJson({
    eventId,
    groundingId: input.groundingId,
    sequence,
    eventKind: input.eventKind,
    fromState: input.fromState ?? null,
    toState: input.toState,
    payload: input.payload,
  });
  await client.query(
    `
      INSERT INTO chat_service.grounding_event(
        event_id, grounding_id, sequence, event_kind,
        from_state, to_state, event_hash, payload_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      eventId,
      input.groundingId,
      sequence,
      input.eventKind,
      input.fromState ?? null,
      input.toState,
      eventHash,
      JSON.stringify(input.payload),
    ],
  );
}

function assertActiveLease(row: GroundingRow, owner: string): void {
  if (
    row.lease_owner !== owner ||
    row.lease_until === null ||
    row.lease_until.getTime() <= Date.now()
  ) {
    throw new PersistenceConflictError("Grounding lease is not active");
  }
}

function isTerminal(state: GroundingState): boolean {
  return ["COMPLETED", "FAILED", "CANCELLED"].includes(state);
}

function assertLeaseMs(value: number): void {
  if (!Number.isInteger(value) || value < 1_000 || value > 30 * 60_000) {
    throw new Error("leaseMs must be an integer from 1000 through 1800000");
  }
}

function mapExecution(row: GroundingRow): GroundingExecution {
  return {
    groundingId: row.grounding_id,
    principalId: row.principal_id,
    threadId: row.thread_id,
    interactionRequestId: row.interaction_request_id,
    wsgsRequestId: row.wsgs_request_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    wsgsOperation: row.wsgs_operation,
    requestedProducts: row.requested_products_json,
    contextUsage: row.context_usage_json,
    state: row.state,
    ...(row.wsgs_grounding_id === null
      ? {}
      : { wsgsGroundingId: row.wsgs_grounding_id }),
    ...(row.grounding_result_hash === null
      ? {}
      : { groundingResultHash: row.grounding_result_hash }),
    ...(row.grounding_result_json === null
      ? {}
      : { groundingResult: row.grounding_result_json }),
    ...(row.operational_bundle_hash === null
      ? {}
      : { operationalBundleHash: row.operational_bundle_hash }),
    ...(row.operational_bundle_json === null
      ? {}
      : { operationalBundle: row.operational_bundle_json }),
    ...(row.sdar_submission_key === null
      ? {}
      : { sdarSubmissionKey: row.sdar_submission_key }),
    ...(row.sdar_task_id === null ? {} : { sdarTaskId: row.sdar_task_id }),
    ...(row.sdar_context_id === null
      ? {}
      : { sdarContextId: row.sdar_context_id }),
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.lease_until === null ? {} : { leaseUntil: row.lease_until }),
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.terminal_at === null ? {} : { terminalAt: row.terminal_at }),
  };
}

function mapEvent(row: GroundingEventRow): GroundingEvent {
  return {
    eventId: row.event_id,
    groundingId: row.grounding_id,
    sequence: Number(row.sequence),
    eventKind: row.event_kind,
    ...(row.from_state === null ? {} : { fromState: row.from_state }),
    toState: row.to_state,
    eventHash: row.event_hash,
    payload: row.payload_json,
    createdAt: row.created_at,
  };
}

function requiredRow<T>(rows: readonly T[], operation: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new PersistenceConflictError(operation + " did not return a row");
  }
  return row;
}
