import { createHash } from "node:crypto";

import { z } from "zod";

import generatedConsumerLock from "../../../dependencies/wsgs-geospatial-consumer-lock.json" with { type: "json" };

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const productName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/u);
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const gitSha = z.string().regex(/^[0-9a-f]{40}$/u);
const dateTime = z.iso.datetime();
const jsonObject = z.record(z.string().min(1).max(256), z.json());

const referenceKeySchema = z.strictObject({
  namespace: z.literal("gowm"),
  kind: z.string().min(1).max(64),
  id: z.string().regex(/^wrf_[0-9a-f]{32}$/u),
  version: z.string().min(1).max(128),
});

const findingBase = {
  findingId: identifier,
  semanticConcept: z.string().min(1).max(128),
  querySemantics: z.string().min(1).max(128),
  status: z.enum(["COMPLETED", "PARTIAL", "NO_DATA", "INDETERMINATE"]),
  subjectReferenceProductIds: z.array(identifier).max(32).optional(),
  evidenceItemIds: z.array(identifier).min(1).max(256),
  sourceProductIds: z.array(identifier).max(64),
  confidence: z.number().min(0).max(1).optional(),
  unknowns: z.array(z.string().max(2_048)).max(64).optional(),
  warnings: z.array(z.string().max(2_048)).max(64).optional(),
} as const;

const geospatialFeatureSchema = z
  .strictObject({
    featureId: identifier,
    displayName: z.string().max(512).optional(),
    referenceKey: referenceKeySchema.optional(),
    geometry: jsonObject.optional(),
    payloadRef: z.string().max(1_024).optional(),
    classCode: z.string().max(128).optional(),
    classLabel: z.string().max(256).optional(),
    areaM2: z.number().nonnegative().optional(),
    lengthM: z.number().nonnegative().optional(),
    distanceM: z.number().nonnegative().optional(),
    confidence: z.number().min(0).max(1).optional(),
    publishedAttributes: jsonObject.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.referenceKey === undefined &&
      value.geometry === undefined &&
      value.payloadRef === undefined &&
      value.classCode === undefined &&
      value.publishedAttributes === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "feature requires an upstream-published identity or payload",
      });
    }
  });

export const worldFindingSchema = z.discriminatedUnion("findingKind", [
  z.strictObject({
    ...findingBase,
    findingKind: z.literal("POINT_MEASUREMENT"),
    point: jsonObject,
    value: z.number(),
    unit: z.string().min(1).max(64),
  }),
  z.strictObject({
    ...findingBase,
    findingKind: z.literal("POINT_CLASSIFICATION"),
    point: jsonObject,
    classCode: z.string().min(1).max(128),
    classLabel: z.string().max(256).optional(),
  }),
  z.strictObject({
    ...findingBase,
    findingKind: z.literal("SPATIAL_FEATURE_COLLECTION"),
    returnedCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    features: z.array(geospatialFeatureSchema).max(1_000),
  }),
  z.strictObject({
    ...findingBase,
    findingKind: z.literal("PROFILE"),
    unit: z.string().min(1).max(64),
    samples: z
      .array(
        z.strictObject({
          distanceM: z.number().nonnegative(),
          value: z.number(),
          point: jsonObject.optional(),
        }),
      )
      .max(10_000),
    truncated: z.boolean(),
  }),
  z.strictObject({
    ...findingBase,
    findingKind: z.literal("QUALIFIED_EXPLANATION"),
    explanationCode: z.string().min(1).max(128),
    summary: z.string().min(1).max(4_000),
    reasonCodes: z.array(z.string().max(128)).max(32),
    publishedFacts: jsonObject.optional(),
  }),
  z.strictObject({
    ...findingBase,
    findingKind: z.literal("CATALOG"),
    returnedCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    items: z.array(jsonObject).max(256),
  }),
]);

export const geospatialSourceProductSchema = z.strictObject({
  sourceProductId: identifier,
  authority: z.literal("GDPS_CURRENT_PRODUCT"),
  productId: identifier,
  productType: z.string().min(1).max(128),
  productProfile: z.string().min(1).max(128),
  contentHash: sha256,
  descriptorId: z.string().min(1).max(256),
  descriptorHash: sha256,
  dataTime: dateTime.optional(),
  qualitySummary: jsonObject.optional(),
  evidenceItemIds: z.array(identifier).min(1).max(128),
});

export const geospatialGapSchema = z.strictObject({
  gapId: identifier,
  gapKind: z.enum([
    "DATA_GAP",
    "COVERAGE_GAP",
    "CAPABILITY_GAP",
    "REFERENCE_AMBIGUITY",
    "PRODUCT_SELECTION_AMBIGUITY",
    "SOURCE_CHANGED",
    "TRUNCATED",
    "UNSUPPORTED_FINDING_SCHEMA",
    "EVIDENCE_INCOMPLETE",
    "UPSTREAM_FAILURE",
    "CURRENTNESS_UNAVAILABLE",
  ]),
  severity: z.enum(["INFO", "WARNING", "BLOCKING"]),
  messageCode: z.string().min(1).max(128),
  semanticConcept: z.string().max(128).optional(),
  findingIds: z.array(identifier).max(64).optional(),
  evidenceItemIds: z.array(identifier).max(128).optional(),
  safeDetail: z.string().max(2_000).optional(),
});

