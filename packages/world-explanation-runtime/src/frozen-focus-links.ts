import {
  focusTargetSchema,
  type FocusTarget,
} from "../../analysis-contract/src/index.js";
import { publicCanonicalHash } from "../../wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import type { FrozenAnalysisView } from "./frozen-analysis-view.js";

export interface PublishedFeatureRelation {
  relationKind:
    | "ROAD_VISIT"
    | "OFF_NETWORK"
    | "TEMPORAL_EVENT"
    | "METRIC_CANDIDATE"
    | "SPATIAL_FEATURE"
    | "FINDING"
    | "PERIOD";
  findingId: string;
  layerId: string;
  featureId: string;
  /** Public candidate/event/visit/segment identity, never an array offset. */
  relationKey: string;
}
export interface PublishedTimelineRelation {
  relationKind: PublishedFeatureRelation["relationKind"];
  findingId: string;
  itemId: string;
  relationKey: string;
}
export interface FrozenViewLinkage {
  features: (PublishedFeatureRelation & { focus: FocusTarget })[];
  findings: {
    findingId: string;
    layerIds: string[];
    featureIds: string[];
    timelineItemIds: string[];
    evidenceItemIds: string[];
    sourceProductIds: string[];
    focusTargets: FocusTarget[];
  }[];
  timeline: {
    itemId: string;
    findingId: string;
    featureIds: string[];
    focusTargets: FocusTarget[];
  }[];
  choices: {
    choiceId: string;
    candidateId: string;
    findingId?: string;
    sourceProductId?: string;
    focusTargets: FocusTarget[];
  }[];
  evidence: { evidenceItemId: string; findingIds: string[] }[];
  sourceProducts: { sourceProductId: string; findingIds: string[] }[];
}
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
const unique = (values: string[]) => [...new Set(values)].sort();

