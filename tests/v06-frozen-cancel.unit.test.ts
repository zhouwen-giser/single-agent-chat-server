import { describe, it, expect } from "@jest/globals";
import { createGroundingSourceAnalysisControl } from "../packages/analysis-control-runtime/src/grounding-source-control.js";
import { createGroundingClientSelector } from "../packages/wsgs-analysis-adapter/src/contract-identity.js";
import { publicCanonicalHash } from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import {
  analysisRunSchema,
  analysisRevisionSchema,
  analysisSessionSchema,
} from "../packages/analysis-contract/src/index.js";
import type { GroundingExecution } from "../packages/persistence/src/index.js";
import {
  frozenRequest,
  frozenJob,
  startFrozenWsgsPeer,
} from "./helpers/frozen-wsgs-http.js";
const v12 = {
  contractVersion: "sacs-wsgs-grounding/1.2",
  resultProfile: "wsgs-world-analysis-findings/1.0",
} as const;
const scope = { analysisId: "a1", principalId: "p1", threadId: "t1" };
const request = { analysisId: "a1", userId: "u1", userRole: "user" };
const command = {
  commandId: "c1",
  expectedRevisionId: "r1",
  expectedRevisionNumber: 0,
  idempotencyKey: "key1",
  reason: "USER_REQUESTED" as const,
};
describe("real source cancel control with memory persistence boundary", () => {
  it.each([false, true])(
    "AC-032 records intent before HTTP, stable replay, unconfirmed error=%s",
    async (failed) => {
      let intentSaved = false,
        pendingVisible = false,
        completed: unknown,
        claimed = false,
        pumpEnsures = 0;
      const peer = await startFrozenWsgsPeer((r) => {
        expect(intentSaved).toBe(true);
        expect(pendingVisible).toBe(true);
        expect(r.path).toBe("/v1/groundings/grounding-1:cancel");
        return failed
          ? { status: 503, value: {} }
          : {
              value: {
                ...frozenJob("CANCELLED"),
                finishedAt: "2026-09-06T10:00:00.000+08:00",
              },
            };
      });
      try {
        const currentRun = analysisRunSchema.parse({
          schemaVersion: "sacs-analysis-run/1.0",
          runId: "run1",
          revisionId: "r1",
          attempt: 1,
          status: "RUNNING",
          startedAt: "2026-09-06T00:00:00Z",
        });
        const currentRevision = analysisRevisionSchema.parse({
          schemaVersion: "sacs-analysis-revision/1.0",
          revisionId: "r1",
          analysisId: "a1",
          revisionNumber: 0,
          cause: "INITIAL_QUERY",
          source: {
            kind: "WSGS_GROUNDING_JOB",
            sourceId: "grounding-1",
            sourceHash: publicCanonicalHash(frozenRequest()),
            contractIdentity: v12,
          },
          changedPaths: [],
          reusedNodeIds: [],
          invalidatedNodeIds: [],
          rerunNodeIds: [],
          status: "RUNNING",
          createdAt: "2026-09-06T00:00:00Z",
        });
        const session = analysisSessionSchema.parse({
          schemaVersion: "sacs-analysis-session/1.0",
          ...scope,
          groundingId: "grounding-1",
          title: "World",
          autonomyMode: "OBSERVER",
          status: "ACTIVE",
          activeRevisionId: "r1",
          latestRevisionNumber: 0,
          observerPolicyHash: publicCanonicalHash({ mode: "OBSERVER" }),
          createdAt: "2026-09-06T00:00:00Z",
          updatedAt: "2026-09-06T00:00:00Z",
        });
        const execution: GroundingExecution = {
          groundingId: "local1",
          principalId: "p1",
          threadId: "t1",
          interactionRequestId: "i1",
          wsgsRequestId: frozenRequest().requestId,
          idempotencyKey: "submit-key",
          requestHash: publicCanonicalHash(frozenRequest()).slice(7),
          wsgsOperation: frozenRequest().operation,
          requestedProducts: frozenRequest().requestedProducts,
          contextUsage: {},
          state: "GROUNDING_PENDING",
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          wsgsGroundingId: "grounding-1",
          sourceJobId: "job-1",
          lastSourceStatus: "RUNNING",
          canonicalRequest: JSON.parse(JSON.stringify(frozenRequest())),
          analysisIntent: { contractIdentity: v12 },
        };
        const clientForContract = createGroundingClientSelector({
          baseUrl: peer.baseUrl,
        });
        const service = createGroundingSourceAnalysisControl({
          wsgs: clientForContract(v12),
          clientForContract,
          runtime: {
            getProjection: async () => undefined,
            pump: {
              ensure: async () => {
                pumpEnsures++;
                return {
                  ...scope,
                  state: "RUNNING",
                  lastEventSequence: 0,
                  subscriptionCount: 0,
                };
              },
            },
          },
          analysis: {
            findSession: async () => session,
            getGroundingAnalysis: async () => ({
              session,
              revision: currentRevision,
              run: currentRun,
              groundingExecutionId: "local1",
            }),
          },
          grounding: {
            requestSourceCancellation: async () => {
              intentSaved = true;
              return { ...execution, cancelRequested: true };
            },
          },
          store: {
            resolveRequestScope: async () => scope,
            claimCancel: async () => {
              if (completed)
                return { disposition: "REPLAY", result: completed };
              if (claimed) throw Error("ANALYSIS_MUTATION_PENDING");
              claimed = true;
              return { disposition: "CLAIMED", claimToken: "claim1" };
            },
            loadCancelContext: async () => ({
              session,
              currentRevision,
              currentRun,
            }),
            commitCancellation: async (input) => {
              pendingVisible = true;
              const result = {
                status: input.transition.settled.status,
                acknowledged: false,
                ...(input.sourceObservationError
                  ? { reasonCode: input.sourceObservationError }
                  : {}),
              };
              if (!input.deferCommandCompletion) completed = result;
              return result;
            },
          },
        });
        const first = await service.requestCancel(request, command);
        expect(first).toEqual(
          failed
            ? {
                status: "CANCEL_REQUESTED",
                acknowledged: false,
                reasonCode: "WSGS_CANCEL_OBSERVATION_UNCONFIRMED",
              }
            : { status: "CANCEL_REQUESTED", acknowledged: false },
        );
        expect(await service.requestCancel(request, command)).toEqual(first);
        expect(peer.captured).toHaveLength(1);
        expect(pumpEnsures).toBe(1);
      } finally {
        await peer.close();
      }
    },
  );
});
