import { z } from "zod";
import {
  hashCanonicalJson,
  sha256Schema,
} from "../../world-explanation-contract/src/index.js";
import type {
  WsgsGroundingRequest,
  WsgsGroundingResult,
} from "../../wsgs-http-adapter/src/index.js";

const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const common = { sourceId: id, sourceHash: sha256Schema };
export const groundingContractIdentitySchema = z.discriminatedUnion(
  "contractVersion",
  [
    z.strictObject({
      contractVersion: z.literal("sacs-wsgs-grounding/1.1"),
      resultProfile: z.literal("sacs-wsgs-geospatial-findings/1.0"),
    }),
    z.strictObject({
      contractVersion: z.literal("sacs-wsgs-grounding/1.2"),
      resultProfile: z.literal("wsgs-world-analysis-findings/1.0"),
    }),
  ],
);
export type GroundingContractIdentity = z.infer<
  typeof groundingContractIdentitySchema
>;
export function parseGroundingContractIdentity(
  value: unknown,
): GroundingContractIdentity {
  const result = groundingContractIdentitySchema.safeParse(value);
  if (!result.success)
    throw new AnalysisSourceError("ANALYSIS_SOURCE_CONTRACT_IDENTITY_INVALID");
  return result.data;
}
export const analysisSourceModes = [
  "WSGS_GROUNDING_JOB",
  "WSGS_NATIVE_ANALYSIS",
  "FIXTURE",
  "LEGACY_PLAN",
] as const;
export const analysisSourceIdentitySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...common,
    kind: z.literal("WSGS_GROUNDING_JOB"),
    upstreamRunId: id.optional(),
    contractIdentity: groundingContractIdentitySchema.optional(),
    requestId: id.optional(),
    messageId: id.optional(),
    originalTextSha256: sha256Schema.optional(),
    maxResultBytes: z.number().int().min(1024).max(67108864).optional(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("WSGS_NATIVE_ANALYSIS"),
    sourceRevision: z.number().int().nonnegative(),
    upstreamRunId: id.optional(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("FIXTURE"),
    sourceRevision: z.number().int().nonnegative().optional(),
    upstreamRunId: id.optional(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("LEGACY_PLAN"),
    sourceRevision: z.number().int().nonnegative().optional(),
    readOnly: z.literal(true),
  }),
]);
export type AnalysisSourceIdentity = z.infer<
  typeof analysisSourceIdentitySchema
>;
export type WritableAnalysisSourceIdentity = Exclude<
  AnalysisSourceIdentity,
  { kind: "LEGACY_PLAN" }
>;
export type AnalysisSourceMode = AnalysisSourceIdentity["kind"];
export const analysisSourceStatuses = [
  "ACCEPTED",
  "RUNNING",
  "COMPLETED",
  "PARTIAL",
  "AMBIGUOUS",
  "UNRESOLVED",
  "FAILED",
  "CANCELLED",
] as const;
export type AnalysisSourceStatus = (typeof analysisSourceStatuses)[number];
export interface AnalysisSourceSnapshot {
  identity: WritableAnalysisSourceIdentity;
  sourceStatus: AnalysisSourceStatus;
  resultHash?: string;
  result?: WsgsGroundingResult;
  observedAt: string;
  terminal: boolean;
  observationReasonCode?: "WSGS_CANCEL_OBSERVATION_UNCONFIRMED";
}
export interface AnalysisSourceEvent extends AnalysisSourceSnapshot {
  eventId: string;
  analysisId: string;
  revisionId: string;
  runId: string;
  sourceSequence?: number;
}
export interface StartWorldAnalysisRequest {
  analysisId: string;
  revisionId: string;
  principalId: string;
  threadId: string;
  requestId: string;
  canonicalGroundingRequest: WsgsGroundingRequest;
  requestHash: string;
  idempotencyKey: string;
  signal?: AbortSignal;
  contractIdentity?: GroundingContractIdentity;
}
export interface AnalysisSourceAdapter {
  readonly mode: WritableAnalysisSourceIdentity["kind"];
  readonly productionEligible: boolean;
  start(request: StartWorldAnalysisRequest): Promise<AnalysisSourceSnapshot>;
  get(
    identity: AnalysisSourceIdentity,
    signal?: AbortSignal,
  ): Promise<AnalysisSourceSnapshot>;
  observe(input: {
    analysisId: string;
    revisionId: string;
    runId: string;
    identity: AnalysisSourceIdentity;
    after?: string;
    signal?: AbortSignal;
  }): AsyncIterable<AnalysisSourceEvent>;
  cancel(input: {
    identity: AnalysisSourceIdentity;
    commandId: string;
    idempotencyKey: string;
    reason: "USER_REQUESTED" | "REVISION_RESTART";
    signal?: AbortSignal;
  }): Promise<AnalysisSourceSnapshot>;
  revise(request: StartWorldAnalysisRequest): Promise<AnalysisSourceSnapshot>;
  resolveChoice(
    request: StartWorldAnalysisRequest,
  ): Promise<AnalysisSourceSnapshot>;
}
export class AnalysisSourceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function parseWritableAnalysisSource(
  value: unknown,
): WritableAnalysisSourceIdentity {
  const parsed = analysisSourceIdentitySchema.safeParse(value);
  if (!parsed.success)
    throw new AnalysisSourceError("ANALYSIS_SOURCE_IDENTITY_INVALID");
  if (parsed.data.kind === "LEGACY_PLAN")
    throw new AnalysisSourceError("ANALYSIS_SOURCE_LEGACY_WRITE_FORBIDDEN");
  return parsed.data;
}
export function verifySourceRequest(request: StartWorldAnalysisRequest): void {
  if (
    hashCanonicalJson(request.canonicalGroundingRequest) !==
      request.requestHash ||
    request.requestId !== request.canonicalGroundingRequest.requestId
  )
    throw new AnalysisSourceError("ANALYSIS_SOURCE_REQUEST_HASH_MISMATCH");
}
export const sourceStatusMapping = {
  ACCEPTED: { run: "STARTING", session: "ACTIVE", view: "RUNNING" },
  RUNNING: { run: "RUNNING", session: "ACTIVE", view: "RUNNING" },
  COMPLETED: { run: "SUCCEEDED", session: "COMPLETED", view: "COMPLETED" },
  PARTIAL: { run: "PARTIAL", session: "COMPLETED", view: "PARTIAL" },
  AMBIGUOUS: {
    run: "WAITING_INTERVENTION",
    session: "ACTIVE",
    view: "WAITING_SELECTION",
  },
  UNRESOLVED: { run: "PARTIAL", session: "COMPLETED", view: "UNRESOLVED" },
  FAILED: { run: "FAILED", session: "COMPLETED", view: "FAILED" },
  CANCELLED: { run: "CANCELLED", session: "CANCELLED", view: "CANCELLED" },
} as const;
export function sourceIsTerminal(status: AnalysisSourceStatus): boolean {
  return status !== "ACCEPTED" && status !== "RUNNING";
}
