import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "@jest/globals";

import { AnalysisRepository } from "../packages/persistence/src/index.js";

const migration = readFileSync(
  new URL("../migrations/0015_interactive_analysis.sql", import.meta.url),
  "utf8",
);
const repository = readFileSync(
  new URL(
    "../packages/persistence/src/analysis-repository.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("SACS v0.5 interactive analysis persistence contract", () => {
  it("adds one contiguous append-only migration after world explanation", () => {
    const files = readdirSync(new URL("../migrations", import.meta.url))
      .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(file))
      .sort();
    expect(files.at(-3)).toBe("0013_world_explanation.sql");
    expect(files.at(-2)).toBe("0014_structured_world_selection.sql");
    expect(files.at(-1)).toBe("0015_interactive_analysis.sql");
  });

  it("creates exactly the seven required analysis tables", () => {
    const tables = [
      ...migration.matchAll(/CREATE TABLE chat_service\.(analysis_[a-z_]+)/gu),
    ].map((match) => match[1]);
    expect(tables).toEqual([
      "analysis_session",
      "analysis_revision",
      "analysis_run",
      "analysis_event",
      "analysis_projection",
      "analysis_change_proposal",
      "analysis_intervention",
    ]);
  });

  it("locks ownership, revision/run identity, sequences and proposal idempotency", () => {
    expect(migration).toContain(
      "REFERENCES chat_service.conversation_thread(thread_id, principal_id)",
    );
    expect(migration).toContain("UNIQUE (analysis_id, revision_number)");
    expect(migration).toContain("UNIQUE (revision_id, attempt)");
    expect(migration).toContain("UNIQUE (analysis_id, analysis_sequence)");
    expect(migration).toContain("UNIQUE (run_id, run_sequence)");
    expect(migration).toContain("UNIQUE (run_id, upstream_sequence)");
    expect(migration).toContain("UNIQUE (analysis_id, idempotency_key)");
    expect(migration).toContain("analysis_one_pending_proposal");
    expect(migration).toContain(
      "WHERE status IN ('SUBMITTED', 'VALIDATING', 'ACCEPTED', 'COMPILING')",
    );
  });

  it("makes events append-only and active revision changes compare-and-swap", () => {
    expect(migration).toContain("analysis events are append-only");
    expect(migration).toContain("BEFORE UPDATE ON chat_service.analysis_event");
    expect(migration).toContain("BEFORE DELETE ON chat_service.analysis_event");
    expect(repository).toContain("async createRevision");
    expect(repository).toContain("AND active_revision_id = $7");
    expect(repository).toContain("AND latest_revision_number = $8");
    expect(repository).toContain('input.revision.status === "QUEUED"');
    expect(repository).toContain("async activateQueuedRevisionAndStartRun");
    expect(repository).toContain("Active analysis run is not terminal");
  });

  it("persists event and projection through one transaction boundary", () => {
    expect(AnalysisRepository).toBeDefined();
    expect(repository).toContain("async appendEventAndProject");
    expect(repository).toContain("INSERT INTO chat_service.analysis_event");
    expect(repository).toContain("async function upsertProjection");
    expect(repository).toContain('await client.query("BEGIN")');
    expect(repository).toContain('await client.query("COMMIT")');
    expect(repository).toContain('await client.query("ROLLBACK")');
  });

  it("bounds durable state and activity snapshots", () => {
    expect(migration).toContain("octet_length(state_json::text) <= 4194304");
    expect(migration).toContain("octet_length(activity_json::text) <= 2097152");
    expect(repository).toContain("async getSnapshot");
    expect(repository).toContain(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });
});
