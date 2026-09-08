import { describe, expect, it } from "@jest/globals";

import {
  createDevelopmentAnalysisAgUiV03RunHandler,
  isAnalysisAgUiV03RunHandler,
  projectAnalysisRunFinished,
  projectAnalysisRunStarted,
  type AnalysisAgUiV03DevelopmentReadiness,
  type AnalysisFixtureAdapterManifest,
} from "../packages/ag-ui-analysis-adapter/src/index.js";
import type { AgUiRunHandler } from "../packages/ag-ui-interaction-adapter/src/index.js";

const emptyHandler: AgUiRunHandler = async function* (context) {
  const identity = {
    threadId: context.internalThreadId,
    runId: context.input.runId,
  };
  yield projectAnalysisRunStarted(identity);
  yield projectAnalysisRunFinished(identity);
};

const manifest: AnalysisFixtureAdapterManifest = {
  schemaVersion: "sacs-v05-fixture-adapter/1.0",
  adapterId: "FixtureWsgsAnalysisAdapter",
  environmentEligibility: ["test", "development", "local-compose"],
  supports: [
    "PLAN",
    "EVENTS",
    "COMPILE_REVISION",
    "CANCEL",
    "INTERVENTION",
    "DATA_GAP",
  ],
  productionEligible: false,
};

describe("AG-UI v0.3 fixture development readiness", () => {
  it("brands a complete explicit test/development composition", () => {
    const handler = createDevelopmentAnalysisAgUiV03RunHandler(emptyHandler, {
      environment: { nodeEnv: "test", adapterMode: "fixture" },
      fixture: manifest,
      analysisControlReady: true,
    });

    expect(isAnalysisAgUiV03RunHandler(handler)).toBe(true);
  });

  it("rejects production, incomplete capabilities, and ineligible environments", () => {
    const valid: AnalysisAgUiV03DevelopmentReadiness = {
      environment: { nodeEnv: "development", adapterMode: "fixture" },
      fixture: manifest,
      analysisControlReady: true,
    };
    expect(() =>
      createDevelopmentAnalysisAgUiV03RunHandler(emptyHandler, {
        ...valid,
        environment: {
          nodeEnv: "production",
          adapterMode: "fixture",
        },
      } as unknown as AnalysisAgUiV03DevelopmentReadiness),
    ).toThrow("AG_UI_ANALYSIS_DEVELOPMENT_RUNTIME_NOT_READY");
    expect(() =>
      createDevelopmentAnalysisAgUiV03RunHandler(emptyHandler, {
        ...valid,
        fixture: { ...manifest, supports: ["PLAN", "EVENTS"] },
      } as unknown as AnalysisAgUiV03DevelopmentReadiness),
    ).toThrow("AG_UI_ANALYSIS_DEVELOPMENT_RUNTIME_NOT_READY");
    expect(() =>
      createDevelopmentAnalysisAgUiV03RunHandler(emptyHandler, {
        ...valid,
        fixture: { ...manifest, environmentEligibility: ["test"] },
      }),
    ).toThrow("AG_UI_ANALYSIS_DEVELOPMENT_RUNTIME_NOT_READY");
  });
});
