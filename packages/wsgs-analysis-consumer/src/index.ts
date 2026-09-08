import { createHash } from "node:crypto";

import { z } from "zod";

import generatedHandoffStatus from "../../../dependencies/wsgs-analysis-handoff-status.json" with { type: "json" };

export const WSGS_ANALYSIS_PROFILE =
  "sacs-wsgs-analysis-presentation/1.0" as const;
export const WSGS_ANALYSIS_HANDOFF_NOT_READY =
  "SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY" as const;
export const WSGS_ANALYSIS_CONSUMER_READY =
  "SACS_WSGS_ANALYSIS_CONSUMER_READY" as const;

export const WSGS_ANALYSIS_ARTIFACT_NAMES = [
  "WSGS_ANALYSIS_CONSUMER_LOCK.json",
  "WSGS_ANALYSIS_PLAN_SCHEMA_LOCK.json",
  "WSGS_ANALYSIS_EVENT_SCHEMA_LOCK.json",
  "WSGS_TOOL_INTERACTION_SCHEMA_LOCK.json",
  "WSGS_REVISION_CONTROL_SCHEMA_LOCK.json",
  "WSGS_CANCEL_SCHEMA_LOCK.json",
  "WSGS_INTERVENTION_SCHEMA_LOCK.json",
  "CHECKSUMS.json",
] as const;

const WSGS_ANALYSIS_CHECKED_ARTIFACT_NAMES =
  WSGS_ANALYSIS_ARTIFACT_NAMES.filter((name) => name !== "CHECKSUMS.json");

export type WsgsAnalysisArtifactName =
  (typeof WSGS_ANALYSIS_ARTIFACT_NAMES)[number];
export type WsgsAnalysisBundleBytes = Readonly<Record<string, Uint8Array>>;

const sha256Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const gitSha = z.string().regex(/^[0-9a-f]{40}$/u);
const boundedSemantics = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim(), "semantics must be trimmed");
const relativeRoute = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^\/(?!\/)[A-Za-z0-9._{}:/-]+$/u)
  .refine(
    (value) => !value.split("/").includes(".."),
    "route must not traverse directories",
  );

const handoffStatusSchema = z
  .strictObject({
    schemaVersion: z.literal("sacs-wsgs-analysis-handoff-status/1.0"),
    profile: z.literal(WSGS_ANALYSIS_PROFILE),
    provenance: z.literal("TASK_PACKAGE_PROVISIONAL"),
    status: z.literal("BLOCKED"),
    marker: z.literal(WSGS_ANALYSIS_HANDOFF_NOT_READY),
    blocker: z.strictObject({
      code: z.literal("AUTHORITATIVE_WSGS_ANALYSIS_HANDOFF_MISSING"),
      safeDetail: z.string().min(1).max(2_000),
    }),
    requiredArtifacts: z.array(z.string()).length(8),
    observedAuthoritativeArtifacts: z.array(z.never()).length(0),
  })
  .superRefine((value, context) => {
    if (!sameStringSet(value.requiredArtifacts, WSGS_ANALYSIS_ARTIFACT_NAMES)) {
      context.addIssue({
        code: "custom",
        path: ["requiredArtifacts"],
        message: "required artifact inventory differs from the frozen intake",
      });
    }
  });

export type WsgsAnalysisHandoffStatus = z.infer<typeof handoffStatusSchema>;
export const defaultWsgsAnalysisHandoffStatus = handoffStatusSchema.parse(
  generatedHandoffStatus,
);

const checksumEntrySchema = z.strictObject({
  path: z.enum(WSGS_ANALYSIS_CHECKED_ARTIFACT_NAMES),
  sha256: sha256Digest,
});

const checksumsSchema = z
  .strictObject({
    schemaVersion: z.literal("wsgs-analysis-handoff-checksums/1.0"),
    algorithm: z.literal("SHA-256"),
    files: z
      .array(checksumEntrySchema)
      .length(WSGS_ANALYSIS_CHECKED_ARTIFACT_NAMES.length),
    bundleHash: sha256Digest,
  })
  .superRefine((value, context) => {
    const paths = value.files.map((entry) => entry.path);
    if (!sameStringSet(paths, WSGS_ANALYSIS_CHECKED_ARTIFACT_NAMES)) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message:
          "checksum inventory must cover each non-checksum artifact once",
      });
    }
  });

