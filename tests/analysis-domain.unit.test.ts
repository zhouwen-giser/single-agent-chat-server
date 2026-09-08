import { describe, expect, it } from "@jest/globals";

import {
  analysisRevisionSchema,
  analysisRunSchema,
  mapLayerDescriptorSchema,
  type FocusTarget,
  type MapLayerDescriptor,
} from "../packages/analysis-contract/src/index.js";
import {
  emptyMapSharedState,
  isLocalOnlyMapAction,
  reduceMapSharedState,
} from "../packages/analysis-map/src/index.js";
import {
  OBSERVER_FIRST_POLICY_HASH,
  decideObserverPolicy,
  type ObserverPolicyInput,
} from "../packages/analysis-policy/src/observer-first.js";
import {
  projectSharedTimeline,
  requiresAnalysisRevisionForTimeWindowChange,
  updateLocalPlayback,
} from "../packages/analysis-timeline/src/index.js";

const hash = `sha256:${"0".repeat(64)}`;
const now = "2026-08-30T00:00:00.000Z";

describe("v0.5 analysis domain", () => {
  it("keeps immutable Revision lineage distinct from Run attempts", () => {
    const revision = analysisRevisionSchema.parse({
      schemaVersion: "sacs-analysis-revision/1.0",
      revisionId: "revision-2",
      analysisId: "analysis-1",
      revisionNumber: 2,
      parentRevisionId: "revision-1",
      parentRunId: "run-1",
      cause: "USER_PROPOSAL",
      wsgsPlanId: "plan-2",
      planHash: hash,
      changedPaths: ["/radius"],
      reusedNodeIds: ["node-reference"],
      invalidatedNodeIds: [],
      rerunNodeIds: ["node-radius"],
      status: "QUEUED",
      createdAt: now,
    });
    const run = analysisRunSchema.parse({
      schemaVersion: "sacs-analysis-run/1.0",
      runId: "run-2",
      revisionId: revision.revisionId,
      attempt: 2,
      parentRunId: "run-1",
      status: "STARTING",
      startedAt: now,
    });
    expect(revision.revisionNumber).toBe(2);
    expect(run.attempt).toBe(2);
    expect(() => analysisRunSchema.parse({ ...run, planHash: hash })).toThrow();
  });

  for (const terminalGap of [
    "DATA_GAP",
    "COVERAGE_GAP",
    "CAPABILITY_GAP",
  ] as const) {
    it(`auto-finishes ${terminalGap} without interrupt`, () => {
      expect(decideObserverPolicy(policyInput({ terminalGap })).decision).toBe(
        "AUTO_CONTINUE",
      );
    });
  }

  it("interrupts only exceptional ambiguity, authority, budget, risk, or explicit user stop", () => {
    expect(
      decideObserverPolicy(
        policyInput({ ambiguity: "AFFECTS_OUTCOME_UNRESOLVED" }),
      ).interruptType,
    ).toBe("AMBIGUITY");
    expect(
      decideObserverPolicy(policyInput({ permissionRequired: true }))
        .interruptType,
    ).toBe("PERMISSION");
    expect(
      decideObserverPolicy(policyInput({ budgetRequiresApproval: true }))
        .interruptType,
    ).toBe("BUDGET");
    expect(
      decideObserverPolicy(policyInput({ riskLevel: "CONTROLLED" }))
        .interruptType,
    ).toBe("HIGH_RISK");
    const decision = decideObserverPolicy(
      policyInput({ userRequest: "INTERRUPT_AND_CHANGE" }),
    );
    expect(decision.interruptType).toBe("USER_REQUESTED");
    expect(decision.observerPolicyHash).toBe(OBSERVER_FIRST_POLICY_HASH);
    expect(
      decideObserverPolicy(
        policyInput({
          terminalGap: "DATA_GAP",
          permissionRequired: true,
        }),
      ).interruptType,
    ).toBe("PERMISSION");
    expect(
      decideObserverPolicy(
        policyInput({
          terminalGap: "CAPABILITY_GAP",
          riskLevel: "IRREVERSIBLE",
        }),
      ).interruptType,
    ).toBe("HIGH_RISK");
  });

  it("auto-runs clear work, notifies long work, and queues suggestions", () => {
    expect(decideObserverPolicy(policyInput()).decision).toBe("AUTO_CONTINUE");
    expect(
      decideObserverPolicy(policyInput({ riskLevel: "REVERSIBLE" })).decision,
    ).toBe("AUTO_CONTINUE");
    expect(
      decideObserverPolicy(policyInput({ longRunning: true })).decision,
    ).toBe("NOTIFY_ONLY");
    expect(
      decideObserverPolicy(policyInput({ userRequest: "SUGGEST_CHANGE" }))
        .decision,
    ).toBe("QUEUE_REVISION");
  });

  it("keeps map browsing local and map findings durable across load failure", () => {
    expect(isLocalOnlyMapAction("PAN")).toBe(true);
    expect(isLocalOnlyMapAction("HOVER")).toBe(true);
    expect(isLocalOnlyMapAction("ANALYSIS_COMMAND")).toBe(false);
    const layer = findingLayer();
    const withLayer = reduceMapSharedState(emptyMapSharedState(), {
      type: "LAYER_UPSERT",
      layer,
    });
    const failed = reduceMapSharedState(withLayer, {
      type: "LAYER_LOAD_STATUS",
      layerId: layer.layerId,
      loadStatus: "ERROR",
    });
    expect(failed.layersById[layer.layerId]?.findingIds).toEqual(["finding-1"]);
    expect(failed.layersById[layer.layerId]?.loadStatus).toBe("ERROR");
  });

  it("separates execution, intervention, pinned, and local inspection focus", () => {
    const execution = focus("execution", "SUBJECT");
    const intervention = focus("intervention", "CANDIDATE");
    const pinned = focus("pinned", "SELECTED_RESULT");
    let state = reduceMapSharedState(emptyMapSharedState(), {
      type: "EXECUTION_FOCUS_SET",
      focus: execution,
    });
    state = reduceMapSharedState(state, {
      type: "INTERVENTION_FOCUS_SET",
      focus: intervention,
    });
    state = reduceMapSharedState(state, { type: "FOCUS_PIN", focus: pinned });
    expect(state.executionFocus?.focusId).toBe("execution");
    expect(state.interventionFocus?.focusId).toBe("intervention");
    expect(state.pinnedFocusById.pinned?.focusId).toBe("pinned");
  });

  it("marks old revision layers superseded but inspectable", () => {
    const layer = findingLayer();
    const state = reduceMapSharedState(
      reduceMapSharedState(emptyMapSharedState(), {
        type: "LAYER_UPSERT",
        layer,
      }),
      { type: "REVISION_SUPERSEDED", revisionId: layer.revisionId },
    );
    expect(state.layersById[layer.layerId]?.relevanceStatus).toBe("SUPERSEDED");
  });

  it("rejects editable authoritative geometry and mismatched access", () => {
    const layer = findingLayer();
    expect(() =>
      mapLayerDescriptorSchema.parse({ ...layer, editable: true }),
    ).toThrow();
    expect(() =>
      mapLayerDescriptorSchema.parse({
        ...layer,
        representation: "REFERENCE_SET",
      }),
    ).toThrow();
  });

  it("keeps GDPS as current background during historical analysis", () => {
    const timeline = projectSharedTimeline({
      schemaVersion: "sacs-shared-timeline/1.0",
      analysisTimeWindow: {
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-01-02T00:00:00.000Z",
        authority: "VALID_TIME",
      },
      sources: {
        terrain: {
          sourceKind: "GDPS",
          timeSemantics: "current product",
          displayRole: "HISTORICAL",
        },
        world: {
          sourceKind: "GOWM",
          timeSemantics: "valid time",
          displayRole: "HISTORICAL",
        },
      },
    });
    expect(timeline.sources.terrain?.displayRole).toBe("CURRENT_BACKGROUND");
    expect(timeline.sources.world?.displayRole).toBe("HISTORICAL");
    expect(
      requiresAnalysisRevisionForTimeWindowChange(
        undefined,
        timeline.analysisTimeWindow,
      ),
    ).toBe(true);
    expect(
      updateLocalPlayback({ rate: 1, playing: false }, { rate: 4 }).rate,
    ).toBe(4);
  });
});

