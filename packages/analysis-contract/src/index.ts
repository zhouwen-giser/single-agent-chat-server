import { z } from "zod";

import {
  canonicalJson,
  hashCanonicalJson,
  sha256Schema,
} from "../../world-explanation-contract/src/index.js";
import {
  ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
  isAnalysisPublicArgsNonDisclosing,
} from "./public-args-non-disclosure.js";

export {
  ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
  assertAnalysisPublicPatchNonDisclosure,
  assertAnalysisPublicArgsNonDisclosure,
  isAnalysisPublicArgsNonDisclosing,
} from "./public-args-non-disclosure.js";

export const ANALYSIS_CONTRACT_VERSION = "1.0" as const;
export const ANALYSIS_MAX_NODES = 256;
export const ANALYSIS_MAX_EDGES = 1_024;
export const ANALYSIS_MAX_MAP_LAYERS = 256;
export const ANALYSIS_MAX_PINNED_FOCUS = 64;
export const ANALYSIS_MAX_PATCH_OPERATIONS = 64;
export const ANALYSIS_MAX_EDITABLE_PATHS = 64;
export const ANALYSIS_MAX_PUBLIC_ARGS_BYTES = 262_144;
export const ANALYSIS_MAX_STATE_BYTES = 4_194_304;
export const ANALYSIS_MAX_ACTIVITY_BYTES = 2_097_152;

export const analysisIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const analysisDateTimeSchema = z.iso.datetime();
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const analysisSessionSchema = z
  .object({
    schemaVersion: z.literal("sacs-analysis-session/1.0"),
    analysisId: analysisIdSchema,
    principalId: analysisIdSchema,
    threadId: analysisIdSchema,
    groundingId: analysisIdSchema,
    title: z.string().min(1).max(512),
    autonomyMode: z.enum(["OBSERVER", "ADVISORY", "INTERVENTION"]),
    status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"]),
    activeRevisionId: analysisIdSchema,
    latestRevisionNumber: z.number().int().min(0),
    observerPolicyHash: sha256Schema,
    createdAt: analysisDateTimeSchema,
    updatedAt: analysisDateTimeSchema,
  })
  .strict();

