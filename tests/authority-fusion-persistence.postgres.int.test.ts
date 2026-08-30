import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import pg from "pg";

import {
  AuthorityFusionRepository,
  runMigrations,
} from "../packages/persistence/src/index.js";
import type { AuthorityFusionResultV2 } from "../packages/authority-fusion/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const databaseName =
  "sacs_authority_fusion_" + randomUUID().replaceAll("-", "");
const isolatedConnection =
  connectionString === undefined
    ? undefined
    : withDatabase(connectionString, databaseName);
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;
const hashA = "sha256:" + "a".repeat(64);
const hashB = "sha256:" + "b".repeat(64);
const hashC = "sha256:" + "c".repeat(64);

describeWithPostgres("SACS v0.4 S10 Authority Fusion PostgreSQL", () => {
  const adminPool = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString: isolatedConnection, max: 8 });
  const repository = new AuthorityFusionRepository(pool);
  let frozenMigrationDirectory = "";

  beforeAll(async () => {
    await adminPool.query('CREATE DATABASE "' + databaseName + '"');
    frozenMigrationDirectory = await mkdtemp(join(tmpdir(), "sacs-v04-s10-"));
    for (let version = 1; version <= 10; version += 1) {
      const prefix = version.toString().padStart(4, "0") + "_";
      await cp(
        resolve("migrations", migrationName(prefix)),
        join(frozenMigrationDirectory, migrationName(prefix)),
      );
    }
    await runMigrations(pool, frozenMigrationDirectory);
    await pool.query(
      "INSERT INTO chat_service.principal(principal_id, issuer, subject, role) VALUES ('legacy-principal', 's10-test', 'legacy-principal', 'user')",
    );
    await pool.query(
      "INSERT INTO chat_service.conversation_thread(thread_id, principal_id) VALUES ('legacy-thread', 'legacy-principal')",
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

  it("applies 0011 through 0015 after 0010 without legacy data loss", async () => {
    const versions = await pool.query<{ version: string }>(
      "SELECT version FROM chat_service.schema_migrations ORDER BY version",
    );
    expect(versions.rows.map(({ version }) => version).slice(-5)).toEqual([
      "0011_conversation_world_focus.sql",
      "0012_authority_fusion.sql",
      "0013_world_explanation.sql",
      "0014_structured_world_selection.sql",
      "0015_interactive_analysis.sql",
    ]);
    await expect(
      pool.query(
        "SELECT principal_id FROM chat_service.principal WHERE principal_id = 'legacy-principal'",
      ),
    ).resolves.toMatchObject({ rows: [{ principal_id: "legacy-principal" }] });
  });

  it("AC-U018 replays the exact identity without a duplicate evaluation", async () => {
    const identity = identityValue();
    const first = await repository.saveOrReplay({
      ...identity,
      groundingId: "grounding-1",
      result: fusionResult(),
    });
    const replay = await repository.saveOrReplay({
      ...identity,
      groundingId: "grounding-1",
      result: fusionResult(),
    });
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.fusion.fusionId).toBe(first.fusion.fusionId);
    await expect(countRows()).resolves.toBe(1);
  });

  it("AC-U019 creates a new evaluation when the task snapshot changes", async () => {
    const before = await countRows();
    await repository.saveOrReplay({
      ...identityValue(),
      taskSnapshotHash: hashB,
      groundingId: "grounding-1",
      result: fusionResult(),
    });
    await expect(countRows()).resolves.toBe(before + 1);
  });

  it("AC-U020 creates a new evaluation when the requirement hash changes", async () => {
    const before = await countRows();
    await repository.saveOrReplay({
      ...identityValue(),
      requirementHash: hashC,
      groundingId: "grounding-1",
      result: fusionResult(),
    });
    await expect(countRows()).resolves.toBe(before + 1);
  });

  async function countRows(): Promise<number> {
    const result = await pool.query<{ count: string }>(
      "SELECT count(*) FROM chat_service.authority_fusion_evaluation",
    );
    return Number(result.rows[0]?.count ?? 0);
  }
});

function identityValue() {
  return {
    principalId: "legacy-principal",
    threadId: "legacy-thread",
    taskId: "task-1",
    taskSnapshotHash: hashA,
    requirementHash: hashB,
    groundingResultHash: hashC,
  };
}

function fusionResult(): AuthorityFusionResultV2 {
  return {
    schemaVersion: "2.0",
    task: {
      authority: "SDAR",
      taskId: "task-1",
      state: "COMPLETED",
      observedAt: "2026-08-29T08:00:00.000Z",
    },
    reality: {
      authority: "GOWM",
      groundingId: "grounding-1",
      resultHash: hashC,
      observedAt: "2026-08-29T08:00:00.000Z",
    },
    checks: [
      {
        checkId: "predicate-1",
        type: "PLAN_PREDICATE",
        required: true,
        evaluation: "SATISFIED",
        evidenceItemIds: ["evidence-1"],
      },
    ],
    overall: "CONSISTENT",
    unknowns: [],
  };
}

function migrationName(prefix: string): string {
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
  const name = names.find((candidate) => candidate.startsWith(prefix));
  if (name === undefined) throw new Error("Missing frozen migration " + prefix);
  return name;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = "/" + database;
  return parsed.toString();
}
