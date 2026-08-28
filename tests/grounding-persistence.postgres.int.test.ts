import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import pg from "pg";

import {
  GroundingPersistenceRepository,
  PersistenceConflictError,
  runMigrations,
} from "../packages/persistence/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const groundingDatabaseName = `sacs_grounding_${randomUUID().replaceAll("-", "")}`;
const groundingConnectionString =
  connectionString === undefined
    ? undefined
    : withDatabase(connectionString, groundingDatabaseName);
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;

describeWithPostgres("SACS v0.4 grounding persistence on PostgreSQL", () => {
  const adminPool = new Pool({ connectionString, max: 1 });
  const pool = new Pool({
    connectionString: groundingConnectionString,
    max: 8,
  });
  const repository = new GroundingPersistenceRepository(pool, 60_000);

  beforeAll(async () => {
    const database = await adminPool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    expect(database.rows[0]?.database_name).toBe("single_agent_chat_phase4");
    await adminPool.query(`CREATE DATABASE "${groundingDatabaseName}"`);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
    await adminPool.end();
  });

  it("persists one forward lifecycle and replays without a second WSGS claim", async () => {
    const identity = await seedInteraction();
    const groundingId = `grounding-` + randomUUID();
    const idempotencyKey = `grounding-key-` + randomUUID();
    const claimInput = {
      groundingId,
      ...identity,
      wsgsRequestId: `wsgs-request-` + randomUUID(),
      idempotencyKey,
      requestHash: "a".repeat(64),
      wsgsOperation: "EXECUTE_WORLD_QUERY",
      requestedProducts: ["MENTIONS", "WORLD_EVIDENCE"],
      contextUsage: { latestUserTurn: true },
      leaseOwner: "grounding-worker-a",
    } as const;

    const created = await repository.claim(claimInput);
    expect(created).toMatchObject({
      kind: "CREATED",
      execution: { groundingId, state: "GROUNDING_PENDING", version: 0 },
    });

    await expect(
      repository.claim({ ...claimInput, leaseOwner: "grounding-worker-b" }),
    ).resolves.toMatchObject({ kind: "BUSY" });

    const resultHash = `sha256:` + "b".repeat(64);
    const ready = await repository.recordGroundingReady({
      groundingId,
      ...identity,
      leaseOwner: "grounding-worker-a",
      wsgsGroundingId: `wsgs-grounding-` + randomUUID(),
      resultHash,
      result: { status: "SUCCEEDED", resultVersion: "0.2.0" },
    });
    expect(ready).toMatchObject({
      state: "GROUNDING_READY",
      groundingResultHash: resultHash,
      version: 1,
    });

    await expect(
      repository.claim({ ...claimInput, leaseOwner: "grounding-worker-c" }),
    ).resolves.toMatchObject({
      kind: "REPLAY",
      execution: { state: "GROUNDING_READY", version: 1 },
    });

    const submissionKey = `sdar-grounding-` + randomUUID();
    const bundleHash = "c".repeat(64);
    const reserved = await repository.reserveSdarSubmission({
      groundingId,
      ...identity,
      submissionKey,
      bundleHash,
      bundle: { groundingResultHash: resultHash, schemaVersion: "1.0" },
      leaseOwner: "sdar-worker-a",
    });
    expect(reserved).toMatchObject({
      state: "SDAR_SUBMISSION_RESERVED",
      sdarSubmissionKey: submissionKey,
      version: 2,
    });

    await expect(
      repository.reserveSdarSubmission({
        groundingId,
        ...identity,
        submissionKey,
        bundleHash,
        bundle: { groundingResultHash: resultHash, schemaVersion: "1.0" },
        leaseOwner: "sdar-worker-b",
      }),
    ).resolves.toMatchObject({
      state: "SDAR_SUBMISSION_RESERVED",
      version: 2,
    });

    const submitted = await repository.recordSdarSubmitted({
      groundingId,
      ...identity,
      leaseOwner: "sdar-worker-a",
      submissionKey,
      taskId: `sdar-task-` + randomUUID(),
      contextId: `sdar-context-` + randomUUID(),
    });
    expect(submitted).toMatchObject({ state: "SDAR_SUBMITTED", version: 3 });

    const completed = await repository.complete({ groundingId, ...identity });
    expect(completed).toMatchObject({
      state: "COMPLETED",
      version: 4,
      terminalAt: expect.any(Date),
    });

    await expect(repository.claim(claimInput)).resolves.toMatchObject({
      kind: "REPLAY",
      execution: { state: "COMPLETED", version: 4 },
    });
    await expect(
      repository.claim({ ...claimInput, requestHash: "d".repeat(64) }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);

    const events = await repository.events({ groundingId, ...identity });
    expect(
      events.map(({ sequence, eventKind }) => [sequence, eventKind]),
    ).toEqual([
      [1, "GROUNDING_CLAIMED"],
      [2, "GROUNDING_READY"],
      [3, "SDAR_SUBMISSION_RESERVED"],
      [4, "SDAR_SUBMITTED"],
      [5, "GROUNDING_COMPLETED"],
    ]);
    expect(new Set(events.map(({ eventHash }) => eventHash)).size).toBe(5);
  });

  it("recovers only expired WSGS and SDAR reservation leases", async () => {
    const pending = await createPending("pending-recovery-worker");
    const reserved = await createReserved("reservation-recovery-worker");

    await pool.query(
      `
        UPDATE chat_service.grounding_execution
        SET lease_until = now() - interval '1 second', version = version + 1
        WHERE grounding_id = ANY($1::text[])
      `,
      [[pending.groundingId, reserved.groundingId]],
    );

    const recovered = await repository.claimRecoverable({
      leaseOwner: "restart-worker",
      leaseMs: 90_000,
      limit: 8,
    });
    expect(recovered.map(({ groundingId }) => groundingId).sort()).toEqual(
      [pending.groundingId, reserved.groundingId].sort(),
    );
    expect(
      recovered.map(({ state, leaseOwner }) => ({ state, leaseOwner })),
    ).toEqual(
      expect.arrayContaining([
        { state: "GROUNDING_PENDING", leaseOwner: "restart-worker" },
        {
          state: "SDAR_SUBMISSION_RESERVED",
          leaseOwner: "restart-worker",
        },
      ]),
    );

    await expect(
      repository.claim({
        ...pending.claimInput,
        leaseOwner: "competing-restart-worker",
      }),
    ).resolves.toMatchObject({ kind: "BUSY" });
    for (const recoveredExecution of recovered) {
      const events = await repository.events({
        groundingId: recoveredExecution.groundingId,
        principalId: recoveredExecution.principalId,
        threadId: recoveredExecution.threadId,
      });
      expect(events.at(-1)?.eventKind).toBe("GROUNDING_RECOVERED");
      await repository.cancel({
        groundingId: recoveredExecution.groundingId,
        principalId: recoveredExecution.principalId,
        threadId: recoveredExecution.threadId,
      });
    }
  });

  it("rejects event mutation, terminal mutation, and cross-principal reads", async () => {
    const identity = await seedInteraction();
    const groundingId = `grounding-` + randomUUID();
    const claimInput = {
      groundingId,
      ...identity,
      wsgsRequestId: `wsgs-request-` + randomUUID(),
      idempotencyKey: `grounding-key-` + randomUUID(),
      requestHash: "e".repeat(64),
      wsgsOperation: "VALIDATE_REFERENCES",
      requestedProducts: ["RESOLVED_REFERENCES"],
      contextUsage: {},
      leaseOwner: "guard-worker",
    } as const;
    await repository.claim(claimInput);
    await repository.fail({
      groundingId,
      ...identity,
      failureCode: "WSGS_RESULT_INVALID",
    });

    await expect(
      pool.query(
        `
          UPDATE chat_service.grounding_event
          SET payload_json = '{"tampered":true}'::jsonb
          WHERE grounding_id = $1
        `,
        [groundingId],
      ),
    ).rejects.toThrow("grounding events are append-only");
    await expect(
      pool.query(
        "DELETE FROM chat_service.grounding_event WHERE grounding_id = $1",
        [groundingId],
      ),
    ).rejects.toThrow("grounding events are append-only");
    await expect(
      pool.query("TRUNCATE TABLE chat_service.grounding_event"),
    ).rejects.toThrow("grounding events are append-only");
    await expect(
      pool.query(
        `
          UPDATE chat_service.grounding_execution
          SET lease_owner = 'tamper', lease_until = now(), version = version + 1
          WHERE grounding_id = $1
        `,
        [groundingId],
      ),
    ).rejects.toThrow("terminal grounding rows cannot change");

    await expect(
      repository.get({
        groundingId,
        principalId: `other-principal-` + randomUUID(),
        threadId: identity.threadId,
      }),
    ).resolves.toBeUndefined();
  });

  async function createPending(leaseOwner: string) {
    const identity = await seedInteraction();
    const groundingId = `grounding-` + randomUUID();
    const claimInput = {
      groundingId,
      ...identity,
      wsgsRequestId: `wsgs-request-` + randomUUID(),
      idempotencyKey: `grounding-key-` + randomUUID(),
      requestHash: "f".repeat(64),
      wsgsOperation: "GROUND_REFERENCES",
      requestedProducts: ["MENTIONS", "RESOLVED_REFERENCES"],
      contextUsage: { activeTask: true },
      leaseOwner,
      leaseMs: 60_000,
    } as const;
    await repository.claim(claimInput);
    return { groundingId, claimInput };
  }

  async function createReserved(leaseOwner: string) {
    const pending = await createPending(leaseOwner);
    const identity = {
      principalId: pending.claimInput.principalId,
      threadId: pending.claimInput.threadId,
    };
    const resultHash = `sha256:` + "1".repeat(64);
    await repository.recordGroundingReady({
      groundingId: pending.groundingId,
      ...identity,
      leaseOwner,
      wsgsGroundingId: `wsgs-grounding-` + randomUUID(),
      resultHash,
      result: { status: "SUCCEEDED" },
    });
    await repository.reserveSdarSubmission({
      groundingId: pending.groundingId,
      ...identity,
      submissionKey: `sdar-grounding-` + randomUUID(),
      bundleHash: "2".repeat(64),
      bundle: { groundingResultHash: resultHash },
      leaseOwner,
    });
    return pending;
  }

  async function seedInteraction() {
    const principalId = `s03-principal-` + randomUUID();
    const threadId = `s03-thread-` + randomUUID();
    const interactionRequestId = `s03-request-` + randomUUID();
    await pool.query(
      `
        INSERT INTO chat_service.principal(principal_id, issuer, subject, role)
        VALUES ($1, 's03-test', $1, 'user')
      `,
      [principalId],
    );
    await pool.query(
      `
        INSERT INTO chat_service.conversation_thread(thread_id, principal_id)
        VALUES ($1, $2)
      `,
      [threadId, principalId],
    );
    await pool.query(
      `
        INSERT INTO chat_service.interaction_request(
          request_id, protocol, external_request_id, principal_id, thread_id,
          request_hash, status, lease_owner, lease_until
        ) VALUES ($1, 'openai', $1, $2, $3, $4, 'CLAIMED', 's03-test',
                  now() + interval '1 hour')
      `,
      [interactionRequestId, principalId, threadId, "9".repeat(64)],
    );
    return { principalId, threadId, interactionRequestId };
  }
});

function withDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}
