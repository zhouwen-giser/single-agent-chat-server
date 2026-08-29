import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "@jest/globals";

import {
  parseConversationWorldFocus,
  worldFocusReferenceSchema,
} from "../packages/conversation-world-focus/src/index.js";

const migration = readFileSync(
  new URL("../migrations/0013_world_explanation.sql", import.meta.url),
  "utf8",
);
const sha256 = "sha256:" + "a".repeat(64);

describe("SACS v0.4 S19 world explanation persistence contract", () => {
  it("adds one contiguous append-only migration after 0012", () => {
    const files = readdirSync(new URL("../migrations", import.meta.url))
      .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(file))
      .sort();
    expect(files.at(-2)).toBe("0012_authority_fusion.sql");
    expect(files.at(-1)).toBe("0013_world_explanation.sql");
    expect(migration).toContain("CREATE TABLE chat_service.world_explanation");
    expect(migration).not.toMatch(/CREATE TABLE .*product_catalog/iu);
  });

  it("binds explanation ownership to the exact durable grounding", () => {
    expect(migration).toContain("grounding_execution_wsgs_result_scope_unique");
    expect(migration).toContain(
      "principal_id,\n    thread_id,\n    grounding_id,\n    grounding_result_hash",
    );
    expect(migration).toContain(
      "REFERENCES chat_service.conversation_thread(thread_id, principal_id)",
    );
  });

  it("enforces the six-part replay key, hashes, JSON budget, and immutability", () => {
    expect(migration).toContain(
      "grounding_result_hash,\n    locale,\n    contract_hash,\n    renderer_policy_hash",
    );
    expect(migration).toContain(
      "octet_length(explanation_json::text) <= 4194304",
    );
    expect(migration).toContain(
      "explanation_json#>>'{provenance,rendererPolicyHash}'",
    );
    expect(migration).toContain("world explanations are immutable");
    expect(migration).toContain(
      "BEFORE UPDATE ON chat_service.world_explanation",
    );
    expect(migration).toContain(
      "BEFORE DELETE ON chat_service.world_explanation",
    );
  });

  it("keeps focus and finding projection identities paired", () => {
    expect(migration).toContain("last_explanation_id");
    expect(migration).toContain("conversation_world_focus_explanation_pair");
    expect(migration).toContain("source_finding_ordinal");
    expect(migration).toContain(
      "conversation_world_reference_finding_projection",
    );

    expect(() =>
      parseConversationWorldFocus({
        schemaVersion: "1.0",
        principalId: "principal-1",
        threadId: "thread-1",
        revision: 0,
        lastExplanationId: "explanation-1",
        references: [],
        updatedAt: "2026-08-29T12:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      worldFocusReferenceSchema.parse({
        referenceIdentityHash: "b".repeat(64),
        referenceKey: {
          namespace: "gowm",
          kind: "vehicle",
          id: "wrf_" + "1".repeat(32),
          version: "world-1",
        },
        productId: "product-1",
        displayName: "2号车",
        referenceType: "vehicle",
        sourceGroundingId: "grounding-1",
        sourceResultHash: sha256,
        sourceWorldVersion: 1,
        sourceExplanationId: "explanation-1",
        revalidationRequired: false,
        status: "VALID",
        lastUsedAt: "2026-08-29T12:00:00.000Z",
      }),
    ).toThrow();
  });
});
