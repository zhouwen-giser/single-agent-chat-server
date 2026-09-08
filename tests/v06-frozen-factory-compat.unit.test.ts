import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { createV06GroundingAnalysis } from "../apps/server/src/v06-grounding-analysis.js";
import { parseGroundingAnalysisConfig } from "../packages/wsgs-analysis-adapter/src/config.js";
import type { WsgsGroundingRequest } from "../packages/wsgs-http-adapter/src/index.js";
import type { WorldGroundingRuntimeTurn } from "../packages/world-grounding-runtime/src/index.js";
import {
  FrozenWorldAnalysisContract,
  type GroundingCapabilities12,
} from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import {
  frozenResult,
  publicExample,
  startFrozenWsgsPeer,
} from "./helpers/frozen-wsgs-http.js";
import {
  MemoryFrozenAnalysis,
  MemoryFrozenControl,
  MemoryFrozenInteraction,
  frozenNow,
} from "./helpers/memory-frozen-analysis.js";
import { MemoryGrounding } from "./helpers/memory-grounding.js";

function persistence() {
  const grounding = new MemoryGrounding(frozenNow);
  const analysis = new MemoryFrozenAnalysis(grounding, frozenNow);
  return {
    groundingRepository: grounding,
    analysisRepository: analysis,
    analysisDevelopmentRepository: new MemoryFrozenControl(analysis, frozenNow),
    interactionRepository: new MemoryFrozenInteraction(frozenNow),
  };
}
const turn: WorldGroundingRuntimeTurn = {
  protocol: "openai",
  principalId: "principal-compat",
  threadId: "thread-compat",
  externalRequestId: "message-compat",
  userText: "查询道路的世界参考信息",
  turnPlan: {
    schemaVersion: "0.4",
    turnRoute: "WORLD_ANSWER",
    groundingRequirement: "ANSWER_WORLD_QUERY",
    answerMode: "GROUNDED",
    worldFocusUsage: {
      knownWorldReferences: false,
      priorGrounding: false,
      mapSelections: false,
      externalCorrelationHints: false,
      externalPredicates: false,
    },
  },
};
const lock: unknown = JSON.parse(
  readFileSync(
    "dependencies/sdar-grounding-extension-compatibility-lock.json",
    "utf8",
  ),
);
describe("frozen factory compatibility boundaries through real HTTP", () => {
  it("AC-040 disabling optional analysis preserves the ordinary legacy 1.0 reference/world path", async () => {
    const peer = await startFrozenWsgsPeer((request) => {
      const value = request.path.endsWith("capabilities")
        ? {
            service: "world-semantic-grounding-service",
            version: "0.1.0",
            contractVersion: "sacs-wsgs-grounding/1.0",
            supportedOperations: [
              "GROUND_REFERENCES",
              "COMPILE_WORLD_QUERY",
              "EXECUTE_WORLD_QUERY",
              "VALIDATE_REFERENCES",
            ],
            supportedProducts: [],
            gowmContract: {
              softwareVersion: "0.4.0",
              commit: "a".repeat(40),
              sourcePackageArtifacts: 33,
            },
            requiredCapabilitiesReady: true,
            optionalCapabilities: [],
          }
        : (() => {
            const body = JSON.parse(request.body) as WsgsGroundingRequest;
            return {
              schemaVersion: "1.0",
              requestId: body.requestId,
              groundingId: "legacy-source-compat",
              status: "COMPLETED",
              source: {
                messageId: body.source.messageId,
                originalTextSha256: body.source.originalTextSha256,
              },
              mentions: [],
              referenceProducts: [
                {
                  productId: "reference-compat",
                  productKind: "RESOLVED_REFERENCE",
                  referenceKey: {
                    namespace: "gowm",
                    kind: "road_segment",
                    id: "wrf_" + "b".repeat(32),
                    version: "42",
                  },
                  referenceType: "road_segment",
                  displayName: "Road 7",
                  sourceOperation: "query-road",
                  sourceWorldVersion: 42,
                  safeSummary: { state: "published" },
                },
              ],
              evidenceItems: [],
              ambiguities: [],
              unresolvedMentions: [],
              capabilityGaps: [],
              warnings: [],
              execution: {
                parserVersion: "1",
                semanticModelReceiptIds: [],
                queryCompilerVersion: "1",
                normalizerVersion: "1",
                elapsedMs: 1,
              },
              resultHash: "sha256:" + "c".repeat(64),
            };
          })();
      return {
        value,
        headers: { "wsgs-contract-version": "sacs-wsgs-grounding/1.0" },
      };
    });
    try {
      const store = persistence();
      const app = createV06GroundingAnalysis({
        persistence: store,
        config: parseGroundingAnalysisConfig({}),
        wsgsConfig: { baseUrl: peer.baseUrl },
        sdarCompatibilityLock: lock,
        now: frozenNow,
      });
      expect(app.source).toBeUndefined();
      expect(app.analysisControl).toBeUndefined();
      expect(app.runAgUiV03).toBeUndefined();
      expect(await app.capabilities()).toMatchObject({ enabled: false });
      const answer = await app.world.answerWorld(turn);
      expect(answer).toContain("Road 7");
      expect(await app.world.answerWorld(turn)).toBe(answer);
      expect(
        peer.captured.filter((request) => request.method === "POST"),
      ).toHaveLength(1);
      expect(
        peer.captured.every(
          (request) =>
            request.headers["wsgs-contract-version"] === undefined &&
            request.headers["wsgs-result-profile"] === undefined,
        ),
      ).toBe(true);
      expect([...store.groundingRepository.rows.values()][0]).toMatchObject({
        state: "COMPLETED",
      });
    } finally {
      await peer.close();
    }
  });
  it("AC-006 AC-040 unavailable historical optional capabilities do not block an independent world query", async () => {
    const capabilities = publicExample<GroundingCapabilities12>("capabilities");
    capabilities.requiredCapabilitiesReady = false;
    new FrozenWorldAnalysisContract().parse("capabilities", capabilities);
    const peer = await startFrozenWsgsPeer((request) => ({
      value: request.path.endsWith("capabilities")
        ? capabilities
        : frozenResult(
            "empty",
            new FrozenWorldAnalysisContract().parse(
              "request",
              JSON.parse(request.body),
            ),
          ),
    }));
    const app = createV06GroundingAnalysis({
      persistence: persistence(),
      config: parseGroundingAnalysisConfig({
        SACS_WSGS_ANALYSIS_ENABLED: "true",
      }),
      wsgsConfig: { baseUrl: peer.baseUrl },
      sdarCompatibilityLock: lock,
      now: frozenNow,
    });
    try {
      expect(await app.capabilities()).toMatchObject({
        enabled: true,
        requiredReady: false,
        optionalAvailable: [],
        nativeReady: false,
      });
      await expect(app.world.answerWorld(turn)).resolves.not.toContain(
        "CAPABILITY_UNAVAILABLE",
      );
      expect(
        peer.captured.filter((request) => request.method === "POST"),
      ).toHaveLength(1);
    } finally {
      await app.source?.close();
      await peer.close();
    }
  });
});
