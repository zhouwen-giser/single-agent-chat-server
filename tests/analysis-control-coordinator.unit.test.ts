import { describe, expect, it, jest } from "@jest/globals";

import {
  AnalysisServiceError,
  createAnalysisControlCoordinator,
  type AnalysisCoordinatorStore,
  type AnalysisCoordinatorWsgsPort,
  type AnalysisProposalContext,
} from "../packages/analysis-control-runtime/src/index.js";
import type {
  AnalysisIntervention,
  ToolInteractionDescriptor,
} from "../packages/analysis-contract/src/index.js";
import { hashCanonicalJson } from "../packages/world-explanation-contract/src/index.js";

const now = "2026-08-30T00:00:00.000Z";
const hash1 = `sha256:${"1".repeat(64)}`;
const hash2 = `sha256:${"2".repeat(64)}`;

describe("v0.5 analysis control coordinator", () => {
  it("queues a non-blocking revision and leaves the current run alone", async () => {
    const store = coordinatorStore();
    const wsgs = wsgsPort();
    const coordinator = createCoordinator(store, wsgs);
    const result = await coordinator.submitProposal(scope(), proposalCommand());
    expect(wsgs.cancelRun).not.toHaveBeenCalled();
    expect(wsgs.compileRevision).toHaveBeenCalledTimes(1);
    expect(store.commitCompiledRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevisionId: "revision-1",
        revision: expect.objectContaining({
          revisionId: "revision-2",
          revisionNumber: 2,
          status: "QUEUED",
          reusedNodeIds: ["reference"],
          rerunNodeIds: ["query"],
        }),
      }),
    );
    expect(result).toEqual({ status: "COMPILED" });
  });

  it("rejects stale CAS and pending/idempotency conflicts before WSGS", async () => {
    const wsgs = wsgsPort();
    const stale = createCoordinator(coordinatorStore(), wsgs);
    await expect(
      stale.submitProposal(scope(), {
        ...proposalCommand(),
        expectedRevisionNumber: 0,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "ANALYSIS_REVISION_CONFLICT",
    });
    expect(wsgs.compileRevision).not.toHaveBeenCalled();

    for (const [disposition, code] of [
      ["IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT"],
      ["PENDING_CONFLICT", "PROPOSAL_ALREADY_PENDING"],
    ] as const) {
      const store = coordinatorStore({
        claimProposal: jest.fn(async () => ({ disposition })),
      });
      await expect(
        createCoordinator(store, wsgs).submitProposal(
          scope(),
          proposalCommand(),
        ),
      ).rejects.toMatchObject({ statusCode: 409, code });
    }
  });

  it("replays an exact proposal without a second compile", async () => {
    const store = coordinatorStore({
      loadProposalContext: jest.fn(async () => {
        throw new Error("mutable state must not be loaded on replay");
      }),
      claimProposal: jest.fn(async () => ({
        disposition: "REPLAY" as const,
        result: { status: "COMPILED", revisionId: "revision-2" },
      })),
    });
    const wsgs = wsgsPort();
    await expect(
      createCoordinator(store, wsgs).submitProposal(scope(), proposalCommand()),
    ).resolves.toEqual({ status: "COMPILED", revisionId: "revision-2" });
    expect(store.loadProposalContext).not.toHaveBeenCalled();
    expect(wsgs.compileRevision).not.toHaveBeenCalled();
  });

  it("replays cancel and intervention results before terminal or expiry checks", async () => {
    const store = coordinatorStore({
      loadCancelContext: jest.fn(async () => {
        throw new Error("cancel context must not load on replay");
      }),
      claimCancel: jest.fn(async () => ({
        disposition: "REPLAY" as const,
        result: { status: "CANCELLED" },
      })),
      loadInterventionContext: jest.fn(async () => {
        throw new Error("intervention context must not load on replay");
      }),
      claimInterventionResolution: jest.fn(async () => ({
        disposition: "REPLAY" as const,
        result: { status: "RESOLVED" },
      })),
    });
    const wsgs = wsgsPort();
    const coordinator = createCoordinator(store, wsgs);

    await expect(
      coordinator.requestCancel(scope(), {
        commandId: "cancel-1",
        expectedRevisionId: "revision-1",
        expectedRevisionNumber: 1,
        idempotencyKey: "cancel-key",
        reason: "USER_REQUESTED",
      }),
    ).resolves.toEqual({ status: "CANCELLED" });
    await expect(
      coordinator.resolveIntervention(
        { ...scope(), interventionId: "intervention-1" },
        {
          commandId: "resolve-1",
          idempotencyKey: "resolve-key",
          response: { candidateId: "candidate-1" },
        },
      ),
    ).resolves.toEqual({ status: "RESOLVED" });
    expect(store.loadCancelContext).not.toHaveBeenCalled();
    expect(store.loadInterventionContext).not.toHaveBeenCalled();
    expect(wsgs.cancelRun).not.toHaveBeenCalled();
    expect(wsgs.resolveIntervention).not.toHaveBeenCalled();
  });

  it("does not allow interrupt-and-apply unless WSGS tool policy permits it", async () => {
    const wsgs = wsgsPort();
    await expect(
      createCoordinator(coordinatorStore(), wsgs).submitProposal(scope(), {
        ...proposalCommand(),
        mode: "INTERRUPT_AND_APPLY",
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "INTERRUPT_EDIT_POLICY_FORBIDDEN",
    });
    expect(wsgs.cancelRun).not.toHaveBeenCalled();
  });

  it("keeps the old run active and queues the compiled revision if cancel is unsupported", async () => {
    const context = proposalContext({
      descriptor: descriptor({ editPolicy: "CANCEL_AND_RESTART_ALLOWED" }),
    });
    const store = coordinatorStore({
      loadProposalContext: jest.fn(async () => context),
    });
    const wsgs = wsgsPort({
      cancelRun: jest.fn(async () => ({
        supported: false,
        acknowledged: false,
        upstreamRunId: "upstream-run-1",
      })),
    });
    await createCoordinator(store, wsgs).submitProposal(scope(), {
      ...proposalCommand(),
      mode: "INTERRUPT_AND_APPLY",
    });
    expect(store.commitCompiledRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        cancellation: expect.objectContaining({ queueRevision: true }),
        revision: expect.objectContaining({ status: "QUEUED" }),
      }),
    );
  });

  it("resumes an intervention as a new Run with parent lineage", async () => {
    const store = coordinatorStore();
    const wsgs = wsgsPort();
    const result = await createCoordinator(store, wsgs).resolveIntervention(
      { ...scope(), interventionId: "intervention-1" },
      {
        commandId: "command-resolve",
        idempotencyKey: "resolve-key",
        response: { candidateId: "candidate-1" },
      },
    );
    expect(wsgs.resolveIntervention).toHaveBeenCalledWith(
      expect.objectContaining({
        interruptId: "interrupt-1",
        response: { candidateId: "candidate-1" },
      }),
    );
    expect(store.commitInterventionResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        resumedRun: expect.objectContaining({
          runId: "run-2",
          parentRunId: "run-1",
          attempt: 2,
          upstreamRunId: "upstream-run-2",
        }),
      }),
    );
    expect(result).toEqual({ status: "RESOLVED" });
  });

  it("rejects invalid intervention responses without calling WSGS", async () => {
    const store = coordinatorStore({
      loadInterventionContext: jest.fn(async () => ({
        intervention: intervention(),
        currentRun: proposalContext().currentRun,
        validateResponse: () => false,
      })),
    });
    const wsgs = wsgsPort();
    await expect(
      createCoordinator(store, wsgs).resolveIntervention(
        { ...scope(), interventionId: "intervention-1" },
        {
          commandId: "command-resolve",
          idempotencyKey: "resolve-key",
          response: { secretCandidate: "bad" },
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "INTERVENTION_RESPONSE_SCHEMA_INVALID",
    });
    expect(wsgs.resolveIntervention).not.toHaveBeenCalled();
  });
});