export const wsgsGeospatialFindingsSchema = z.strictObject({
  profile: z.literal("sacs-wsgs-geospatial-findings/1.0"),
  profileSchemaHash: sha256,
  findings: z.array(worldFindingSchema).max(1_000),
  sourceProducts: z.array(geospatialSourceProductSchema).max(64),
  gaps: z.array(geospatialGapSchema).max(128),
  findingSetHash: sha256,
  sourceProductSetHash: sha256,
});

export type WsgsGeospatialFindings = z.infer<
  typeof wsgsGeospatialFindingsSchema
>;

export function parseWsgsGeospatialFindings(
  value: unknown,
): WsgsGeospatialFindings {
  return wsgsGeospatialFindingsSchema.parse(value);
}

export const wsgsGeospatialConsumerLockSchema = z
  .strictObject({
    schemaVersion: z.literal("sacs-wsgs-geospatial-consumer-lock/1.0"),
    provenance: z.enum([
      "AUTHORITATIVE_WSGS_HANDOFF",
      "TASK_PACKAGE_PROVISIONAL",
    ]),
    blocker: z
      .strictObject({
        code: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Z][A-Z0-9_]*$/u),
        safeDetail: z.string().min(1).max(2_000),
      })
      .optional(),
    sources: z.strictObject({
      wsgsSha: gitSha,
      gowmSha: gitSha,
      gdpsSha: gitSha,
    }),
    groundingContract: z.strictObject({
      contractVersion: z.string().min(1).max(128),
      resultSchemaHash: sha256,
      capabilitiesSchemaHash: sha256,
    }),
    geospatialProfile: z.strictObject({
      profile: z.literal("sacs-wsgs-geospatial-findings/1.0"),
      transportMode: z.enum([
        "REQUESTED_PRODUCTS",
        "RESULT_EXTENSION",
        "UNRESOLVED",
      ]),
      profileSchemaHash: sha256,
      findingSchemaHash: sha256,
      sourceProductSchemaHash: sha256,
      gapSchemaHash: sha256,
      requestedProducts: z
        .array(productName)
        .max(8)
        .refine((value) => new Set(value).size === value.length),
    }),
    currentness: z.strictObject({
      mode: z.enum([
        "DEDICATED_OPERATION",
        "EXECUTE_WORLD_QUERY_PROFILE",
        "UNSUPPORTED",
      ]),
      operation: z.string().min(1).max(128).optional(),
      profile: z.string().min(1).max(128).optional(),
    }),
    status: z.enum(["READY", "BLOCKED"]),
    consumerLockHash: sha256,
  })
  .superRefine((value, context) => {
    if (
      value.provenance === "TASK_PACKAGE_PROVISIONAL" &&
      value.status !== "BLOCKED"
    ) {
      addLockIssue(context, ["status"], "provisional intake cannot be READY");
    }
    if (value.status === "READY") {
      if (value.provenance !== "AUTHORITATIVE_WSGS_HANDOFF") {
        addLockIssue(
          context,
          ["provenance"],
          "READY requires an authoritative WSGS handoff",
        );
      }
      if (value.blocker !== undefined) {
        addLockIssue(context, ["blocker"], "READY cannot retain a blocker");
      }
      if (value.geospatialProfile.transportMode === "UNRESOLVED") {
        addLockIssue(
          context,
          ["geospatialProfile", "transportMode"],
          "READY requires a resolved transport mode",
        );
      }
    } else {
      if (value.blocker === undefined) {
        addLockIssue(context, ["blocker"], "BLOCKED requires a blocker");
      }
      if (
        value.geospatialProfile.transportMode !== "UNRESOLVED" ||
        value.geospatialProfile.requestedProducts.length !== 0
      ) {
        addLockIssue(
          context,
          ["geospatialProfile"],
          "BLOCKED cannot select transport or request products",
        );
      }
      if (value.currentness.mode !== "UNSUPPORTED") {
        addLockIssue(
          context,
          ["currentness", "mode"],
          "BLOCKED cannot select a currentness operation",
        );
      }
    }
    if (
      value.geospatialProfile.transportMode === "REQUESTED_PRODUCTS" &&
      value.geospatialProfile.requestedProducts.length === 0
    ) {
      addLockIssue(
        context,
        ["geospatialProfile", "requestedProducts"],
        "REQUESTED_PRODUCTS requires at least one product",
      );
    }
    if (
      value.geospatialProfile.transportMode !== "REQUESTED_PRODUCTS" &&
      value.geospatialProfile.requestedProducts.length !== 0
    ) {
      addLockIssue(
        context,
        ["geospatialProfile", "requestedProducts"],
        "only REQUESTED_PRODUCTS may declare products",
      );
    }
    if (
      value.currentness.mode === "DEDICATED_OPERATION" &&
      (value.currentness.operation === undefined ||
        value.currentness.profile !== undefined)
    ) {
      addLockIssue(
        context,
        ["currentness"],
        "DEDICATED_OPERATION requires only operation",
      );
    }
    if (
      value.currentness.mode === "EXECUTE_WORLD_QUERY_PROFILE" &&
      (value.currentness.profile === undefined ||
        value.currentness.operation !== undefined)
    ) {
      addLockIssue(
        context,
        ["currentness"],
        "EXECUTE_WORLD_QUERY_PROFILE requires only profile",
      );
    }
    if (
      value.currentness.mode === "UNSUPPORTED" &&
      (value.currentness.operation !== undefined ||
        value.currentness.profile !== undefined)
    ) {
      addLockIssue(
        context,
        ["currentness"],
        "UNSUPPORTED cannot declare operation or profile",
      );
    }
    if (value.consumerLockHash !== calculateConsumerLockHash(value)) {
      addLockIssue(
        context,
        ["consumerLockHash"],
        "consumer lock hash does not match canonical content",
      );
    }
  });