const endpointSchema = z.strictObject({
  snapshot: relativeRoute,
  events: relativeRoute.optional(),
  compileRevision: relativeRoute,
  cancel: relativeRoute,
  resolveIntervention: relativeRoute,
});

export const wsgsAnalysisConsumerLockSchema = z
  .strictObject({
    schemaVersion: z.literal("sacs-wsgs-analysis-consumer-lock/1.0"),
    profile: z.literal(WSGS_ANALYSIS_PROFILE),
    provenance: z.literal("AUTHORITATIVE_WSGS_HANDOFF"),
    wsgsSha: gitSha,
    transportMode: z.enum(["STREAMING_EVENTS", "POLLING_SNAPSHOT"]),
    planSchemaHash: sha256Digest,
    eventSchemaHash: sha256Digest,
    toolInteractionSchemaHash: sha256Digest,
    revisionControlSchemaHash: sha256Digest,
    cancelSchemaHash: sha256Digest,
    interventionSchemaHash: sha256Digest,
    endpoints: endpointSchema,
    sequenceSemantics: boundedSemantics,
    idempotencySemantics: boundedSemantics,
    recoverySemantics: boundedSemantics,
    status: z.literal("READY"),
  })
  .superRefine((value, context) => {
    if (
      value.transportMode === "STREAMING_EVENTS" &&
      value.endpoints.events === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["endpoints", "events"],
        message: "STREAMING_EVENTS requires an events route",
      });
    }
    if (
      value.transportMode === "POLLING_SNAPSHOT" &&
      value.endpoints.events !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["endpoints", "events"],
        message: "POLLING_SNAPSHOT must not advertise an events route",
      });
    }
    const routes = Object.values(value.endpoints).filter(
      (route): route is string => route !== undefined,
    );
    if (new Set(routes).size !== routes.length) {
      context.addIssue({
        code: "custom",
        path: ["endpoints"],
        message: "analysis routes must be distinct",
      });
    }
  });

export type WsgsAnalysisConsumerLock = z.infer<
  typeof wsgsAnalysisConsumerLockSchema
>;

const authoritySchema = z.strictObject({
  source: z.literal("AUTHORITATIVE_WSGS_HANDOFF"),
  expectedWsgsSha: gitSha,
});

export type WsgsAnalysisHandoffAuthority = z.infer<typeof authoritySchema>;

const schemaArtifactToLockHash = {
  "WSGS_ANALYSIS_PLAN_SCHEMA_LOCK.json": "planSchemaHash",
  "WSGS_ANALYSIS_EVENT_SCHEMA_LOCK.json": "eventSchemaHash",
  "WSGS_TOOL_INTERACTION_SCHEMA_LOCK.json": "toolInteractionSchemaHash",
  "WSGS_REVISION_CONTROL_SCHEMA_LOCK.json": "revisionControlSchemaHash",
  "WSGS_CANCEL_SCHEMA_LOCK.json": "cancelSchemaHash",
  "WSGS_INTERVENTION_SCHEMA_LOCK.json": "interventionSchemaHash",
} as const satisfies Record<string, keyof WsgsAnalysisConsumerLock>;

export interface AuthorizedWsgsAnalysisConsumer {
  readonly status: "READY";
  readonly marker: typeof WSGS_ANALYSIS_CONSUMER_READY;
  readonly profile: typeof WSGS_ANALYSIS_PROFILE;
  readonly lock: WsgsAnalysisConsumerLock;
  readonly checksumFileHash: string;
  readonly bundleHash: string;
  readonly schemaDocuments: Readonly<Record<string, Readonly<object>>>;
}

export interface BlockedWsgsAnalysisConsumer {
  readonly status: "BLOCKED";
  readonly marker: typeof WSGS_ANALYSIS_HANDOFF_NOT_READY;
  readonly reasonCode: string;
}