function createCoordinator(
  store: AnalysisCoordinatorStore,
  wsgs: AnalysisCoordinatorWsgsPort,
) {
  let revisionIds = 1;
  let runIds = 1;
  return createAnalysisControlCoordinator({
    store,
    wsgs,
    now: () => now,
    nextId: (kind) =>
      kind === "revision" ? `revision-${++revisionIds}` : `run-${++runIds}`,
  });
}

function coordinatorStore(
  override: Partial<AnalysisCoordinatorStore> = {},
): AnalysisCoordinatorStore & Record<string, jest.Mock> {
  return {
    getAnalysis: jest.fn(async () => ({ analysisId: "analysis-1" })),
    getSnapshot: jest.fn(async () => ({ stateRevision: 1 })),
    loadProposalContext: jest.fn(async () => proposalContext()),
    claimProposal: jest.fn(async () => ({ disposition: "CLAIMED" })),
    commitCompiledRevision: jest.fn(async () => ({ status: "COMPILED" })),
    markProposalFailed: jest.fn(async () => undefined),
    loadCancelContext: jest.fn(async () => proposalContext()),
    claimCancel: jest.fn(async () => ({ disposition: "CLAIMED" })),
    commitCancellation: jest.fn(async () => ({ status: "CANCELLED" })),
    loadInterventionContext: jest.fn(async () => ({
      intervention: intervention(),
      currentRun: proposalContext().currentRun,
      validateResponse: (value: Readonly<Record<string, unknown>>) =>
        typeof value.candidateId === "string",
    })),
    claimInterventionResolution: jest.fn(async () => ({
      disposition: "CLAIMED",
    })),
    commitInterventionResolution: jest.fn(async () => ({
      status: "RESOLVED",
    })),
    ...override,
  } as AnalysisCoordinatorStore & Record<string, jest.Mock>;
}

