import { describe, expect, it } from "@jest/globals";
import { FixtureWsgsAnalysisAdapter } from "../packages/wsgs-analysis-adapter/src/index.js";
import { PlanAnalysisSourceBridge } from "../packages/wsgs-analysis-adapter/src/source-bridge.js";
import { hashCanonicalJson } from "../packages/world-explanation-contract/src/index.js";
import type { StartWorldAnalysisRequest } from "../packages/analysis-contract/src/source.js";
const fixture = (scenario: "SUCCESS" | "DATA_GAP" = "SUCCESS") =>
  new FixtureWsgsAnalysisAdapter({
    environment: { NODE_ENV: "test", SACS_ANALYSIS_ADAPTER_MODE: "fixture" },
    defaultScenario: scenario,
  });
const request = () => {
  const body = { requestId: "request-1" };
  return {
    analysisId: "analysis-1",
    revisionId: "revision-1",
    principalId: "user-1",
    threadId: "thread-1",
    requestId: "request-1",
    idempotencyKey: "key-1",
    canonicalGroundingRequest: body,
    requestHash: hashCanonicalJson(body),
  } as StartWorldAnalysisRequest;
};
describe("v06 Plan source bridge", () => {
  it("preserves all five native ports without permitting an unverified native transport", async () => {
    const ports = fixture();
    const bridge = new PlanAnalysisSourceBridge("WSGS_NATIVE_ANALYSIS", ports, {
      nodeEnv: "production",
    });
    expect(bridge.nativePorts).toBe(ports);
    expect(bridge.productionEligible).toBe(false);
    await expect(bridge.start(request())).rejects.toThrow(
      "ANALYSIS_SOURCE_TRANSPORT_UNAVAILABLE",
    );
  });
  it("forbids fixture production construction", () => {
    expect(
      () =>
        new PlanAnalysisSourceBridge("FIXTURE", fixture(), {
          nodeEnv: "production",
        }),
    ).toThrow("ANALYSIS_SOURCE_MODE_INVALID");
  });
  it.each(["SUCCESS", "DATA_GAP"] as const)(
    "preserves fixture %s outcomes and rejects cross-mode reads",
    async (scenario) => {
      const bridge = new PlanAnalysisSourceBridge(
        "FIXTURE",
        fixture(scenario),
        { nodeEnv: "test" },
      );
      const snapshot = await bridge.start(request());
      const events = [];
      for await (const event of bridge.observe({
        analysisId: "analysis-1",
        revisionId: "revision-1",
        runId: "run-1",
        identity: snapshot.identity,
      }))
        events.push(event);
      expect(events.at(-1)?.sourceStatus).toBe(
        scenario === "SUCCESS" ? "COMPLETED" : "PARTIAL",
      );
      await expect(
        bridge.get({ ...snapshot.identity, kind: "WSGS_GROUNDING_JOB" }),
      ).rejects.toThrow("ANALYSIS_SOURCE_IDENTITY_INVALID");
    },
  );
});