export const analysisRevisionSchema = z
  .object({
    schemaVersion: z.literal("sacs-analysis-revision/1.0"),
    revisionId: analysisIdSchema,
    analysisId: analysisIdSchema,
    revisionNumber: z.number().int().min(0),
    parentRevisionId: analysisIdSchema.optional(),
    parentRunId: analysisIdSchema.optional(),
    cause: z.enum([
      "INITIAL_QUERY",
      "USER_PROPOSAL",
      "USER_INTERVENTION",
      "AMBIGUITY_RESOLUTION",
      "SOURCE_ADVANCED",
      "AUTOMATIC_RETRY",
    ]),
    wsgsPlanId: analysisIdSchema,
    planHash: sha256Schema,
    changedPaths: z.array(z.string().regex(/^\//u)).max(128),
    reusedNodeIds: z.array(analysisIdSchema).max(ANALYSIS_MAX_NODES),
    invalidatedNodeIds: z.array(analysisIdSchema).max(ANALYSIS_MAX_NODES),
    rerunNodeIds: z.array(analysisIdSchema).max(ANALYSIS_MAX_NODES),
    status: z.enum([
      "COMPILING",
      "READY",
      "QUEUED",
      "RUNNING",
      "SUPERSEDED",
      "COMPLETED",
      "PARTIAL",
      "FAILED",
    ]),
    createdAt: analysisDateTimeSchema,
  })
  .strict();

export const analysisRunSchema = z
  .object({
    schemaVersion: z.literal("sacs-analysis-run/1.0"),
    runId: analysisIdSchema,
    revisionId: analysisIdSchema,
    attempt: z.number().int().min(1),
    parentRunId: analysisIdSchema.optional(),
    upstreamRunId: analysisIdSchema.optional(),
    status: z.enum([
      "STARTING",
      "RUNNING",
      "WAITING_INTERVENTION",
      "SUCCEEDED",
      "PARTIAL",
      "FAILED",
      "CANCEL_REQUESTED",
      "CANCELLED",
    ]),
    startedAt: analysisDateTimeSchema,
    finishedAt: analysisDateTimeSchema.optional(),
  })
  .strict();

export const analysisNodeStateSchema = z
  .object({
    schemaVersion: z.literal("sacs-analysis-node-state/1.0"),
    nodeId: analysisIdSchema,
    executionStatus: z.enum([
      "PENDING",
      "READY",
      "RUNNING",
      "SUCCEEDED",
      "PARTIAL",
      "FAILED",
      "CANCELLED",
    ]),
    relevanceStatus: z.enum(["ACTIVE", "SUPERSEDED", "INVALIDATED"]),
    currentness: z.enum(["CURRENT", "STALE", "UNKNOWN"]),
    inputHash: sha256Schema.optional(),
    outputHash: sha256Schema.optional(),
    inputLayerIds: z.array(analysisIdSchema).max(128),
    outputLayerIds: z.array(analysisIdSchema).max(128),
    findingIds: z.array(analysisIdSchema).max(ANALYSIS_MAX_NODES),
    progress: z
      .object({
        completed: z.number().min(0),
        total: z.number().positive().optional(),
        messageCode: z.string().max(128).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const analysisEventSchema = z
  .object({
    schemaVersion: z.literal("sacs-analysis-event/1.0"),
    eventId: analysisIdSchema,
    analysisId: analysisIdSchema,
    revisionId: analysisIdSchema,
    runId: analysisIdSchema,
    analysisSequence: z.number().int().min(1),
    runSequence: z.number().int().min(1),
    upstreamSequence: z.number().int().min(1).optional(),
    eventType: z.string().min(1).max(128),
    nodeId: analysisIdSchema.optional(),
    correlationId: analysisIdSchema,
    causationId: analysisIdSchema.optional(),
    occurredAt: analysisDateTimeSchema,
    payload: jsonObjectSchema,
    payloadHash: sha256Schema,
  })
  .strict();

export const analysisProjectionSchema = z
  .object({
    schemaVersion: z.literal("sacs-analysis-projection/1.0"),
    analysisId: analysisIdSchema,
    stateRevision: z.number().int().min(0),
    activityRevision: z.number().int().min(0),
    state: jsonObjectSchema,
    stateHash: sha256Schema,
    activity: jsonObjectSchema,
    activityHash: sha256Schema,
    lastEventSequence: z.number().int().min(0),
    updatedAt: analysisDateTimeSchema,
  })
  .strict();

export const analysisPatchOperationSchema = z
  .object({
    op: z.enum(["add", "remove", "replace", "test"]),
    path: z.string().regex(/^\//u),
    value: z.unknown().optional(),
  })
  .strict();

export const analysisChangeProposalSchema = z
  .object({
    schemaVersion: z.literal("sacs-analysis-change-proposal/1.0"),
    commandId: analysisIdSchema,
    proposalId: analysisIdSchema,
    analysisId: analysisIdSchema,
    expectedRevisionId: analysisIdSchema,
    expectedRevisionNumber: z.number().int().min(0),
    targetNodeId: analysisIdSchema,
    publicArgsHash: sha256Schema,
    editSchemaHash: sha256Schema,
    patch: z
      .array(analysisPatchOperationSchema)
      .min(1)
      .max(ANALYSIS_MAX_PATCH_OPERATIONS),
    mode: z.enum(["SUGGEST_NEXT_REVISION", "INTERRUPT_AND_APPLY"]),
    idempotencyKey: z.string().min(1).max(256),
    status: z.enum([
      "SUBMITTED",
      "VALIDATING",
      "REJECTED",
      "CONFLICT",
      "ACCEPTED",
      "COMPILING",
      "COMPILE_FAILED",
      "COMPILED",
      "APPLIED",
    ]),
    createdAt: analysisDateTimeSchema,
    appliedRevisionId: analysisIdSchema.optional(),
  })
  .strict();

export const analysisInterventionSchema = z
  .object({
    schemaVersion: z.literal("sacs-analysis-intervention/1.0"),
    interventionId: analysisIdSchema,
    analysisId: analysisIdSchema,
    revisionId: analysisIdSchema,
    runId: analysisIdSchema,
    interruptId: analysisIdSchema,
    reason: z.enum([
      "AMBIGUITY",
      "PERMISSION",
      "HIGH_RISK",
      "BUDGET",
      "USER_REQUESTED",
    ]),
    status: z.enum(["OPEN", "RESOLVED", "EXPIRED", "CANCELLED"]),
    requestPayload: jsonObjectSchema,
    responsePayload: jsonObjectSchema.optional(),
    createdAt: analysisDateTimeSchema,
    resolvedAt: analysisDateTimeSchema.optional(),
  })
  .strict();

export const focusTargetSchema = z
  .object({
    focusId: analysisIdSchema,
    targetKind: z.enum([
      "WORLD_REFERENCE",
      "FINDING_FEATURE",
      "TOOL_INPUT",
      "TOOL_OUTPUT",
      "TASK_OBJECT",
      "USER_GEOMETRY",
    ]),
    referenceKey: jsonObjectSchema.optional(),
    findingId: analysisIdSchema.optional(),
    featureId: analysisIdSchema.optional(),
    analysisNodeId: analysisIdSchema.optional(),
    layerId: analysisIdSchema.optional(),
    semanticRole: z.enum([
      "SUBJECT",
      "ANCHOR",
      "TARGET",
      "QUERY_SCOPE",
      "CANDIDATE",
      "SELECTED_RESULT",
      "EXCLUDED",
      "WARNING",
    ]),
    displayName: z.string().max(512).optional(),
    currentness: z.enum(["CURRENT", "STALE", "UNKNOWN"]),
    validTime: z
      .object({
        start: analysisDateTimeSchema.optional(),
        end: analysisDateTimeSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const inlineGeoJsonAccessSchema = z
  .object({ kind: z.literal("INLINE_GEOJSON"), data: jsonObjectSchema })
  .strict();
const referenceSetAccessSchema = z
  .object({
    kind: z.literal("REFERENCE_SET"),
    referenceKeys: z.array(jsonObjectSchema).max(256),
  })
  .strict();
const payloadReferenceAccessSchema = z
  .object({
    kind: z.literal("PAYLOAD_REFERENCE"),
    payloadRef: z.string().min(1).max(1_024),
  })
  .strict();

export const mapLayerDescriptorSchema = z
  .object({
    schemaVersion: z.literal("sacs-map-layer/1.0"),
    layerId: analysisIdSchema,
    title: z.string().min(1).max(512),
    role: z.enum([
      "BASE_CONTEXT",
      "TASK_CONTEXT",
      "QUERY_INPUT",
      "TOOL_SCOPE",
      "INTERMEDIATE_RESULT",
      "FINAL_FINDING",
      "FOCUS",
      "GAP",
    ]),
    representation: z.enum([
      "INLINE_GEOJSON",
      "REFERENCE_SET",
      "PAYLOAD_REFERENCE",
    ]),
    sourceAuthority: z.enum([
      "USER",
      "SACS",
      "WSGS",
      "GOWM",
      "GDPS",
      "STAS",
      "SDAR",
    ]),
    access: z.discriminatedUnion("kind", [
      inlineGeoJsonAccessSchema,
      referenceSetAccessSchema,
      payloadReferenceAccessSchema,
    ]),
    visibleByDefault: z.boolean(),
    selectable: z.boolean(),
    editable: z.boolean(),
    analysisId: analysisIdSchema,
    revisionId: analysisIdSchema,
    nodeId: analysisIdSchema.optional(),
    findingIds: z.array(analysisIdSchema).max(ANALYSIS_MAX_NODES),
    loadStatus: z.enum(["PENDING", "LOADING", "READY", "ERROR"]),
    relevanceStatus: z.enum(["ACTIVE", "SUPERSEDED"]),
    currentness: z.enum(["CURRENT", "STALE", "UNKNOWN"]),
    styleToken: z.enum([
      "base.context",
      "task.context",
      "analysis.input",
      "analysis.scope",
      "analysis.intermediate",
      "finding.primary",
      "finding.candidate",
      "focus.execution",
      "focus.intervention",
      "focus.pinned",
      "gap.data",
      "gap.coverage",
      "gap.ambiguity",
      "source.stale",
    ]),
  })
  .strict()
  .superRefine((layer, context) => {
    if (layer.access.kind !== layer.representation) {
      context.addIssue({
        code: "custom",
        message: "Layer representation and access kind must match",
      });
    }
    if (layer.sourceAuthority !== "USER" && layer.editable) {
      context.addIssue({
        code: "custom",
        message: "Authoritative geometry is read-only",
      });
    }
  });

export const mapSharedStateSchema = z
  .object({
    schemaVersion: z.literal("io.sacs/map-scene/v1"),
    sceneRevision: z.number().int().min(0),
    layersById: z.record(analysisIdSchema, mapLayerDescriptorSchema),
    executionFocus: focusTargetSchema.optional(),
    interventionFocus: focusTargetSchema.optional(),
    pinnedFocusById: z.record(analysisIdSchema, focusTargetSchema),
  })
  .strict()
  .superRefine((state, context) => {
    if (Object.keys(state.layersById).length > ANALYSIS_MAX_MAP_LAYERS) {
      context.addIssue({ code: "custom", message: "Too many map layers" });
    }
    if (Object.keys(state.pinnedFocusById).length > ANALYSIS_MAX_PINNED_FOCUS) {
      context.addIssue({ code: "custom", message: "Too many pinned focuses" });
    }
    for (const [key, layer] of Object.entries(state.layersById)) {
      if (key !== layer.layerId) {
        context.addIssue({
          code: "custom",
          message: "Layer map key must equal layerId",
        });
      }
    }
  });

export const timelineProjectionSchema = z
  .object({
    schemaVersion: z.literal("sacs-shared-timeline/1.0"),
    analysisTimeWindow: z
      .object({
        start: analysisDateTimeSchema,
        end: analysisDateTimeSchema,
        authority: z.enum(["EVENT_TIME", "OBSERVED_TIME", "VALID_TIME"]),
      })
      .strict()
      .optional(),
    sources: z.record(
      z.string(),
      z
        .object({
          sourceKind: z.enum(["GOWM", "GDPS", "STAS", "SDAR"]),
          timeSemantics: z.string().min(1).max(128),
          displayRole: z
            .enum(["LIVE", "HISTORICAL", "CURRENT_BACKGROUND", "PLANNED"])
            .optional(),
          timeExtent: z
            .object({
              start: analysisDateTimeSchema.optional(),
              end: analysisDateTimeSchema.optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const agUiSharedStateV03Schema = z
  .object({
    schemaVersion: z.literal("io.sacs/agui-state/v0.3"),
    meta: z
      .object({
        stateRevision: z.number().int().min(0),
        snapshotHash: sha256Schema,
      })
      .strict(),
    conversation: jsonObjectSchema,
    analysis: z
      .object({
        session: analysisSessionSchema,
        activeRevisionId: analysisIdSchema,
        revisionsById: z.record(analysisIdSchema, analysisRevisionSchema),
        runsById: z.record(analysisIdSchema, analysisRunSchema),
        nodesById: z.record(analysisIdSchema, analysisNodeStateSchema),
      })
      .strict(),
    map: mapSharedStateSchema,
    timeline: timelineProjectionSchema,
    proposalsById: z.record(analysisIdSchema, analysisChangeProposalSchema),
    pendingIntervention: analysisInterventionSchema.optional(),
    worldExplanation: jsonObjectSchema.optional(),
  })
  .strict()
  .superRefine((state, context) => {
    const analysis = state.analysis;
    if (
      analysis.activeRevisionId !== analysis.session.activeRevisionId ||
      analysis.revisionsById[analysis.activeRevisionId] === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "active Revision identity mismatch",
      });
    }
    if (
      Object.keys(analysis.revisionsById).length > ANALYSIS_MAX_NODES ||
      Object.keys(analysis.runsById).length > ANALYSIS_MAX_NODES ||
      Object.keys(analysis.nodesById).length > ANALYSIS_MAX_NODES
    ) {
      context.addIssue({ code: "custom", message: "analysis state too large" });
    }
    for (const [key, revision] of Object.entries(analysis.revisionsById)) {
      if (
        key !== revision.revisionId ||
        revision.analysisId !== analysis.session.analysisId
      ) {
        context.addIssue({
          code: "custom",
          message: "Revision map identity mismatch",
        });
      }
    }
    for (const [key, run] of Object.entries(analysis.runsById)) {
      if (
        key !== run.runId ||
        analysis.revisionsById[run.revisionId] === undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "Run map identity mismatch",
        });
      }
    }
    for (const [key, node] of Object.entries(analysis.nodesById)) {
      if (key !== node.nodeId) {
        context.addIssue({
          code: "custom",
          message: "Node map identity mismatch",
        });
      }
    }
    for (const [key, proposal] of Object.entries(state.proposalsById)) {
      if (
        key !== proposal.proposalId ||
        proposal.analysisId !== analysis.session.analysisId
      ) {
        context.addIssue({
          code: "custom",
          message: "Proposal map identity mismatch",
        });
      }
    }
  });

export const toolInteractionDescriptorSchema = z
  .object({
    schemaVersion: z.literal("sacs-wsgs-tool-interaction/1.0"),
    toolCallId: analysisIdSchema,
    nodeId: analysisIdSchema,
    operationKey: z.string().min(1).max(256),
    executionArgsHash: sha256Schema,
    publicArgs: jsonObjectSchema,
    publicArgsHash: sha256Schema,
    publicEditSchemaUri: z.string().min(1).max(1_024),
    publicEditSchemaHash: sha256Schema,
    editablePaths: z
      .array(z.string().regex(/^\//u))
      .max(ANALYSIS_MAX_EDITABLE_PATHS),
    editorHints: z
      .array(
        z
          .object({
            path: z.string().regex(/^\//u),
            editor: z.enum([
              "MAP_POINT",
              "MAP_LINE",
              "MAP_POLYGON",
              "MAP_RADIUS",
              "NUMBER_RANGE",
              "TIME_RANGE",
              "ENUM_MULTISELECT",
              "AUTHORIZED_CANDIDATE_SELECT",
              "READ_ONLY",
            ]),
            unit: z.string().max(64).optional(),
            minimum: z.number().optional(),
            maximum: z.number().optional(),
            geometryTypes: z
              .array(z.enum(["Point", "LineString", "Polygon", "MultiPolygon"]))
              .max(4)
              .optional(),
            candidateSource: z.string().max(256).optional(),
          })
          .strict(),
      )
      .max(ANALYSIS_MAX_EDITABLE_PATHS),
    editSemantics: z.enum([
      "CHANGE_CONSTRAINT",
      "CREATE_GEOMETRY_OVERRIDE",
      "SELECT_AUTHORIZED_CANDIDATE",
      "NOT_EDITABLE",
    ]),
    editPolicy: z.enum([
      "SUGGEST_NEXT_REVISION",
      "CANCEL_AND_RESTART_ALLOWED",
      "NOT_EDITABLE",
    ]),
    expiresAt: analysisDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (!isAnalysisPublicArgsNonDisclosing(descriptor.publicArgs)) {
      context.addIssue({
        code: "custom",
        path: ["publicArgs"],
        message: ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
      });
      return;
    }
    if (
      hashCanonicalJson(descriptor.publicArgs) !== descriptor.publicArgsHash
    ) {
      context.addIssue({ code: "custom", message: "publicArgsHash mismatch" });
    }
    if (
      Buffer.byteLength(canonicalJson(descriptor.publicArgs), "utf8") >
      ANALYSIS_MAX_PUBLIC_ARGS_BYTES
    ) {
      context.addIssue({ code: "custom", message: "publicArgs too large" });
    }
  });

export type AnalysisSession = z.infer<typeof analysisSessionSchema>;
export type AnalysisRevision = z.infer<typeof analysisRevisionSchema>;
export type AnalysisRun = z.infer<typeof analysisRunSchema>;
export type AnalysisNodeState = z.infer<typeof analysisNodeStateSchema>;
export type AnalysisEvent = z.infer<typeof analysisEventSchema>;
export type AnalysisProjection = z.infer<typeof analysisProjectionSchema>;
export type AnalysisPatchOperation = z.infer<
  typeof analysisPatchOperationSchema
>;
export type AnalysisChangeProposal = z.infer<
  typeof analysisChangeProposalSchema
>;
export type AnalysisIntervention = z.infer<typeof analysisInterventionSchema>;
export type FocusTarget = z.infer<typeof focusTargetSchema>;
export type MapLayerDescriptor = z.infer<typeof mapLayerDescriptorSchema>;
export type MapSharedState = z.infer<typeof mapSharedStateSchema>;
export type TimelineProjection = z.infer<typeof timelineProjectionSchema>;
export type AgUiSharedStateV03 = z.infer<typeof agUiSharedStateV03Schema>;
export type ToolInteractionDescriptor = z.infer<
  typeof toolInteractionDescriptorSchema
>;

export function assertAnalysisPayloadHash(event: AnalysisEvent): void {
  if (hashCanonicalJson(event.payload) !== event.payloadHash) {
    throw new Error("ANALYSIS_EVENT_PAYLOAD_HASH_MISMATCH");
  }
}

export function calculateAgUiStateSnapshotHash(
  state: Readonly<Record<string, unknown>>,
  explicitStateRevision?: number,
): string {
  const meta = state["meta"];
  const stateRevision =
    explicitStateRevision ??
    (meta !== null && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Readonly<Record<string, unknown>>)["stateRevision"]
      : undefined);
  if (!Number.isSafeInteger(stateRevision) || (stateRevision as number) < 0) {
    throw new Error("AG_UI_STATE_SNAPSHOT_REVISION_INVALID");
  }
  const { meta: ignoredMeta, ...body } = state;
  void ignoredMeta;
  return hashCanonicalJson({
    ...body,
    meta: { stateRevision: stateRevision as number },
  });
}

export function parseAndVerifyAgUiSharedStateV03(
  value: unknown,
): AgUiSharedStateV03 {
  const state = agUiSharedStateV03Schema.parse(value);
  if (calculateAgUiStateSnapshotHash(state) !== state.meta.snapshotHash) {
    throw new Error("AG_UI_STATE_SNAPSHOT_HASH_MISMATCH");
  }
  return state;
}