function wsgsPort(
  override: Partial<AnalysisCoordinatorWsgsPort> = {},
): AnalysisCoordinatorWsgsPort & Record<string, jest.Mock> {
  return {
    compileRevision: jest.fn(async () => ({
      upstreamAnalysisId: "upstream-analysis-1",
      planId: "plan-2",
      planHash: hash2,
      planRevision: 2,
      parentPlanId: "plan-1",
      parentPlanHash: hash1,
      nodeIds: ["reference", "query"],
      reusedNodeIds: ["reference"],
      invalidatedNodeIds: [],
      rerunNodeIds: ["query"],
    })),
    cancelRun: jest.fn(async () => ({
      supported: true,
      acknowledged: true,
      upstreamRunId: "upstream-run-1",
    })),
    resolveIntervention: jest.fn(async () => ({
      accepted: true,
      parentUpstreamRunId: "upstream-run-1",
      upstreamRunId: "upstream-run-2",
    })),
    ...override,
  } as AnalysisCoordinatorWsgsPort & Record<string, jest.Mock>;
}

function proposalContext(
  override: Partial<AnalysisProposalContext> = {},
): AnalysisProposalContext {
  return {
    session: {
      schemaVersion: "sacs-analysis-session/1.0",
      analysisId: "analysis-1",
      principalId: "principal-1",
      threadId: "thread-1",
      groundingId: "grounding-1",
      title: "analysis",
      autonomyMode: "OBSERVER",
      status: "ACTIVE",
      activeRevisionId: "revision-1",
      latestRevisionNumber: 1,
      observerPolicyHash: hash1,
      createdAt: now,
      updatedAt: now,
    },
    currentRevision: {
      schemaVersion: "sacs-analysis-revision/1.0",
      revisionId: "revision-1",
      analysisId: "analysis-1",
      revisionNumber: 1,
      cause: "INITIAL_QUERY",
      wsgsPlanId: "plan-1",
      planHash: hash1,
      changedPaths: [],
      reusedNodeIds: [],
      invalidatedNodeIds: [],
      rerunNodeIds: ["reference", "query"],
      status: "RUNNING",
      createdAt: now,
    },
    currentRun: {
      schemaVersion: "sacs-analysis-run/1.0",
      runId: "run-1",
      revisionId: "revision-1",
      attempt: 1,
      upstreamRunId: "upstream-run-1",
      status: "RUNNING",
      startedAt: now,
    },
    descriptor: descriptor(),
    validatePublicArgs: (value) =>
      typeof value.radiusMeters === "number" && value.radiusMeters > 0,
    ...override,
  };
}

function descriptor(
  override: Partial<ToolInteractionDescriptor> = {},
): ToolInteractionDescriptor {
  const publicArgs = { radiusMeters: 1_000 };
  return {
    schemaVersion: "sacs-wsgs-tool-interaction/1.0",
    toolCallId: "tool-1",
    nodeId: "query",
    operationKey: "nearby.find@1.0",
    executionArgsHash: `sha256:${"f".repeat(64)}`,
    publicArgs,
    publicArgsHash: hashCanonicalJson(publicArgs),
    publicEditSchemaUri: "urn:wsgs:edit:nearby:1.0",
    publicEditSchemaHash: hash1,
    editablePaths: ["/radiusMeters"],
    editorHints: [{ path: "/radiusMeters", editor: "MAP_RADIUS" }],
    editSemantics: "CHANGE_CONSTRAINT",
    editPolicy: "SUGGEST_NEXT_REVISION",
    ...override,
  };
}

function intervention(): AnalysisIntervention {
  return {
    schemaVersion: "sacs-analysis-intervention/1.0",
    interventionId: "intervention-1",
    analysisId: "analysis-1",
    revisionId: "revision-1",
    runId: "run-1",
    interruptId: "interrupt-1",
    reason: "AMBIGUITY",
    status: "OPEN",
    requestPayload: { candidates: ["candidate-1"] },
    createdAt: now,
  };
}

function proposalCommand() {
  return {
    commandId: "command-proposal",
    proposalId: "proposal-1",
    expectedRevisionId: "revision-1",
    expectedRevisionNumber: 1,
    targetNodeId: "query",
    publicArgsHash: descriptor().publicArgsHash,
    editSchemaHash: hash1,
    patch: [{ op: "replace" as const, path: "/radiusMeters", value: 600 }],
    mode: "SUGGEST_NEXT_REVISION" as const,
    idempotencyKey: "proposal-key",
  };
}

function scope() {
  return { analysisId: "analysis-1", userId: "principal-1", userRole: "user" };
}

void AnalysisServiceError;
