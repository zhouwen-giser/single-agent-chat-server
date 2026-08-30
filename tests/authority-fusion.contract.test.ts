import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";
import { Ajv2020 } from "ajv/dist/2020.js";

import { parseAuthorityFusionResultV2 } from "../packages/authority-fusion/src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("SACS v0.4 S10 Authority Fusion contracts", () => {
  it("preserves and compiles the locked AuthorityFusionResult v2 schema", () => {
    const bytes = readFileSync(
      root + "contracts/v0.4/authority-fusion-result-v2.schema.json",
    );
    expect("sha256:" + createHash("sha256").update(bytes).digest("hex")).toBe(
      "sha256:17e6ea2734476bc4933f9ad260d1be8757a23e79e47349fbd92629d6ebf86ccc",
    );
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    ajv.addSchema(
      readJson("contracts/v0.4/common.schema.json"),
      "common.schema.json",
    );
    const schema = readJson(
      "contracts/v0.4/authority-fusion-result-v2.schema.json",
    ) as Record<string, unknown>;
    delete schema["$id"];
    expect(() => ajv.compile(schema)).not.toThrow();
  });

  it("rejects hidden details and checks without explicit evidence arrays", () => {
    const base = {
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
        resultHash: "sha256:" + "a".repeat(64),
        observedAt: "2026-08-29T08:00:00.000Z",
      },
      checks: [],
      overall: "NOT_COMPARABLE",
      unknowns: [],
    };
    expect(() =>
      parseAuthorityFusionResultV2({ ...base, hiddenReasoning: "secret" }),
    ).toThrow();
    expect(() =>
      parseAuthorityFusionResultV2({
        ...base,
        checks: [
          {
            checkId: "c-1",
            type: "PLAN_PREDICATE",
            required: true,
            evaluation: "UNKNOWN",
          },
        ],
      }),
    ).toThrow();
  });

  it("defines immutable exact-snapshot persistence in migration 0012", () => {
    const sql = readFileSync(
      root + "migrations/0012_authority_fusion.sql",
      "utf8",
    );
    for (const field of [
      "task_snapshot_hash",
      "requirement_hash",
      "grounding_result_hash",
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain("authority fusion evaluations are immutable");
    expect(sql).toContain(
      "UNIQUE (\n    principal_id,\n    thread_id,\n    task_id",
    );
  });

  it("AC-S004 preserves the frozen 0001 through 0010 migration bytes", () => {
    const expected: Record<string, string> = {
      "0001_initial_persistence.sql":
        "7345a7b5778b6f6c2d888263b84849a78b8f4facd68bca5eca8fba3d5a95a975",
      "0002_events_and_recovery.sql":
        "179af2eec27f5ef27b66e6b57ce01742e986790682c7690962a2226d0414439d",
      "0003_submission_lease.sql":
        "54d793c4c64c0c8b17d9a42e4444c68aad55d01ad89ce89548c33b2264064485",
      "0004_interaction_gateway.sql":
        "0f1f6a66b0d1910acf612f0eceaaed6f7ba061b94499c788c067b570989b45ca",
      "0005_interrupt_resume.sql":
        "debdedf869186e39aa73c096b88dab49f60708563ff539f39556aa6065ac8ac7",
      "0006_durable_agui_runs.sql":
        "fba6c71d73bee278be5a6ed6dc7bcc651626d84208078b9fe3f28dfbee13b77a",
      "0007_conversation_history.sql":
        "dcb052c107810b4b9ec8d6d03e6ef84a3d0670e730a36f1b53f45a8e4bf4d91f",
      "0008_multi_task_directory.sql":
        "459e14c7b1bbe62911a7d7fd8fb662722285f01e78fad581bd0909317d5274d9",
      "0009_request_result_union.sql":
        "2b2eec946e2be640ad701158cd6b77db0a184c81ed9d75ee8d34bf0ef950bda6",
      "0010_grounding_lifecycle.sql":
        "6ecc7c09c6abfe34db8bcefb96d83636dc6909fc19c4b82c0787e65c5553b291",
    };
    for (const [name, hash] of Object.entries(expected)) {
      const bytes = readFileSync(root + "migrations/" + name);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    }
  });
});

function readJson(path: string): object {
  return JSON.parse(readFileSync(root + path, "utf8")) as object;
}
