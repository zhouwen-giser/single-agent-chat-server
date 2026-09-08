import { describe, expect, it } from "@jest/globals";
import { getFileInfo } from "prettier";

describe("generated evidence formatting policy", () => {
  it.each([
    "reports/v0.6/frozen-wsgs-consumer/C00.json",
    "reports/v0.6/frozen-wsgs-consumer/C01.json",
    "reports/v0.6/frozen-wsgs-consumer/C02.json",
    "reports/v0.6/frozen-wsgs-consumer/C03-planner.json",
    "reports/v0.6/frozen-wsgs-consumer/C03.json",
    "reports/v0.6/frozen-wsgs-consumer/C04.json",
    "reports/v0.6/frozen-wsgs-consumer/C05.json",
    "reports/v0.6/frozen-wsgs-consumer/C06.json",
    "reports/v0.6/frozen-wsgs-consumer/FINAL_EVIDENCE_AUDIT.json",
    "reports/v0.6/wsgs-full-functional-integration/ACCEPTANCE_LEDGER.json",
  ])("preserves generator-owned bytes: %s", async (path) => {
    expect(
      await getFileInfo(path, { ignorePath: ".prettierignore" }),
    ).toMatchObject({ ignored: true });
  });

  it.each([
    "apps/server/src/v06-grounding-analysis.ts",
    "packages/analysis-client/src/frozen-world-analysis.ts",
    "scripts/v06-frozen-phase-verify.mjs",
    "tests/format-policy.unit.test.ts",
    "reports/v0.6/frozen-wsgs-consumer/FINAL_REPORT.md",
    "reports/v0.6/frozen-wsgs-consumer/C06.md",
    "reports/v0.6/frozen-wsgs-consumer/ACCEPTANCE_LEDGER.json",
    "reports/v0.6/frozen-wsgs-consumer/new-report.json",
  ])("still checks source and non-exempt reports: %s", async (path) => {
    expect(
      await getFileInfo(path, { ignorePath: ".prettierignore" }),
    ).toMatchObject({ ignored: false });
  });
});
