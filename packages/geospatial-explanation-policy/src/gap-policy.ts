import { z } from "zod";

import {
  explanationGapSchema,
  explanationStatuses,
  identifierSchema,
  type ExplanationGap,
} from "../../world-explanation-contract/src/index.js";

export const geospatialUpstreamSituations = [
  "NORMAL_FINDING",
  "COMPLETED_EMPTY_COLLECTION",
  "NO_DATA",
  "TRUNCATED",
  "PRODUCT_NOT_AVAILABLE",
  "PRODUCT_COVERAGE_INSUFFICIENT",
  "CAPABILITY_UNAVAILABLE",
  "REFERENCE_AMBIGUOUS",
  "AMBIGUOUS_PRODUCT_SELECTION",
  "SOURCE_CHANGED_DURING_QUERY",
  "UNKNOWN_FINDING_SCHEMA",
  "EVIDENCE_INCOMPLETE",
  "CURRENTNESS_UNAVAILABLE",
  "PROVIDER_OR_PROTOCOL_FAILURE",
] as const;

const geospatialSituationSchema = z.enum(geospatialUpstreamSituations);

export const geospatialGapMappingInputSchema = z.strictObject({
  upstream: geospatialSituationSchema,
  gapId: identifierSchema,
  semanticConcept: z.string().max(128).optional(),
  findingIds: z.array(identifierSchema).max(64).optional(),
  evidenceItemIds: z.array(identifierSchema).max(128).optional(),
  safeDetail: z.string().max(2_000).optional(),
});

export const geospatialGapDecisionSchema = z
  .strictObject({
    schemaVersion: z.literal("sacs-geospatial-gap-decision/1.0"),
    upstream: geospatialSituationSchema,
    explanationStatus: z.enum(explanationStatuses),
    messageCode: z.string().min(1).max(128),
    assertionScope: z.enum([
      "UPSTREAM_FINDING_ONLY",
      "CURRENT_QUERY_RESULT_ONLY",
      "UNAVAILABLE",
      "INDETERMINATE",
    ]),
    absenceInferenceAllowed: z.literal(false),
    gap: explanationGapSchema.optional(),
  })
  .superRefine((value, context) => {
    const expected = gapMappingFor(value.upstream);
    if (
      value.explanationStatus !== expected.explanationStatus ||
      value.messageCode !== expected.messageCode ||
      value.assertionScope !== expected.assertionScope
    ) {
      context.addIssue({
        code: "custom",
        message: "gap decision does not match the frozen upstream mapping",
      });
    }
    if (expected.gapKind === undefined) {
      if (value.gap !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["gap"],
          message: "this upstream situation must not synthesize a gap",
        });
      }
      return;
    }
    if (
      value.gap?.gapKind !== expected.gapKind ||
      value.gap.severity !== expected.severity ||
      value.gap.messageCode !== expected.messageCode
    ) {
      context.addIssue({
        code: "custom",
        path: ["gap"],
        message: "gap kind, severity, and code must match the upstream mapping",
      });
    }
  });

export type GeospatialUpstreamSituation = z.infer<
  typeof geospatialSituationSchema
>;
export type GeospatialGapDecision = z.infer<typeof geospatialGapDecisionSchema>;

interface GapMapping {
  readonly explanationStatus: GeospatialGapDecision["explanationStatus"];
  readonly messageCode: string;
  readonly assertionScope: GeospatialGapDecision["assertionScope"];
  readonly gapKind?: ExplanationGap["gapKind"];
  readonly severity?: ExplanationGap["severity"];
}