export type WsgsAnalysisHandoffDecision =
  AuthorizedWsgsAnalysisConsumer | BlockedWsgsAnalysisConsumer;

export class WsgsAnalysisConsumerError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function calculateSha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function calculateCanonicalJsonHash(value: unknown): string {
  return calculateSha256(
    Buffer.from(JSON.stringify(canonicalize(value)), "utf8"),
  );
}

export function verifyAuthoritativeWsgsAnalysisBundle(
  files: WsgsAnalysisBundleBytes,
  authorityValue: unknown,
): AuthorizedWsgsAnalysisConsumer {
  let authority: WsgsAnalysisHandoffAuthority;
  try {
    authority = authoritySchema.parse(authorityValue);
  } catch {
    throw new WsgsAnalysisConsumerError(
      "AUTHORITATIVE_WSGS_ANALYSIS_HANDOFF_REQUIRED",
    );
  }

  assertExactBundleInventory(files);
  const checksums = parseArtifactJson(
    "CHECKSUMS.json",
    files["CHECKSUMS.json"],
    checksumsSchema,
    "WSGS_ANALYSIS_CHECKSUMS_INVALID",
  );

  const checkedHashes: Record<string, string> = {};
  for (const name of WSGS_ANALYSIS_CHECKED_ARTIFACT_NAMES) {
    const actualHash = calculateSha256(files[name]);
    const declaredHash = checksums.files.find(
      (entry) => entry.path === name,
    )?.sha256;
    if (declaredHash !== actualHash) {
      throw new WsgsAnalysisConsumerError(
        `WSGS_ANALYSIS_CHECKSUM_DRIFT:${name}`,
      );
    }
    checkedHashes[name] = actualHash;
  }
  if (calculateCanonicalJsonHash(checkedHashes) !== checksums.bundleHash) {
    throw new WsgsAnalysisConsumerError(
      "WSGS_ANALYSIS_CHECKSUM_BUNDLE_HASH_DRIFT",
    );
  }

  const lock = parseArtifactJson(
    "WSGS_ANALYSIS_CONSUMER_LOCK.json",
    files["WSGS_ANALYSIS_CONSUMER_LOCK.json"],
    wsgsAnalysisConsumerLockSchema,
    "WSGS_ANALYSIS_CONSUMER_LOCK_INVALID",
  );
  if (lock.wsgsSha !== authority.expectedWsgsSha) {
    throw new WsgsAnalysisConsumerError("WSGS_ANALYSIS_SHA_MISMATCH");
  }

  const schemaDocuments: Record<string, Readonly<object>> = {};
  for (const [name, lockField] of Object.entries(schemaArtifactToLockHash)) {
    const bytes = files[name];
    if (calculateSha256(bytes) !== lock[lockField]) {
      throw new WsgsAnalysisConsumerError(
        `WSGS_ANALYSIS_SCHEMA_HASH_MISMATCH:${name}`,
      );
    }
    schemaDocuments[name] = parseJsonObject(
      name,
      bytes,
      "WSGS_ANALYSIS_SCHEMA_LOCK_INVALID",
    );
  }

  return {
    status: "READY",
    marker: WSGS_ANALYSIS_CONSUMER_READY,
    profile: WSGS_ANALYSIS_PROFILE,
    lock,
    checksumFileHash: calculateSha256(files["CHECKSUMS.json"]),
    bundleHash: checksums.bundleHash,
    schemaDocuments,
  };
}

export function evaluateWsgsAnalysisHandoff(
  files: WsgsAnalysisBundleBytes | undefined,
  authorityValue: unknown,
): WsgsAnalysisHandoffDecision {
  if (files === undefined || authorityValue === undefined) {
    return blockedDecision("AUTHORITATIVE_WSGS_ANALYSIS_HANDOFF_MISSING");
  }
  try {
    return verifyAuthoritativeWsgsAnalysisBundle(files, authorityValue);
  } catch (error) {
    return blockedDecision(
      error instanceof WsgsAnalysisConsumerError
        ? error.code
        : "WSGS_ANALYSIS_HANDOFF_INVALID",
    );
  }
}

