import { describe, it, expect } from "@jest/globals";
import { parseGroundingAnalysisConfig } from "../packages/wsgs-analysis-adapter/src/config.js";
describe("v06 fail-closed production configuration", () => {
  it("defaults analysis off and preserves explicitly negotiated legacy availability", () => {
    expect(parseGroundingAnalysisConfig({})).toMatchObject({
      enabled: false,
      transport: "GROUNDING_JOB",
      allowLegacy10: true,
      pollIntervalMs: 250,
      maxWaitMs: 120000,
      maxMapLayers: 128,
    });
  });
  it.each(["yes", "1", "TRUE"])(
    "rejects ambiguous enabled value %s",
    (enabled) => {
      expect(() =>
        parseGroundingAnalysisConfig({ SACS_WSGS_ANALYSIS_ENABLED: enabled }),
      ).toThrow();
    },
  );
  it("rejects production fixtures and unavailable Native control", () => {
    expect(() =>
      parseGroundingAnalysisConfig({
        NODE_ENV: "production",
        SACS_WSGS_ANALYSIS_TRANSPORT: "FIXTURE",
      }),
    ).toThrow("ANALYSIS_SOURCE_MODE_INVALID");
    expect(() =>
      parseGroundingAnalysisConfig({
        SACS_WSGS_ANALYSIS_ENABLED: "true",
        SACS_WSGS_ANALYSIS_TRANSPORT: "NATIVE",
      }),
    ).toThrow("ANALYSIS_SOURCE_TRANSPORT_UNAVAILABLE");
  });
  it("rejects version drift and unbounded pumps/polling/outputs", () => {
    for (const [key, value] of Object.entries({
      SACS_WSGS_ANALYSIS_CONTRACT_VERSION: "sacs-wsgs-grounding/1.0",
      SACS_WSGS_ANALYSIS_MAX_ACTIVE_PUMPS: "257",
      SACS_WSGS_ANALYSIS_MAX_WAIT_MS: "999999",
      SACS_WSGS_ANALYSIS_MAX_TIMELINE_ITEMS: "1001",
      SACS_WSGS_ANALYSIS_MAX_MAP_LAYERS: "129",
      SACS_WSGS_ANALYSIS_MAX_SAFE_PAYLOAD_BYTES: "999999",
    }))
      expect(() => parseGroundingAnalysisConfig({ [key]: value })).toThrow();
  });
});
