import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";

const root = fileURLToPath(new URL("../", import.meta.url));
const migration = readFileSync(
  `${root}migrations/0010_grounding_lifecycle.sql`,
  "utf8",
);

describe("SACS v0.4 append-only grounding persistence contract", () => {
  it("adds only migration 0010 after the frozen 0001 through 0009 chain", () => {
    const locked = JSON.parse(
      readFileSync(`${root}reports/v0.4/S00-source-lock.json`, "utf8"),
    ) as { immutableMigrations: Record<string, string> };
    expect(Object.keys(locked.immutableMigrations)).toHaveLength(9);
    expect(migration).toContain(
      "CREATE TABLE chat_service.grounding_execution",
    );
    expect(migration).toContain("CREATE TABLE chat_service.grounding_event");
  });

  it.each([
    "GROUNDING_PENDING",
    "GROUNDING_READY",
    "SDAR_SUBMISSION_RESERVED",
    "SDAR_SUBMITTED",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ])("freezes lifecycle state %s in the database", (state) => {
    expect(migration).toContain(`'${state}'`);
  });

  it("enforces the only allowed forward transitions and terminal closure", () => {
    expect(migration).toContain(
      "OLD.state = 'GROUNDING_PENDING' AND NEW.state IN",
    );
    expect(migration).toContain(
      "OLD.state = 'GROUNDING_READY' AND NEW.state IN",
    );
    expect(migration).toContain(
      "OLD.state = 'SDAR_SUBMISSION_RESERVED' AND NEW.state IN",
    );
    expect(migration).toContain(
      "OLD.state = 'SDAR_SUBMITTED' AND NEW.state IN",
    );
    expect(migration).toContain("terminal grounding rows cannot change");
    expect(migration).not.toMatch(
      /OLD\.state\s*=\s*'(?:COMPLETED|FAILED|CANCELLED)'\s+AND\s+NEW\.state/gu,
    );
  });

  it("makes request identity and durable outputs immutable", () => {
    for (const field of [
      "interaction_request_id",
      "wsgs_request_id",
      "idempotency_key",
      "request_hash",
      "wsgs_operation",
      "requested_products_json",
      "context_usage_json",
      "grounding_result_hash",
      "operational_bundle_hash",
      "sdar_submission_key",
      "sdar_task_id",
      "sdar_context_id",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain(
      "grounding immutable request fields cannot change",
    );
    expect(migration).toContain(
      "grounding durable outputs cannot change once recorded",
    );
  });

  it("enforces exactly-once keys, recovery indexes, and append-only events", () => {
    expect(migration).toContain("UNIQUE (request_id, principal_id, thread_id)");
    expect(migration).toContain(
      "FOREIGN KEY (interaction_request_id, principal_id, thread_id)",
    );
    expect(migration).toContain(
      "UNIQUE (principal_id, thread_id, idempotency_key)",
    );
    expect(migration).toContain(
      "CREATE UNIQUE INDEX grounding_execution_sdar_submission_key",
    );
    expect(migration).toContain("CREATE INDEX grounding_execution_recovery");
    expect(migration).toContain("grounding events are append-only");
    expect(migration).toContain(
      "BEFORE UPDATE ON chat_service.grounding_event",
    );
    expect(migration).toContain(
      "BEFORE DELETE ON chat_service.grounding_event",
    );
    expect(migration).toContain(
      "BEFORE TRUNCATE ON chat_service.grounding_event",
    );
  });
});
