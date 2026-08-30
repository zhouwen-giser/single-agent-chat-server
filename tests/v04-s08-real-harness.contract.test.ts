import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";

const root = fileURLToPath(new URL("../", import.meta.url));
const harness = readFileSync(
  root + "scripts/phase-v04-s08-real-multiturn.mjs",
  "utf8",
);

describe("SACS v0.4 S08 genuine WSGS multi-turn harness", () => {
  it("fails closed without explicit live authorization and exact source", () => {
    expect(harness).toContain('ALLOW_REAL_WSGS_MULTITURN !== "YES"');
    expect(harness).toContain(
      'expectedWsgsCommit = "46e872359536b84351ce2b417117fc5725c59145"',
    );
    expect(harness).toContain('requiredEnvironment("WSGS_SOURCE_DIR")');
    expect(harness).toContain('requiredEnvironment("WSGS_BASE_URL")');
    expect(harness).toContain('requiredEnvironment("WSGS_BEARER_TOKEN")');
    expect(harness).toContain('requiredEnvironment("TEST_DATABASE_URL")');
    expect(harness).toContain("deadlineMs: 120_000");
    expect(harness).toContain("usage: knownReferenceUsage()");
    expect(harness).toContain(
      "current-reference follow-up must not request PINNED prior grounding replay",
    );
  });

  it("covers every required multi-turn behavior before emitting Ready", () => {
    for (const evidence of [
      "2号车在哪里？",
      "它现在呢？",
      "A区有哪些车？",
      "那里附近还有什么？",
      "滨河路附近有哪些设备？",
      "第二个",
      "VALIDATE_REFERENCES",
      "WORLD_GROUNDING_NO_PENDING_CHOICE",
      "replay duplicated a WSGS POST",
      "SACS_MULTITURN_WORLD_GROUNDING_READY",
    ]) {
      expect(harness).toContain(evidence);
    }
    expect(
      harness.indexOf("SACS_MULTITURN_WORLD_GROUNDING_READY"),
    ).toBeGreaterThan(harness.indexOf("restartFollowUp"));
  });

  it("prints hashes and counts without printing credential variables", () => {
    expect(harness).toContain("requestEvidenceHash");
    expect(harness).not.toMatch(/process\.stdout\.write\([^)]*process\.env/su);
    expect(harness).not.toContain("GOWM_GATEWAY_TOKEN");
    expect(harness).not.toContain("MODEL_API_KEY");
    expect(harness).not.toContain("PRIVATE_KEY");
    expect(harness).not.toMatch(
      /console\.(?:log|error)\([^)]*wsgsBearerToken/su,
    );
  });
});