export const WSGS_ANALYSIS_EVENT_TYPES = [
  "PLAN_PUBLISHED",
  "NODE_READY",
  "NODE_STARTED",
  "NODE_PROGRESS",
  "TOOL_INTERACTION_PUBLISHED",
  "TOOL_COMPLETED",
  "TOOL_FAILED",
  "MAP_ARTIFACT_AVAILABLE",
  "FINDING_AVAILABLE",
  "INTERVENTION_REQUIRED",
  "ANALYSIS_COMPLETED",
] as const;

const eventIdentifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

const eventEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal("sacs-wsgs-analysis-event/1.0"),
  eventId: eventIdentifier,
  upstreamAnalysisId: eventIdentifier,
  planId: eventIdentifier,
  planHash: sha256Digest,
  planRevision: z.number().int().nonnegative(),
  sequence: z.number().int().positive(),
  eventType: z.enum(WSGS_ANALYSIS_EVENT_TYPES),
  nodeId: eventIdentifier.optional(),
  correlationId: eventIdentifier,
  causationId: eventIdentifier.optional(),
  occurredAt: z.iso.datetime(),
  payload: z.record(z.string(), z.unknown()),
  payloadHash: sha256Digest,
});

export type WsgsAnalysisEventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export function parseWsgsAnalysisEventEnvelope(
  value: unknown,
): WsgsAnalysisEventEnvelope {
  if (
    isJsonObject(value) &&
    typeof value["eventType"] === "string" &&
    !WSGS_ANALYSIS_EVENT_TYPES.includes(
      value["eventType"] as (typeof WSGS_ANALYSIS_EVENT_TYPES)[number],
    )
  ) {
    throw new WsgsAnalysisConsumerError("WSGS_ANALYSIS_UNKNOWN_EVENT_TYPE");
  }
  try {
    return eventEnvelopeSchema.parse(value);
  } catch {
    throw new WsgsAnalysisConsumerError("WSGS_ANALYSIS_EVENT_INVALID");
  }
}

export interface WsgsAnalysisActivePlanIdentity {
  readonly upstreamAnalysisId: string;
  readonly planId: string;
  readonly planHash: string;
  readonly planRevision: number;
}

export interface WsgsAnalysisEventDecision {
  readonly disposition:
    | "APPLY_TO_ACTIVE_PLAN"
    | "AUDIT_ONLY_INACTIVE_PLAN"
    | "IDEMPOTENT_DUPLICATE";
  readonly event: WsgsAnalysisEventEnvelope;
}

export class WsgsAnalysisEventIntegrityGuard {
  private readonly eventFingerprints = new Map<string, string>();
  private readonly sequenceFingerprints = new Map<number, string>();
  private lastObservedSequence = 0;

  constructor(private readonly activePlan: WsgsAnalysisActivePlanIdentity) {}

  prepare(value: unknown): WsgsAnalysisEventDecision {
    const event = parseWsgsAnalysisEventEnvelope(value);
    if (calculateCanonicalJsonHash(event.payload) !== event.payloadHash) {
      throw new WsgsAnalysisConsumerError(
        "WSGS_ANALYSIS_EVENT_PAYLOAD_HASH_MISMATCH",
      );
    }
    if (event.upstreamAnalysisId !== this.activePlan.upstreamAnalysisId) {
      throw new WsgsAnalysisConsumerError(
        "WSGS_ANALYSIS_EVENT_ANALYSIS_ID_MISMATCH",
      );
    }

    const fingerprint = calculateCanonicalJsonHash(event);
    const knownEvent = this.eventFingerprints.get(event.eventId);
    if (knownEvent !== undefined) {
      if (knownEvent === fingerprint) {
        return { disposition: "IDEMPOTENT_DUPLICATE", event };
      }
      throw new WsgsAnalysisConsumerError("WSGS_ANALYSIS_EVENT_ID_COLLISION");
    }
    const knownSequence = this.sequenceFingerprints.get(event.sequence);
    if (knownSequence !== undefined) {
      throw new WsgsAnalysisConsumerError(
        "WSGS_ANALYSIS_EVENT_SEQUENCE_COLLISION",
      );
    }
    if (event.sequence <= this.lastObservedSequence) {
      throw new WsgsAnalysisConsumerError(
        "WSGS_ANALYSIS_EVENT_SEQUENCE_OUT_OF_ORDER",
      );
    }

    const active =
      event.planId === this.activePlan.planId &&
      event.planHash === this.activePlan.planHash &&
      event.planRevision === this.activePlan.planRevision;
    return {
      disposition: active ? "APPLY_TO_ACTIVE_PLAN" : "AUDIT_ONLY_INACTIVE_PLAN",
      event,
    };
  }

