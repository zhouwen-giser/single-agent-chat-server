import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import pg from "pg";

import {
  calculateStructuredWorldSelectionSourceHash,
  hashWorldExplanation,
  parseWorldExplanationV1,
  structuredWorldSelectionSchema,
  type StructuredWorldSelection,
  type WorldExplanationV1,
} from "../packages/world-explanation-contract/src/index.js";
import {
  runMigrations,
  StructuredWorldSelectionRepository,
} from "../packages/persistence/src/index.js";
import { assembleWorldExplanation } from "../packages/world-explanation-runtime/src/index.js";
import {
  assemblyInput,
  explanationReference,
  sha,
  sixFindings,
} from "./world-explanation-fixtures.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const databaseName =
  "sacs_structured_selection_" + randomUUID().replaceAll("-", "");
const isolatedConnection =
  connectionString === undefined
    ? undefined
    : withDatabase(connectionString, databaseName);
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;
const clockAnchor = Date.now();
const selectedAt = at(-60_000);
const expiresAt = at(240_000);
const validUntil = at(300_000);

describeWithPostgres("C03 structured world selection PostgreSQL", () => {
  const adminPool = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString: isolatedConnection, max: 8 });
  const repository = new StructuredWorldSelectionRepository(pool);
  let primary: TestScope;
  let foreign: TestScope;

  beforeAll(async () => {
    await adminPool.query('CREATE DATABASE "' + databaseName + '"');
    await runMigrations(pool);
    primary = await seedScope("primary");
    foreign = await seedScope("foreign");
  });

  afterAll(async () => {
    await pool.end();
    await adminPool.query(
      'DROP DATABASE IF EXISTS "' + databaseName + '" WITH (FORCE)',
    );
    await adminPool.end();
  });

  it("persists exact replay, CAS revisions, expiry, and scoped non-disclosure", async () => {
    const first = selectionFor(primary, {
      selectionId: "selection-reference",
      selectionKind: "REFERENCE_SET_MEMBER",
      referenceKey: primary.explanation.references[0]?.referenceKey,
    });
    await expect(repository.saveOrReplay(first, selectedAt)).resolves.toEqual({
      created: true,
      selection: first,
    });
    await expect(repository.saveOrReplay(first, selectedAt)).resolves.toEqual({
      created: false,
      selection: first,
    });

    const second = selectionFor(primary, {
      ...first,
      selectionRevision: 2,
      selectedAt: at(-30_000),
      expiresAt: at(270_000),
    });
    await expect(
      repository.saveOrReplay(second, at(-30_000)),
    ).resolves.toMatchObject({ created: true, selection: second });
    await expect(repository.saveOrReplay(first, selectedAt)).resolves.toEqual({
      created: false,
      selection: first,
    });
    await expect(
      repository.saveOrReplay(
        selectionFor(primary, {
          ...second,
          selectionRevision: 4,
        }),
        at(-30_000),
      ),
    ).rejects.toThrow("Structured selection revision conflict");

    await expect(
      repository.findActive(primary, first.selectionId, selectedAt),
    ).resolves.toEqual(second);
    await expect(
      repository.findActive(foreign, first.selectionId, selectedAt),
    ).resolves.toBeUndefined();
    await expect(
      repository.findActive(primary, first.selectionId, validUntil),
    ).resolves.toBeUndefined();

    const older = selectionFor(primary, {
      selectionId: "selection-no-resurrection",
      selectionKind: "REFERENCE_SET_MEMBER",
      referenceKey: primary.explanation.references[0]?.referenceKey,
      expiresAt: at(240_000),
    });
    const newer = selectionFor(primary, {
      ...older,
      selectionRevision: 2,
      selectedAt: at(-30_000),
      expiresAt: at(120_000),
    });
    await repository.saveOrReplay(older, selectedAt);
    await repository.saveOrReplay(newer, at(-30_000));
    await expect(
      repository.findActive(primary, older.selectionId, at(180_000)),
    ).resolves.toBeUndefined();
  });

  it("fails closed for stale, forged, or overlong leased selections", async () => {
    const base = selectionFor(primary, {
      selectionId: "selection-negative",
      selectionKind: "REFERENCE_SET_MEMBER",
      referenceKey: primary.explanation.references[0]?.referenceKey,
    });
    await expect(
      repository.saveOrReplay({ ...base, sourceHash: sha("f") }, selectedAt),
    ).rejects.toThrow("Structured selection source hash mismatch");
    await expect(
      repository.saveOrReplay(
        selectionFor(primary, {
          ...base,
          expiresAt: at(360_000),
        }),
        selectedAt,
      ),
    ).rejects.toThrow("Structured selection reference requires revalidation");
    await expect(repository.saveOrReplay(base, expiresAt)).rejects.toThrow(
      "Structured selection is stale",
    );
  });

  it("requires authoritative validation for an upstream selection token", async () => {
    const token = selectionFor(primary, {
      selectionId: "selection-token",
      selectionKind: "FINDING_FEATURE",
      findingId: "finding-features-1",
      featureId: "feature-high-1",
      upstreamSelectionToken: "opaque-token",
    });
    await expect(repository.saveOrReplay(token, selectedAt)).rejects.toThrow(
      "Structured selection token requires authoritative validation",
    );

    const verified = new StructuredWorldSelectionRepository(pool, {
      verifyUpstreamSelectionToken: async ({ selection }) =>
        selection.upstreamSelectionToken === "opaque-token"
          ? { validUntil, validationProofHash: sha("d") }
          : undefined,
    });
    await expect(
      verified.saveOrReplay(token, selectedAt),
    ).resolves.toMatchObject({
      created: true,
      selection: token,
    });
    await expect(
      pool.query(
        "UPDATE chat_service.structured_world_selection SET expires_at = expires_at + interval '1 second' WHERE selection_id = $1",
        [token.selectionId],
      ),
    ).rejects.toThrow("structured world selections are append-only");
  });

  async function seedScope(label: string): Promise<TestScope> {
    const suffix = label + "-" + randomUUID();
    const principalId = "principal-" + suffix;
    const threadId = "thread-" + suffix;
    const interactionRequestId = "request-" + suffix;
    const groundingExecutionId = "execution-" + suffix;
    const wsgsGroundingId = "wsgs-grounding-" + suffix;
    await pool.query(
      "INSERT INTO chat_service.principal(principal_id, issuer, subject, role) VALUES ($1, 'closure-test', $1, 'user')",
      [principalId],
    );
    await pool.query(
      "INSERT INTO chat_service.conversation_thread(thread_id, principal_id) VALUES ($1, $2)",
      [threadId, principalId],
    );
    await pool.query(
      "INSERT INTO chat_service.interaction_request(request_id, protocol, external_request_id, principal_id, thread_id, request_hash, status, lease_owner, lease_until) VALUES ($1, 'openai', $1, $2, $3, $4, 'CLAIMED', 'closure-test', now() + interval '1 hour')",
      [interactionRequestId, principalId, threadId, "9".repeat(64)],
    );
    const explanation = explanationFor(wsgsGroundingId);
    await pool.query(
      "INSERT INTO chat_service.grounding_execution(grounding_id, principal_id, thread_id, interaction_request_id, wsgs_request_id, idempotency_key, request_hash, wsgs_operation, requested_products_json, context_usage_json, state, wsgs_grounding_id, grounding_result_hash, grounding_result_json) VALUES ($1, $2, $3, $4, $5, $6, $7, 'EXECUTE_WORLD_QUERY', '[\"WORLD_EVIDENCE\"]'::jsonb, '{}'::jsonb, 'GROUNDING_READY', $8, $9, '{\"status\":\"COMPLETED\"}'::jsonb)",
      [
        groundingExecutionId,
        principalId,
        threadId,
        interactionRequestId,
        "wsgs-request-" + suffix,
        "wsgs-key-" + suffix,
        "8".repeat(64),
        wsgsGroundingId,
        explanation.grounding.resultHash,
      ],
    );
    await pool.query(
      "INSERT INTO chat_service.world_explanation(explanation_id, principal_id, thread_id, grounding_execution_id, grounding_id, grounding_result_hash, locale, contract_version, contract_hash, renderer_policy_hash, explanation_status, explanation_json, explanation_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::timestamptz)",
      [
        explanation.explanationId,
        principalId,
        threadId,
        groundingExecutionId,
        wsgsGroundingId,
        explanation.grounding.resultHash,
        explanation.locale,
        explanation.schemaVersion,
        sha("c"),
        explanation.provenance.rendererPolicyHash,
        explanation.explanationStatus,
        JSON.stringify(explanation),
        explanation.explanationHash,
        explanation.createdAt,
      ],
    );
    return {
      principalId,
      threadId,
      groundingExecutionId,
      wsgsGroundingId,
      explanation,
    };
  }
});

