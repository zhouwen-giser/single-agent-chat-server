import { z } from "zod";

import type { WorldExplanationV1 } from "../../world-explanation-contract/src/index.js";
import type { KnownWorldReference } from "../../wsgs-http-adapter/src/index.js";

import type { WorldFocusReference } from "./index.js";

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const findingReferenceSelectorSchema = z
  .strictObject({
    principalId: identifier,
    threadId: identifier,
    explanationId: identifier,
    explanationHash: sha256,
    findingId: identifier,
    findingOrdinal: z.number().int().min(1).max(128),
    featureId: identifier.optional(),
    featureOrdinal: z.number().int().min(1).max(256).optional(),
    now: z.iso.datetime().optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.featureId === undefined) !==
      (value.featureOrdinal === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Feature id and ordinal must be supplied together",
      });
    }
  });

export type FindingReferenceSelector = z.infer<
  typeof findingReferenceSelectorSchema
>;

export interface ProjectedFindingReference {
  readonly focusReference: WorldFocusReference;
  readonly sourceMessageId: string;
}

export interface ScopedFindingProjection {
  readonly focusRevision: number;
  readonly explanation: WorldExplanationV1;
  readonly references: readonly ProjectedFindingReference[];
}

export interface ScopedFindingProjectionLookup {
  findFindingProjection(
    selector: FindingReferenceSelector,
  ): Promise<ScopedFindingProjection | undefined>;
}

export const findingReferenceClarificationReasons = [
  "INVALID_SELECTOR",
  "FINDING_IDENTITY_MISMATCH",
  "FEATURE_IDENTITY_MISMATCH",
  "STABLE_REFERENCE_REQUIRED",
  "AMBIGUOUS_REFERENCE",
] as const;

export const findingReferenceUnavailableReasons = [
  "EXPLANATION_UNAVAILABLE",
  "EXPLANATION_INTEGRITY_MISMATCH",
  "REFERENCE_NOT_PROJECTED",
] as const;

export type FindingReferenceResolution =
  | {
      readonly status: "RESOLVED";
      readonly focusRevision: number;
      readonly explanationId: string;
      readonly explanationHash: string;
      readonly findingId: string;
      readonly findingOrdinal: number;
      readonly featureId?: string;
      readonly featureOrdinal?: number;
      readonly referenceIdentityHash: string;
      readonly knownWorldReference: KnownWorldReference;
    }
  | {
      readonly status: "REVALIDATION_REQUIRED";
      readonly reason: "REFERENCE_REVALIDATION_REQUIRED";
      readonly focusRevision: number;
      readonly explanationId: string;
      readonly explanationHash: string;
      readonly findingId: string;
      readonly findingOrdinal: number;
      readonly featureId?: string;
      readonly featureOrdinal?: number;
      readonly referenceIdentityHash: string;
      readonly knownWorldReference: KnownWorldReference;
    }
  | {
      readonly status: "CLARIFY";
      readonly reason: (typeof findingReferenceClarificationReasons)[number];
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: (typeof findingReferenceUnavailableReasons)[number];
    };

export class FindingReferenceResolver {
  constructor(private readonly lookup: ScopedFindingProjectionLookup) {}

  async resolve(value: unknown): Promise<FindingReferenceResolution> {
    const parsed = findingReferenceSelectorSchema.safeParse(value);
    if (!parsed.success) {
      return { status: "CLARIFY", reason: "INVALID_SELECTOR" };
    }
    const selector = parsed.data;
    let projection: ScopedFindingProjection | undefined;
    try {
      projection = await this.lookup.findFindingProjection(selector);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "WORLD_EXPLANATION_HASH_MISMATCH"
      ) {
        return {
          status: "UNAVAILABLE",
          reason: "EXPLANATION_INTEGRITY_MISMATCH",
        };
      }
      throw error;
    }
    if (projection === undefined) {
      return { status: "UNAVAILABLE", reason: "EXPLANATION_UNAVAILABLE" };
    }
    const explanation = projection.explanation;
    if (
      explanation.explanationId !== selector.explanationId ||
      explanation.explanationHash !== selector.explanationHash
    ) {
      return {
        status: "UNAVAILABLE",
        reason: "EXPLANATION_INTEGRITY_MISMATCH",
      };
    }
    const finding = explanation.findings[selector.findingOrdinal - 1];
    if (finding?.findingId !== selector.findingId) {
      return { status: "CLARIFY", reason: "FINDING_IDENTITY_MISMATCH" };
    }