export type WsgsGeospatialConsumerLock = z.infer<
  typeof wsgsGeospatialConsumerLockSchema
>;

export class WsgsGeospatialConsumerLockError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function calculateConsumerLockHash(value: unknown): string {
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete copy["consumerLockHash"];
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(copy)))
    .digest("hex")}`;
}

export function parseWsgsGeospatialConsumerLock(
  value: unknown,
): WsgsGeospatialConsumerLock {
  return wsgsGeospatialConsumerLockSchema.parse(value);
}

export const defaultWsgsGeospatialConsumerLock =
  parseWsgsGeospatialConsumerLock(generatedConsumerLock);

export function declaredGeospatialRequestedProducts(
  value: unknown,
): readonly string[] {
  const lock = parseWsgsGeospatialConsumerLock(value);
  return lock.status === "READY" &&
    lock.geospatialProfile.transportMode === "REQUESTED_PRODUCTS"
    ? lock.geospatialProfile.requestedProducts
    : [];
}

export interface WsgsCapabilitiesForGeospatialConsumer {
  readonly contractVersion: string;
  readonly supportedProducts: readonly string[];
  readonly requiredCapabilitiesReady: boolean;
  readonly gowmContract: {
    readonly commit: string;
  };
}

export function assertWsgsCapabilitiesAgainstConsumerLock(
  capabilities: WsgsCapabilitiesForGeospatialConsumer,
  value: unknown,
): WsgsGeospatialConsumerLock {
  const lock = parseWsgsGeospatialConsumerLock(value);
  if (capabilities.contractVersion !== lock.groundingContract.contractVersion) {
    throw new WsgsGeospatialConsumerLockError(
      "WSGS_GEOSPATIAL_GROUNDING_CONTRACT_MISMATCH",
    );
  }
  if (lock.status === "BLOCKED") return lock;
  if (!capabilities.requiredCapabilitiesReady) {
    throw new WsgsGeospatialConsumerLockError(
      "WSGS_GEOSPATIAL_REQUIRED_CAPABILITIES_NOT_READY",
    );
  }
  if (capabilities.gowmContract.commit !== lock.sources.gowmSha) {
    throw new WsgsGeospatialConsumerLockError(
      "WSGS_GEOSPATIAL_GOWM_COMMIT_MISMATCH",
    );
  }
  const missing = lock.geospatialProfile.requestedProducts.filter(
    (product) => !capabilities.supportedProducts.includes(product),
  );
  if (missing.length !== 0) {
    throw new WsgsGeospatialConsumerLockError(
      "WSGS_GEOSPATIAL_REQUESTED_PRODUCT_UNAVAILABLE",
    );
  }
  return lock;
}

export function assertWsgsGeospatialFindingsAuthorized(
  findingsValue: unknown,
  consumerLock: unknown,
): WsgsGeospatialFindings {
  const findings = parseWsgsGeospatialFindings(findingsValue);
  const lock = parseWsgsGeospatialConsumerLock(consumerLock);
  if (lock.status !== "READY") {
    throw new WsgsGeospatialConsumerLockError(
      "WSGS_GEOSPATIAL_CONSUMER_LOCK_BLOCKED",
    );
  }
  if (lock.geospatialProfile.transportMode !== "RESULT_EXTENSION") {
    throw new WsgsGeospatialConsumerLockError(
      "WSGS_GEOSPATIAL_RESULT_EXTENSION_UNAUTHORIZED",
    );
  }
  if (
    findings.profile !== lock.geospatialProfile.profile ||
    findings.profileSchemaHash !== lock.geospatialProfile.profileSchemaHash
  ) {
    throw new WsgsGeospatialConsumerLockError(
      "WSGS_GEOSPATIAL_RESULT_PROFILE_MISMATCH",
    );
  }
  return findings;
}

function addLockIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}