  accept(decision: WsgsAnalysisEventDecision): void {
    if (decision.disposition === "IDEMPOTENT_DUPLICATE") return;
    const prepared = this.prepare(decision.event);
    if (prepared.disposition !== decision.disposition) {
      throw new WsgsAnalysisConsumerError(
        "WSGS_ANALYSIS_EVENT_DISPOSITION_MISMATCH",
      );
    }
    const fingerprint = calculateCanonicalJsonHash(decision.event);
    this.eventFingerprints.set(decision.event.eventId, fingerprint);
    this.sequenceFingerprints.set(decision.event.sequence, fingerprint);
    this.lastObservedSequence = decision.event.sequence;
  }

  inspect(value: unknown): WsgsAnalysisEventDecision {
    const decision = this.prepare(value);
    this.accept(decision);
    return decision;
  }

  get lastSequence(): number {
    return this.lastObservedSequence;
  }
}

export interface WsgsAnalysisPresentationPort<TSnapshot = unknown> {
  getAnalysisSnapshot(groundingId: string): Promise<TSnapshot>;
  subscribeAnalysisEvents(
    groundingId: string,
    afterSequence?: number,
  ): AsyncIterable<WsgsAnalysisEventEnvelope>;
}

export interface WsgsAnalysisControlPort<
  TCompileRequest = unknown,
  TCompileResult = unknown,
  TCancelRequest = unknown,
  TCancelResult = unknown,
  TInterventionRequest = unknown,
  TInterventionResult = unknown,
> {
  compileRevision(request: TCompileRequest): Promise<TCompileResult>;
  cancelRun(request: TCancelRequest): Promise<TCancelResult>;
  resolveIntervention(
    request: TInterventionRequest,
  ): Promise<TInterventionResult>;
}

function assertExactBundleInventory(files: WsgsAnalysisBundleBytes): void {
  const names = Object.keys(files);
  if (!sameStringSet(names, WSGS_ANALYSIS_ARTIFACT_NAMES)) {
    throw new WsgsAnalysisConsumerError(
      "WSGS_ANALYSIS_HANDOFF_EXACT_INVENTORY_INVALID",
    );
  }
  for (const name of names) {
    if (!(files[name] instanceof Uint8Array)) {
      throw new WsgsAnalysisConsumerError(
        `WSGS_ANALYSIS_HANDOFF_BYTES_INVALID:${name}`,
      );
    }
  }
}

function parseArtifactJson<T extends z.ZodType>(
  name: string,
  bytes: Uint8Array,
  schema: T,
  code: string,
): z.infer<T> {
  const value = parseJson(name, bytes, code);
  try {
    return schema.parse(value) as z.infer<T>;
  } catch {
    throw new WsgsAnalysisConsumerError(code);
  }
}

function parseJsonObject(
  name: string,
  bytes: Uint8Array,
  code: string,
): Readonly<object> {
  const value = parseJson(name, bytes, code);
  if (!isJsonObject(value))
    throw new WsgsAnalysisConsumerError(`${code}:${name}`);
  return value;
}

function parseJson(name: string, bytes: Uint8Array, code: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new WsgsAnalysisConsumerError(`${code}:${name}`);
  }
}

function blockedDecision(reasonCode: string): BlockedWsgsAnalysisConsumer {
  return {
    status: "BLOCKED",
    marker: WSGS_ANALYSIS_HANDOFF_NOT_READY,
    reasonCode,
  };
}

function sameStringSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((value) => expected.includes(value))
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
