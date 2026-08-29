import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import pg from "pg";

import {
  hashWorldExplanation,
  parseWorldExplanationV1,
  type ExplanationReplayKey,
  type WorldExplanationV1,
} from "../packages/world-explanation-contract/src/index.js";
import {
  PersistenceAuthorizationError,
  PersistenceConflictError,
  PostgresWorldFocusRepository,
  runMigrations,
  WorldExplanationRepository,
} from "../packages/persistence/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const databaseName =
  "sacs_world_explanation_" + randomUUID().replaceAll("-", "");
const isolatedConnection =
  connectionString === undefined
    ? undefined
    : withDatabase(connectionString, databaseName);
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;
const resultHash = "sha256:" + "a".repeat(64);
const contractHash = "sha256:" + "b".repeat(64);
const rendererPolicyHash = "sha256:" + "c".repeat(64);
const referenceKey = {
  namespace: "gowm" as const,
  kind: "vehicle",
  id: "wrf_" + "1".repeat(32),
  version: "world-1",
};

describeWithPostgres("SACS v0.4 S19 world explanation PostgreSQL", () => {
  const adminPool = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString: isolatedConnection, max: 12 });
  const repository = new WorldExplanationRepository(pool);
  const focusRepository = new PostgresWorldFocusRepository(pool);
  let frozenMigrationDirectory = "";

  beforeAll(async () => {
    await adminPool.query('CREATE DATABASE "' + databaseName + '"');
    frozenMigrationDirectory = await mkdtemp(join(tmpdir(), "sacs-v04-s19-"));
    for (let version = 1; version <= 10; version += 1) {
      const name = migrationName(version);
      await cp(
        resolve("migrations", name),
        join(frozenMigrationDirectory, name),
      );
    }
    await runMigrations(pool, frozenMigrationDirectory);
    await pool.query(
      "INSERT INTO chat_service.principal(principal_id, issuer, subject, role) VALUES ('legacy-s19-principal', 's19-test', 'legacy-s19-principal', 'user')",
    );
    await pool.query(
      "INSERT INTO chat_service.conversation_thread(thread_id, principal_id) VALUES ('legacy-s19-thread', 'legacy-s19-principal')",
    );
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
    await adminPool.end();
    if (frozenMigrationDirectory !== "") {
      await rm(frozenMigrationDirectory, { recursive: true, force: true });
    }
  });

  it("AC-P001/P022 upgrades 0010 through 0013 without legacy data loss", async () => {
    const versions = await pool.query<{ version: string }>(
      "SELECT version FROM chat_service.schema_migrations ORDER BY version",
    );
    expect(versions.rows.map(({ version }) => version).slice(-3)).toEqual([
      "0011_conversation_world_focus.sql",
      "0012_authority_fusion.sql",
      "0013_world_explanation.sql",
    ]);
    await expect(
      pool.query(
        "SELECT principal_id FROM chat_service.principal WHERE principal_id = 'legacy-s19-principal'",
      ),
    ).resolves.toMatchObject({
      rows: [{ principal_id: "legacy-s19-principal" }],
    });
  });

  it("AC-P003..P013/P018/P019 saves and exactly replays one scoped explanation", async () => {
    const scope = await seedScope("exact");
    await seedReference(scope);
    const identity = replayIdentity(scope);
    const value = explanation(scope, "exact");
    const first = await repository.saveOrReplay({
      ...identity,
      explanation: value,
      findingLinks: [{ findingId: "finding-1", ordinal: 1, referenceKey }],
    });
    const replay = await new WorldExplanationRepository(pool).saveOrReplay({
      ...identity,
      explanation: value,
      findingLinks: [{ findingId: "finding-1", ordinal: 1, referenceKey }],
    });

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.explanation).toEqual(first.explanation);
    expect(replay.explanation.explanation.renderedText).toBe(
      value.renderedText,
    );
    await expect(countExplanations(scope)).resolves.toBe(1);

    const focus = await focusRepository.getFocus(scope);
    expect(focus).toMatchObject({
      revision: 2,
      lastExplanationId: value.explanationId,
      lastExplanationHash: value.explanationHash,
      references: [
        {
          sourceExplanationId: value.explanationId,
          sourceExplanationHash: value.explanationHash,
          sourceFindingId: "finding-1",
          sourceFindingOrdinal: 1,
        },
      ],
    });

    await focusRepository.applyReferences({
      principalId: scope.principalId,
      threadId: scope.threadId,
      expectedRevision: 2,
      groundingId: scope.wsgsGroundingId,
      groundingResultHash: resultHash,
      references: [
        {
          referenceKey,
          productId: "product-1",
          displayName: "2号车",
          referenceType: "vehicle",
          sourceMessageId: "message-renewed",
          sourceGroundingId: scope.wsgsGroundingId,
          sourceResultHash: resultHash,
          sourceWorldVersion: 1,
          validUntil: "2026-08-30T23:59:59.000Z",
          revalidationRequired: false,
          lastUsedAt: "2026-08-29T13:00:00.000Z",
        },
      ],
    });
    const renewed = await focusRepository.getFocus(scope);
    expect(renewed).toMatchObject({
      revision: 3,
      lastExplanationId: value.explanationId,
      lastExplanationHash: value.explanationHash,
    });
    expect(renewed.references[0]).not.toHaveProperty("sourceExplanationId");
    expect(renewed.references[0]).not.toHaveProperty("sourceExplanationHash");
    expect(renewed.references[0]).not.toHaveProperty("sourceFindingId");
    expect(renewed.references[0]).not.toHaveProperty("sourceFindingOrdinal");
  });

  it("AC-P015/P016 creates distinct identities for policy and contract changes", async () => {
    const scope = await seedScope("identity");
    const baseIdentity = replayIdentity(scope);
    const base = explanation(scope, "identity-base");
    const rendererB = "sha256:" + "d".repeat(64);
    const contractB = "sha256:" + "e".repeat(64);
    const rendererValue = explanation(scope, "identity-renderer", {
      rendererPolicyHash: rendererB,
    });
    const contractValue = explanation(scope, "identity-contract");

    await repository.saveOrReplay({
      ...baseIdentity,
      explanation: base,
    });
    await repository.saveOrReplay({
      ...baseIdentity,
      rendererPolicyHash: rendererB,
      explanation: rendererValue,
    });
    await repository.saveOrReplay({
      ...baseIdentity,
      contractHash: contractB,
      explanation: contractValue,
    });

    await expect(countExplanations(scope)).resolves.toBe(3);
  });

  it("AC-P023 serializes concurrent create into one deterministic record", async () => {
    const scope = await seedScope("concurrent");
    const identity = replayIdentity(scope);
    const value = explanation(scope, "concurrent");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.saveOrReplay({ ...identity, explanation: value }),
      ),
    );

    expect(results.filter(({ created }) => created)).toHaveLength(1);
    expect(
      new Set(results.map(({ explanation: stored }) => stored.explanationId)),
    ).toEqual(new Set([value.explanationId]));
    await expect(countExplanations(scope)).resolves.toBe(1);
    await expect(focusRepository.getFocus(scope)).resolves.toMatchObject({
      revision: 1,
      lastExplanationId: value.explanationId,
    });
  });

  it("separates authorization failures from immutable grounding conflicts", async () => {
    const scope = await seedScope("security");
    const other = await seedScope("security-other");
    const identity = replayIdentity(scope);
    const value = explanation(scope, "security");

    await expect(
      repository.saveOrReplay({
        ...identity,
        principalId: other.principalId,
        explanation: value,
      }),
    ).rejects.toBeInstanceOf(PersistenceAuthorizationError);

    const conflictingHash = "sha256:" + "f".repeat(64);
    const conflictingValue = explanation(scope, "security-conflict", {
      groundingResultHash: conflictingHash,
    });
    await expect(
      repository.saveOrReplay({
        ...identity,
        groundingResultHash: conflictingHash,
        explanation: conflictingValue,
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
  });

  it("rejects mutation, partial pointers, and oversized JSON in PostgreSQL", async () => {
    const scope = await seedScope("constraints");
    await seedReference(scope);
    const identity = replayIdentity(scope);
    const value = explanation(scope, "constraints");
    await repository.saveOrReplay({ ...identity, explanation: value });

    await expect(
      pool.query(
        "UPDATE chat_service.world_explanation SET explanation_status = 'FAILED' WHERE explanation_id = $1",
        [value.explanationId],
      ),
    ).rejects.toThrow("world explanations are immutable");
    await expect(
      pool.query(
        "DELETE FROM chat_service.world_explanation WHERE explanation_id = $1",
        [value.explanationId],
      ),
    ).rejects.toThrow("world explanations are immutable");
    await expect(
      pool.query(
        `
          UPDATE chat_service.conversation_world_focus
          SET revision = revision + 1,
              last_explanation_id = NULL
          WHERE principal_id = $1 AND thread_id = $2
        `,
        [scope.principalId, scope.threadId],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `
          UPDATE chat_service.conversation_world_reference
          SET source_finding_id = 'finding-partial'
          WHERE principal_id = $1 AND thread_id = $2
        `,
        [scope.principalId, scope.threadId],
      ),
    ).rejects.toThrow();

    const oversizedId = "explanation-oversized-" + randomUUID();
    const oversizedLocale = "en-oversized";
    const oversizedHash = "sha256:" + "1".repeat(64);
    const oversized = {
      explanationId: oversizedId,
      explanationHash: oversizedHash,
      locale: oversizedLocale,
      schemaVersion: "sacs-world-explanation/1.0",
      explanationStatus: "COMPLETE",
      grounding: {
        groundingId: scope.wsgsGroundingId,
        resultHash,
      },
      provenance: { rendererPolicyHash },
      padding: "x".repeat(4 * 1024 * 1024),
    };
    await expect(
      pool.query(
        `
          INSERT INTO chat_service.world_explanation(
            explanation_id, principal_id, thread_id, grounding_id,
            grounding_result_hash, locale, contract_version, contract_hash,
            renderer_policy_hash, explanation_status, explanation_json,
            explanation_hash, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, 'COMPLETE',
            $10::jsonb, $11, now()
          )
        `,
        [
          oversizedId,
          scope.principalId,
          scope.threadId,
          scope.wsgsGroundingId,
          resultHash,
          oversizedLocale,
          "sacs-world-explanation/1.0",
          contractHash,
          rendererPolicyHash,
          JSON.stringify(oversized),
          oversizedHash,
        ],
      ),
    ).rejects.toThrow();
  });

  async function seedScope(label: string): Promise<TestScope> {
    const suffix = label + "-" + randomUUID();
    const principalId = "principal-" + suffix;
    const threadId = "thread-" + suffix;
    const interactionRequestId = "request-" + suffix;
    const groundingExecutionId = "execution-" + suffix;
    const wsgsGroundingId = "wsgs-grounding-" + suffix;
    await pool.query(
      "INSERT INTO chat_service.principal(principal_id, issuer, subject, role) VALUES ($1, 's19-test', $1, 'user')",
      [principalId],
    );
    await pool.query(
      "INSERT INTO chat_service.conversation_thread(thread_id, principal_id) VALUES ($1, $2)",
      [threadId, principalId],
    );
    await pool.query(
      `
        INSERT INTO chat_service.interaction_request(
          request_id, protocol, external_request_id, principal_id, thread_id,
          request_hash, status, lease_owner, lease_until
        ) VALUES (
          $1, 'openai', $1, $2, $3, $4, 'CLAIMED', 's19-test',
          now() + interval '1 hour'
        )
      `,
      [interactionRequestId, principalId, threadId, "9".repeat(64)],
    );
    await pool.query(
      `
        INSERT INTO chat_service.grounding_execution(
          grounding_id, principal_id, thread_id, interaction_request_id,
          wsgs_request_id, idempotency_key, request_hash, wsgs_operation,
          requested_products_json, context_usage_json, state,
          wsgs_grounding_id, grounding_result_hash, grounding_result_json
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'EXECUTE_WORLD_QUERY',
          '["WORLD_EVIDENCE"]'::jsonb, '{}'::jsonb, 'GROUNDING_READY',
          $8, $9, '{"status":"COMPLETED"}'::jsonb
        )
      `,
      [
        groundingExecutionId,
        principalId,
        threadId,
        interactionRequestId,
        "wsgs-request-" + suffix,
        "wsgs-key-" + suffix,
        "8".repeat(64),
        wsgsGroundingId,
        resultHash,
      ],
    );
    return { principalId, threadId, wsgsGroundingId };
  }

  async function seedReference(scope: TestScope): Promise<void> {
    await focusRepository.getFocus(scope);
    await focusRepository.applyReferences({
      principalId: scope.principalId,
      threadId: scope.threadId,
      expectedRevision: 0,
      groundingId: scope.wsgsGroundingId,
      groundingResultHash: resultHash,
      references: [
        {
          referenceKey,
          productId: "product-1",
          displayName: "2号车",
          referenceType: "vehicle",
          sourceMessageId: "message-1",
          sourceGroundingId: scope.wsgsGroundingId,
          sourceResultHash: resultHash,
          sourceWorldVersion: 1,
          validUntil: "2026-08-29T23:59:59.000Z",
          revalidationRequired: false,
          lastUsedAt: "2026-08-29T12:00:00.000Z",
        },
      ],
    });
  }

  async function countExplanations(scope: TestScope): Promise<number> {
    const result = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM chat_service.world_explanation WHERE principal_id = $1 AND thread_id = $2",
      [scope.principalId, scope.threadId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
});

interface TestScope {
  readonly principalId: string;
  readonly threadId: string;
  readonly wsgsGroundingId: string;
}

function replayIdentity(scope: TestScope): ExplanationReplayKey {
  return {
    principalId: scope.principalId,
    threadId: scope.threadId,
    groundingResultHash: resultHash,
    locale: "zh-CN",
    contractHash,
    rendererPolicyHash,
  };
}

function explanation(
  scope: TestScope,
  suffix: string,
  overrides: {
    readonly groundingResultHash?: string;
    readonly rendererPolicyHash?: string;
  } = {},
): WorldExplanationV1 {
  const activeResultHash = overrides.groundingResultHash ?? resultHash;
  const activeRendererHash = overrides.rendererPolicyHash ?? rendererPolicyHash;
  const draft = {
    schemaVersion: "sacs-world-explanation/1.0" as const,
    explanationId: "explanation-" + suffix,
    explanationHash: "sha256:" + "0".repeat(64),
    locale: "zh-CN",
    grounding: {
      groundingId: scope.wsgsGroundingId,
      resultHash: activeResultHash,
      status: "COMPLETED" as const,
    },
    explanationStatus: "COMPLETE" as const,
    questionKind: "FEATURES_NEARBY" as const,
    renderedText: "2号车附近有 1 个已发布要素。",
    findings: [
      {
        findingId: "finding-1",
        findingKind: "SPATIAL_FEATURE_COLLECTION" as const,
        semanticConcept: "nearby_feature",
        headline: "发现 1 个附近要素",
        details: [],
        returnedCount: 1,
        truncated: false,
        evidenceItemIds: ["evidence-1"],
        sourceProductIds: [],
      },
    ],
    references: [
      {
        productId: "product-1",
        displayName: "2号车",
        referenceKey,
        sourceWorldVersion: 1,
      },
    ],
    sourceProducts: [],
    gaps: [],
    provenance: {
      evidenceItemIds: ["evidence-1"],
      receiptIds: [],
      operationKeys: ["feature.nearby@1.0"],
      consumerLockHash: "sha256:" + "2".repeat(64),
      findingProfileHash: "sha256:" + "3".repeat(64),
      rendererPolicyHash: activeRendererHash,
    },
    createdAt: "2026-08-29T12:00:00.000Z",
  };
  return parseWorldExplanationV1({
    ...draft,
    explanationHash: hashWorldExplanation(draft),
  });
}

function migrationName(version: number): string {
  const names = [
    "0001_initial_persistence.sql",
    "0002_events_and_recovery.sql",
    "0003_submission_lease.sql",
    "0004_interaction_gateway.sql",
    "0005_interrupt_resume.sql",
    "0006_durable_agui_runs.sql",
    "0007_conversation_history.sql",
    "0008_multi_task_directory.sql",
    "0009_request_result_union.sql",
    "0010_grounding_lifecycle.sql",
  ];
  const name = names[version - 1];
  if (name === undefined)
    throw new Error("Missing frozen migration " + version);
  return name;
}

function withDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = "/" + database;
  return url.toString();
}