function policyInput(
  override: Partial<ObserverPolicyInput> = {},
): ObserverPolicyInput {
  return {
    analysisId: "analysis-1",
    revisionId: "revision-1",
    nodeId: "node-1",
    riskLevel: "READ_ONLY",
    ambiguity: "NONE",
    longRunning: false,
    userRequest: "NONE",
    permissionRequired: false,
    budgetRequiresApproval: false,
    terminalGap: "NONE",
    occurredAt: now,
    ...override,
  };
}

function findingLayer(): MapLayerDescriptor {
  return {
    schemaVersion: "sacs-map-layer/1.0",
    layerId: "layer-1",
    title: "Finding",
    role: "FINAL_FINDING",
    representation: "INLINE_GEOJSON",
    sourceAuthority: "WSGS",
    access: {
      kind: "INLINE_GEOJSON",
      data: { type: "FeatureCollection", features: [] },
    },
    visibleByDefault: true,
    selectable: true,
    editable: false,
    analysisId: "analysis-1",
    revisionId: "revision-1",
    nodeId: "node-1",
    findingIds: ["finding-1"],
    loadStatus: "READY",
    relevanceStatus: "ACTIVE",
    currentness: "CURRENT",
    styleToken: "finding.primary",
  };
}

function focus(
  focusId: string,
  semanticRole: FocusTarget["semanticRole"],
): FocusTarget {
  return {
    focusId,
    targetKind: "FINDING_FEATURE",
    findingId: "finding-1",
    featureId: `feature-${focusId}`,
    semanticRole,
    currentness: "CURRENT",
  };
}