interface TestScope {
  readonly principalId: string;
  readonly threadId: string;
  readonly groundingExecutionId: string;
  readonly wsgsGroundingId: string;
  readonly explanation: WorldExplanationV1;
}

function explanationFor(wsgsGroundingId: string): WorldExplanationV1 {
  const base = assembleWorldExplanation(assemblyInput(sixFindings()));
  const draft = {
    ...base,
    explanationId: "explanation-" + wsgsGroundingId,
    explanationHash: sha("0"),
    grounding: { ...base.grounding, groundingId: wsgsGroundingId },
    references: [
      {
        ...explanationReference(),
        sourceOperation: "VALIDATE_REFERENCES",
        validUntil,
        revalidationRequired: false,
      },
    ],
  };
  return parseWorldExplanationV1({
    ...draft,
    explanationHash: hashWorldExplanation(draft),
  });
}

function selectionFor(
  scope: TestScope,
  overrides: Partial<StructuredWorldSelection>,
): StructuredWorldSelection {
  const withoutHash = {
    schemaVersion: "sacs-structured-world-selection/1.0" as const,
    selectionId: "selection-" + randomUUID(),
    principalId: scope.principalId,
    threadId: scope.threadId,
    groundingId: scope.wsgsGroundingId,
    explanationId: scope.explanation.explanationId,
    selectionKind: "REFERENCE_SET_MEMBER" as const,
    selectionRevision: 1,
    selectedAt,
    expiresAt,
    ...overrides,
  };
  const { sourceHash: ignoredSourceHash, ...sourceInput } =
    withoutHash as typeof withoutHash & { readonly sourceHash?: string };
  void ignoredSourceHash;
  return structuredWorldSelectionSchema.parse({
    ...sourceInput,
    sourceHash: calculateStructuredWorldSelectionSourceHash({
      explanation: scope.explanation,
      selection: sourceInput,
    }),
  });
}

function withDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = "/" + database;
  return url.toString();
}

function at(offsetMilliseconds: number): string {
  return new Date(clockAnchor + offsetMilliseconds).toISOString();
}