    const stableKeys =
      selector.featureId === undefined
        ? stableFindingReferenceKeys(explanation, selector.findingId)
        : stableFeatureReferenceKeys(
            explanation,
            selector.findingId,
            selector.featureId,
            selector.featureOrdinal as number,
          );
    if (stableKeys === undefined) {
      return { status: "CLARIFY", reason: "FEATURE_IDENTITY_MISMATCH" };
    }
    if (stableKeys.size === 0) {
      return { status: "CLARIFY", reason: "STABLE_REFERENCE_REQUIRED" };
    }
    if (selector.featureId !== undefined && stableKeys.size !== 1) {
      return { status: "CLARIFY", reason: "AMBIGUOUS_REFERENCE" };
    }

    const projected = projection.references.filter(({ focusReference }) => {
      return (
        focusReference.sourceExplanationId === selector.explanationId &&
        focusReference.sourceExplanationHash === selector.explanationHash &&
        focusReference.sourceFindingId === selector.findingId &&
        focusReference.sourceFindingOrdinal === selector.findingOrdinal &&
        stableKeys.has(referenceKeyIdentity(focusReference.referenceKey))
      );
    });
    if (projected.length === 0) {
      return { status: "UNAVAILABLE", reason: "REFERENCE_NOT_PROJECTED" };
    }
    if (projected.length !== 1) {
      return { status: "CLARIFY", reason: "AMBIGUOUS_REFERENCE" };
    }
    const selected = projected[0] as ProjectedFindingReference;
    const reference = selected.focusReference;
    const identity = {
      focusRevision: projection.focusRevision,
      explanationId: selector.explanationId,
      explanationHash: selector.explanationHash,
      findingId: selector.findingId,
      findingOrdinal: selector.findingOrdinal,
      ...(selector.featureId === undefined
        ? {}
        : {
            featureId: selector.featureId,
            featureOrdinal: selector.featureOrdinal,
          }),
      referenceIdentityHash: reference.referenceIdentityHash,
      knownWorldReference: {
        alias: reference.displayName,
        referenceKey: reference.referenceKey,
        referenceType: reference.referenceType,
        sourceMessageId: selected.sourceMessageId,
        sourceGroundingId: reference.sourceGroundingId,
        ...(reference.validUntil === undefined
          ? {}
          : { validUntil: reference.validUntil }),
      },
    };
    if (!isUsable(selected.focusReference, selector.now)) {
      return {
        ...identity,
        status: "REVALIDATION_REQUIRED",
        reason: "REFERENCE_REVALIDATION_REQUIRED",
      };
    }
    return {
      ...identity,
      status: "RESOLVED",
    };
  }
}

function stableFindingReferenceKeys(
  explanation: WorldExplanationV1,
  findingId: string,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const reference of explanation.references) {
    keys.add(referenceKeyIdentity(reference.referenceKey));
  }
  const finding = explanation.findings.find(
    (candidate) => candidate.findingId === findingId,
  );
  for (const feature of finding?.featureSummaries ?? []) {
    if (feature.referenceKey !== undefined) {
      keys.add(referenceKeyIdentity(feature.referenceKey));
    }
  }
  for (const feature of explanation.mapProjection?.features ?? []) {
    if (feature.findingId === findingId && "referenceKey" in feature) {
      keys.add(referenceKeyIdentity(feature.referenceKey));
    }
  }
  return keys;
}

function stableFeatureReferenceKeys(
  explanation: WorldExplanationV1,
  findingId: string,
  featureId: string,
  featureOrdinal: number,
): ReadonlySet<string> | undefined {
  const finding = explanation.findings.find(
    (candidate) => candidate.findingId === findingId,
  );
  if (finding === undefined) return undefined;
  const summary = finding.featureSummaries?.[featureOrdinal - 1];
  if (summary?.featureId !== featureId) {
    return undefined;
  }
  const keys = new Set<string>();
  if (summary.referenceKey !== undefined) {
    keys.add(referenceKeyIdentity(summary.referenceKey));
  }
  for (const candidate of explanation.mapProjection?.features ?? []) {
    if (
      candidate.findingId === findingId &&
      candidate.featureId === featureId &&
      "referenceKey" in candidate
    ) {
      keys.add(referenceKeyIdentity(candidate.referenceKey));
    }
  }
  return keys;
}

function referenceKeyIdentity(
  referenceKey: KnownWorldReference["referenceKey"],
): string {
  return [
    referenceKey.namespace,
    referenceKey.kind,
    referenceKey.id,
    referenceKey.version,
  ].join("\u0000");
}

function isUsable(reference: WorldFocusReference, now?: string): boolean {
  if (reference.status !== "VALID" || reference.revalidationRequired) {
    return false;
  }
  return (
    reference.validUntil === undefined ||
    Date.parse(reference.validUntil) >
      Date.parse(now ?? new Date().toISOString())
  );
}