/** Resolve declared identities only, and only to objects retained in this display budget. */
export function buildFrozenViewLinkage(
  view: FrozenAnalysisView,
  featureRelations: readonly PublishedFeatureRelation[],
  timelineRelations: readonly PublishedTimelineRelation[],
): FrozenViewLinkage {
  const findingIds = new Set(
    view.findings
      .filter(
        (f) =>
          view.findings.filter((other) => other["findingId"] === f["findingId"])
            .length === 1,
      )
      .map((f) => f["findingId"]),
  );
  const layers = new Set(view.map.layers.map((l) => l.layerId));
  const evidenceIds = new Set(view.evidenceItemIds);
  const productEntries = view.sourceProducts.flatMap((p) => {
    const id = p["sourceProductId"] ?? p["productId"];
    return typeof id === "string" ? [[id, p] as const] : [];
  });
  // Reference and geospatial products may come from separate ID namespaces.
  // Ambiguous unqualified IDs are omitted, never resolved by last-write-wins.
  const products = new Map(
    productEntries.filter(
      ([id]) => productEntries.filter(([other]) => other === id).length === 1,
    ),
  );
  const features = featureRelations
    .filter((r) => findingIds.has(r.findingId) && layers.has(r.layerId))
    .map((r) => ({
      ...r,
      focus: focusTargetSchema.parse({
        focusId:
          "focus-" +
          publicCanonicalHash({
            analysisId: view.analysisId,
            revisionId: view.revisionId,
            featureId: r.featureId,
          }).slice(7),
        targetKind: "FINDING_FEATURE",
        findingId: r.findingId,
        featureId: r.featureId,
        layerId: r.layerId,
        semanticRole: "SELECTED_RESULT",
        currentness: "UNKNOWN",
      }),
    }));
  const timeline = view.timeline.items.flatMap((item) => {
    if (!item.findingId || !findingIds.has(item.findingId)) return [];
    const relation = timelineRelations.find(
      (r) => r.itemId === item.itemId && r.findingId === item.findingId,
    );
    const linked = relation
      ? features.filter(
          (f) =>
            f.findingId === relation.findingId &&
            f.relationKey === relation.relationKey &&
            f.relationKind === relation.relationKind,
        )
      : [];
    return [
      {
        itemId: item.itemId,
        findingId: item.findingId,
        featureIds: linked.map((f) => f.featureId),
        focusTargets: linked.map((f) => f.focus),
      },
    ];
  });
  const findings = view.findings.flatMap((f) => {
    const findingId = f["findingId"];
    if (typeof findingId !== "string" || !findingIds.has(findingId)) return [];
    const linked = features.filter((r) => r.findingId === findingId);
    // Explicit fields in the published contracts; no label/geometry/value matching.
    const declaredProducts = [
      ...strings(f["subjectReferenceProductIds"]),
      ...strings(f["sourceProductIds"]),
      ...[
        "taskReferenceProductId",
        "trajectoryReferenceProductId",
        "executionIntervalReferenceProductId",
      ].flatMap((key) => (typeof f[key] === "string" ? [f[key]] : [])),
    ];
    return [
      {
        findingId,
        layerIds: unique(linked.map((r) => r.layerId)),
        featureIds: unique(linked.map((r) => r.featureId)),
        timelineItemIds: timeline
          .filter((t) => t.findingId === findingId)
          .map((t) => t.itemId),
        evidenceItemIds: unique([
          ...strings(f["evidenceIds"]),
          ...strings(f["evidenceItemIds"]),
        ]).filter((id) => evidenceIds.has(id)),
        sourceProductIds: unique(declaredProducts).filter((id) =>
          products.has(id),
        ),
        focusTargets: linked.map((r) => r.focus),
      },
    ];
  });
  const choices = view.choices.map((choice) => {
    const findingId =
      choice.sourceFindingId && findingIds.has(choice.sourceFindingId)
        ? choice.sourceFindingId
        : undefined;
    const product = choice.productId
      ? products.get(choice.productId)
      : undefined;
    const focusTargets: FocusTarget[] = features
      .filter(
        (f) =>
          f.findingId === findingId &&
          ((choice.choiceKind === "RANKED_LOCATION_SELECTION" &&
            f.relationKind === "METRIC_CANDIDATE" &&
            f.relationKey === choice.candidateId) ||
            (choice.choiceKind === "EVENT_SELECTION" &&
              f.relationKind === "TEMPORAL_EVENT" &&
              f.relationKey === choice.sourceEventId)),
      )
      .map((f) => ({ ...f.focus, semanticRole: "CANDIDATE" as const }));
    if (product?.["referenceKey"])
      focusTargets.push(
        focusTargetSchema.parse({
          focusId:
            "focus-" +
            publicCanonicalHash({
              analysisId: view.analysisId,
              revisionId: view.revisionId,
              choiceId: choice.choiceId,
              candidateId: choice.candidateId,
              productId: choice.productId,
            }).slice(7),
          targetKind: "WORLD_REFERENCE",
          referenceKey: product["referenceKey"],
          semanticRole: "CANDIDATE",
          currentness: "UNKNOWN",
        }),
      );
    return {
      choiceId: choice.choiceId,
      candidateId: choice.candidateId,
      ...(findingId ? { findingId } : {}),
      ...(product && choice.productId
        ? { sourceProductId: choice.productId }
        : {}),
      focusTargets,
    };
  });
  return {
    features,
    findings,
    timeline,
    choices,
    evidence: [...evidenceIds].map((evidenceItemId) => ({
      evidenceItemId,
      findingIds: findings
        .filter((f) => f.evidenceItemIds.includes(evidenceItemId))
        .map((f) => f.findingId),
    })),
    sourceProducts: [...products.keys()].map((sourceProductId) => ({
      sourceProductId,
      findingIds: findings
        .filter((f) => f.sourceProductIds.includes(sourceProductId))
        .map((f) => f.findingId),
    })),
  };
}
