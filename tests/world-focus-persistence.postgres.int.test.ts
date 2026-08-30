import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import pg from "pg";

import {
  PersistenceConflictError,
  PostgresWorldFocusRepository,
  runMigrations,
} from "../packages/persistence/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const databaseName = "sacs_world_focus_" + randomUUID().replaceAll("-", "");
const isolatedConnection =
  connectionString === undefined
    ? undefined
    : withDatabase(connectionString, databaseName);
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;
const hash = "sha256:" + "a".repeat(64);

describeWithPostgres("SACS v0.4 ConversationWorldFocus PostgreSQL", () => {
  const adminPool = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString: isolatedConnection, max: 8 });
  const repository = new PostgresWorldFocusRepository(pool);

  beforeAll(async () => {
    await adminPool.query('CREATE DATABASE "' + databaseName + '"');
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
    await adminPool.end();
  });

  it("persists bounded references across repository restart and version change", async () => {
    const scope = await seedScope("focus");
    const initial = await repository.getFocus(scope);
    expect(initial).toMatchObject({ revision: 0, references: [] });

    const first = await repository.applyReferences({
      ...scope,
      expectedRevision: 0,
      groundingId: "grounding-1",
      groundingResultHash: hash,
      references: [reference("world-7", "2026-08-29T03:00:00.000Z")],
    });
    expect(first).toMatchObject({
      revision: 1,
      lastGroundingId: "grounding-1",
      references: [{ displayName: "2号车", sourceWorldVersion: 7 }],
    });

    const restarted = new PostgresWorldFocusRepository(pool);
    const restored = await restarted.getFocus(scope);
    expect(restored).toEqual(first);
    const identity = restored.references[0]?.referenceIdentityHash;

    const refreshed = await restarted.applyReferences({
      ...scope,
      expectedRevision: 1,
      groundingId: "grounding-2",
      groundingResultHash: "sha256:" + "b".repeat(64),
      references: [reference("world-8", "2026-08-29T04:00:00.000Z")],
    });
    expect(refreshed).toMatchObject({
      revision: 2,
      references: [{ sourceWorldVersion: 8 }],
    });
    expect(refreshed.references).toHaveLength(1);
    expect(refreshed.references[0]?.referenceIdentityHash).toBe(identity);
  });

  it("uses revision compare-and-swap to prevent lost updates", async () => {
    const scope = await seedScope("concurrency");
    await repository.getFocus(scope);
    const input = {
      ...scope,
      expectedRevision: 0,
      groundingId: "grounding-cas",
      groundingResultHash: hash,
      references: [reference("world-7", "2026-08-29T03:00:00.000Z")],
    };
    const settled = await Promise.allSettled([
      repository.applyReferences(input),
      repository.applyReferences(input),
    ]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = settled.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(PersistenceConflictError),
    });
  });

  it("isolates principal and thread and exposes only usable references", async () => {
    const scope = await seedScope("isolation");
    const other = await seedScope("other");
    await repository.getFocus(scope);
    await repository.applyReferences({
      ...scope,
      expectedRevision: 0,
      groundingId: "grounding-isolation",
      groundingResultHash: hash,
      references: [
        reference("world-7", "2026-08-29T03:00:00.000Z"),
        {
          ...reference("world-8", "2026-08-29T00:00:00.000Z"),
          productId: "product-expired",
          referenceKey: {
            namespace: "gowm" as const,
            kind: "area",
            id: "wrf_" + "2".repeat(32),
            version: "world-8",
          },
        },
      ],
    });
    await expect(
      repository.listUsableReferences({
        ...scope,
        limit: 64,
        now: "2026-08-29T01:00:00.000Z",
      }),
    ).resolves.toMatchObject([
      {
        focusReference: { productId: "product-1", status: "VALID" },
        sourceMessageId: "message-1",
      },
    ]);
    await expect(
      repository.listReferencesRequiringValidation({
        ...scope,
        limit: 64,
        now: "2026-08-29T01:00:00.000Z",
      }),
    ).resolves.toMatchObject([
      {
        focusReference: { productId: "product-expired", status: "EXPIRED" },
        sourceMessageId: "message-1",
      },
    ]);
    await expect(repository.getFocus(other)).resolves.toMatchObject({
      references: [],
    });
    await expect(
      repository.getFocus({
        principalId: other.principalId,
        threadId: scope.threadId,
      }),
    ).rejects.toThrow("not authorized");
  });

  it("persists one OPEN choice and selects only an exact candidate in scope", async () => {
    const scope = await seedScope("choice");
    const other = await seedScope("choice-other");
    const choice = pendingChoice(scope);
    await expect(repository.createChoice(choice)).resolves.toMatchObject({
      status: "OPEN",
    });
    await expect(
      repository.createChoice({ ...choice, choiceId: "choice-2" }),
    ).rejects.toThrow();
    await expect(repository.getOpenChoice(other)).resolves.toBeUndefined();
    await expect(
      repository.selectChoice({
        ...scope,
        choiceId: choice.choiceId,
        selectedProductId: "missing-product",
        now: "2026-08-29T00:30:00.000Z",
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
    await expect(
      repository.selectChoice({
        ...scope,
        choiceId: choice.choiceId,
        selectedProductId: "product-2",
        now: "2026-08-29T00:30:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "SELECTED",
      selectedProductId: "product-2",
    });
    await expect(repository.getOpenChoice(scope)).resolves.toBeUndefined();
  });

  it("does not expose an expired choice", async () => {
    const scope = await seedScope("expired");
    await repository.createChoice(pendingChoice(scope));
    await expect(
      repository.getOpenChoice({
        ...scope,
        now: "2026-08-29T02:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });

  async function seedScope(label: string) {
    const principalId = "principal-" + label + "-" + randomUUID();
    const threadId = "thread-" + label + "-" + randomUUID();
    await pool.query(
      "INSERT INTO chat_service.principal(principal_id, issuer, subject, role) VALUES ($1, 's06-test', $1, 'user')",
      [principalId],
    );
    await pool.query(
      "INSERT INTO chat_service.conversation_thread(thread_id, principal_id) VALUES ($1, $2)",
      [threadId, principalId],
    );
    return { principalId, threadId };
  }
});

function reference(version: string, validUntil: string) {
  return {
    referenceKey: {
      namespace: "gowm" as const,
      kind: "vehicle",
      id: "wrf_" + "1".repeat(32),
      version,
    },
    productId: "product-1",
    displayName: "2号车",
    referenceType: "vehicle",
    sourceMessageId: "message-1",
    sourceGroundingId: "grounding-1",
    sourceResultHash: hash,
    sourceWorldVersion: Number(version.replace("world-", "")),
    validUntil,
    revalidationRequired: false,
    lastUsedAt: "2026-08-29T00:00:00.000Z",
  };
}

function pendingChoice(scope: {
  readonly principalId: string;
  readonly threadId: string;
}) {
  return {
    schemaVersion: "1.0" as const,
    choiceId: "choice-" + randomUUID(),
    ...scope,
    originMessageId: "message-1",
    originGroundingId: "grounding-1",
    originResultHash: hash,
    originTurnPlan: { schemaVersion: "0.4" },
    originRequestPlan: { schemaVersion: "1.0" },
    mentionId: "mention-1",
    surfaceText: "滨河路",
    candidates: [
      { ordinal: 1, productId: "product-1", displayName: "滨河路南区" },
      { ordinal: 2, productId: "product-2", displayName: "滨河路北区" },
    ],
    status: "OPEN" as const,
    expiresAt: "2026-08-29T01:00:00.000Z",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  };
}

function withDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = "/" + database;
  return url.toString();
}