const mappings: Readonly<Record<GeospatialUpstreamSituation, GapMapping>> = {
  NORMAL_FINDING: {
    explanationStatus: "COMPLETE",
    messageCode: "UPSTREAM_FINDING_AVAILABLE",
    assertionScope: "UPSTREAM_FINDING_ONLY",
  },
  COMPLETED_EMPTY_COLLECTION: {
    explanationStatus: "COMPLETE",
    messageCode: "NO_MATCH_IN_CURRENT_DATA",
    assertionScope: "CURRENT_QUERY_RESULT_ONLY",
  },
  NO_DATA: {
    explanationStatus: "DATA_UNAVAILABLE",
    messageCode: "NO_DATA_NOT_ABSENCE",
    assertionScope: "UNAVAILABLE",
    gapKind: "DATA_GAP",
    severity: "BLOCKING",
  },
  TRUNCATED: {
    explanationStatus: "PARTIAL",
    messageCode: "RESULT_TRUNCATED",
    assertionScope: "INDETERMINATE",
    gapKind: "TRUNCATED",
    severity: "WARNING",
  },
  PRODUCT_NOT_AVAILABLE: {
    explanationStatus: "DATA_UNAVAILABLE",
    messageCode: "PRODUCT_NOT_AVAILABLE",
    assertionScope: "UNAVAILABLE",
    gapKind: "DATA_GAP",
    severity: "BLOCKING",
  },
  PRODUCT_COVERAGE_INSUFFICIENT: {
    explanationStatus: "DATA_UNAVAILABLE",
    messageCode: "PRODUCT_COVERAGE_INSUFFICIENT",
    assertionScope: "UNAVAILABLE",
    gapKind: "COVERAGE_GAP",
    severity: "BLOCKING",
  },
  CAPABILITY_UNAVAILABLE: {
    explanationStatus: "DATA_UNAVAILABLE",
    messageCode: "CAPABILITY_UNAVAILABLE",
    assertionScope: "UNAVAILABLE",
    gapKind: "CAPABILITY_GAP",
    severity: "BLOCKING",
  },
  REFERENCE_AMBIGUOUS: {
    explanationStatus: "CLARIFICATION_REQUIRED",
    messageCode: "REFERENCE_AMBIGUOUS",
    assertionScope: "INDETERMINATE",
    gapKind: "REFERENCE_AMBIGUITY",
    severity: "BLOCKING",
  },
  AMBIGUOUS_PRODUCT_SELECTION: {
    explanationStatus: "CLARIFICATION_REQUIRED",
    messageCode: "AMBIGUOUS_PRODUCT_SELECTION",
    assertionScope: "INDETERMINATE",
    gapKind: "PRODUCT_SELECTION_AMBIGUITY",
    severity: "BLOCKING",
  },
  SOURCE_CHANGED_DURING_QUERY: {
    explanationStatus: "PARTIAL",
    messageCode: "SOURCE_CHANGED_DURING_QUERY",
    assertionScope: "INDETERMINATE",
    gapKind: "SOURCE_CHANGED",
    severity: "BLOCKING",
  },
  UNKNOWN_FINDING_SCHEMA: {
    explanationStatus: "PARTIAL",
    messageCode: "UNKNOWN_FINDING_SCHEMA",
    assertionScope: "INDETERMINATE",
    gapKind: "UNSUPPORTED_FINDING_SCHEMA",
    severity: "WARNING",
  },
  EVIDENCE_INCOMPLETE: {
    explanationStatus: "PARTIAL",
    messageCode: "EVIDENCE_INCOMPLETE",
    assertionScope: "INDETERMINATE",
    gapKind: "EVIDENCE_INCOMPLETE",
    severity: "WARNING",
  },
  CURRENTNESS_UNAVAILABLE: {
    explanationStatus: "DATA_UNAVAILABLE",
    messageCode: "CURRENTNESS_UNAVAILABLE",
    assertionScope: "UNAVAILABLE",
    gapKind: "CURRENTNESS_UNAVAILABLE",
    severity: "BLOCKING",
  },
  PROVIDER_OR_PROTOCOL_FAILURE: {
    explanationStatus: "FAILED",
    messageCode: "UPSTREAM_FAILURE",
    assertionScope: "UNAVAILABLE",
    gapKind: "UPSTREAM_FAILURE",
    severity: "BLOCKING",
  },
};

function gapMappingFor(upstream: GeospatialUpstreamSituation): GapMapping {
  return mappings[upstream];
}

export function mapGeospatialGapSituation(
  value: unknown,
): GeospatialGapDecision {
  const input = geospatialGapMappingInputSchema.parse(value);
  const mapping = mappings[input.upstream];
  const gap =
    mapping.gapKind === undefined
      ? undefined
      : explanationGapSchema.parse({
          gapId: input.gapId,
          gapKind: mapping.gapKind,
          severity: mapping.severity,
          messageCode: mapping.messageCode,
          ...(input.semanticConcept === undefined
            ? {}
            : { semanticConcept: input.semanticConcept }),
          ...(input.findingIds === undefined
            ? {}
            : { findingIds: input.findingIds }),
          ...(input.evidenceItemIds === undefined
            ? {}
            : { evidenceItemIds: input.evidenceItemIds }),
          ...(input.safeDetail === undefined
            ? {}
            : { safeDetail: input.safeDetail }),
        });
  return geospatialGapDecisionSchema.parse({
    schemaVersion: "sacs-geospatial-gap-decision/1.0",
    upstream: input.upstream,
    explanationStatus: mapping.explanationStatus,
    messageCode: mapping.messageCode,
    assertionScope: mapping.assertionScope,
    absenceInferenceAllowed: false,
    ...(gap === undefined ? {} : { gap }),
  });
}
