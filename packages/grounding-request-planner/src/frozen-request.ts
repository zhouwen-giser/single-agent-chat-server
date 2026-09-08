import { createHash } from "node:crypto";
import { z } from "zod";
import {
  FrozenWorldAnalysisContract,
  publicCanonicalHash,
  type GroundingRequest12,
  type GroundingResult12,
  type AnalysisSelection,
} from "../../wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import {
  parseGroundingContractIdentity,
  type GroundingContractIdentity,
} from "../../analysis-contract/src/source.js";

export interface FrozenSourceContext {
  principalId: string;
  threadId: string;
  analysisId: string;
  revisionId: string;
  contractIdentity: GroundingContractIdentity;
  /** Complete source, loaded from the authorized repository, never the display array. */
  result: GroundingResult12;
}
export class FrozenSelectionError extends Error {
  constructor(
    readonly code:
      | "SELECTION_UNAVAILABLE"
      | "SELECTION_EXPIRED"
      | "SELECTION_CONFLICT"
      | "SELECTION_INVALID"
      | "ANALYSIS_REVISION_CONFLICT",
  ) {
    super(code);
  }
}
export type FrozenRequestPlan =
  | { kind: "PRESENTATION"; action: "EXPAND_CARD" | "FOCUS_MAP" }
  | {
      kind: "CLARIFICATION";
      reasonCode:
        | "SELECTION_CONTEXT_REQUIRED"
        | "SELECTION_AMBIGUOUS"
        | "SELECTION_EXPIRED";
    }
  | {
      kind: "QUERY";
      request: GroundingRequest12;
      requestHash: string;
      semanticHash: string;
      idempotencyKey: string;
      contractIdentity: GroundingContractIdentity;
      parentRevisionId?: string;
    };
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const contractIdentity = {
  contractVersion: "sacs-wsgs-grounding/1.2",
  resultProfile: "wsgs-world-analysis-findings/1.0",
} as const;
const ordinalOf = (text: string) => {
  const values = [
    ...text.matchAll(/第([一二三四五六七八九十]|[1-9][0-9]?)个/gu),
  ].map((m) =>
    /^[0-9]+$/u.test(m[1] ?? "")
      ? Number(m[1])
      : "一二三四五六七八九十".indexOf(m[1] ?? "") + 1,
  );
  return [...new Set(values)];
};
/** Common request planner for Chat, AG-UI and Source Control. No network or execution. */
export function planFrozenGroundingRequest(input: {
  principalId: string;
  threadId: string;
  analysisId: string;
  commandId: string;
  expectedRevisionId?: string;
  text: string;
  createdAt: string;
  context?: FrozenSourceContext;
  contextMode?: "CONTINUE" | "REPLACE";
  selections?: readonly unknown[];
  maxResultBytes?: number;
  now?: () => number;
}): FrozenRequestPlan {
  for (const id of [
    input.principalId,
    input.threadId,
    input.analysisId,
    input.commandId,
  ])
    identifier.parse(id);
  const text = z.string().min(1).max(32768).parse(input.text);
  const createdAt = z.iso.datetime({ offset: true }).parse(input.createdAt);
  const supplied = input.selections ?? [];
  if (!Array.isArray(supplied) || supplied.length > 8)
    throw new FrozenSelectionError("SELECTION_INVALID");
  const contract = new FrozenWorldAnalysisContract();
  let selections: AnalysisSelection[];
  try {
    selections = supplied.map((value) => contract.parseSelection(value));
  } catch {
    throw new FrozenSelectionError("SELECTION_INVALID");
  }
  if (new Set(selections.map((s) => s.choiceId)).size !== selections.length)
    throw new FrozenSelectionError("SELECTION_CONFLICT");
  let prior: GroundingResult12 | undefined;
  const context = input.context;
  if (context) {
    if (
      context.principalId !== input.principalId ||
      context.threadId !== input.threadId ||
      context.analysisId !== input.analysisId
    )
      throw new FrozenSelectionError("SELECTION_UNAVAILABLE");
    if (
      input.expectedRevisionId !== undefined &&
      input.expectedRevisionId !== context.revisionId
    )
      throw new FrozenSelectionError("ANALYSIS_REVISION_CONFLICT");
    if (
      parseGroundingContractIdentity(context.contractIdentity)
        .contractVersion !== contractIdentity.contractVersion
    )
      throw new FrozenSelectionError("SELECTION_UNAVAILABLE");
    prior = contract.parse("result", context.result);
  }
  // Authenticate every supplied anchor before ordinal normalization can replace it.
  for (const selection of selections) {
    if (
      !prior ||
      selection.priorGroundingId !== prior.groundingId ||
      selection.priorResultHash !== prior.resultHash ||
      selection.findingSetHash !== prior.worldAnalysisFindings.findingSetHash
    )
      throw new FrozenSelectionError("SELECTION_UNAVAILABLE");
  }
  if (/^(展开卡片|聚焦地图)$/u.test(text.trim()) && selections.length === 0)
    return {
      kind: "PRESENTATION",
      action: text.trim() === "展开卡片" ? "EXPAND_CARD" : "FOCUS_MAP",
    };
  if (input.contextMode === "REPLACE" && selections.length > 0)
    throw new FrozenSelectionError("SELECTION_CONFLICT");
  const timestamp = input.now?.() ?? Date.now();
  const allChoices =
    input.contextMode === "REPLACE"
      ? []
      : (prior?.worldAnalysisFindings.choices ?? []);
  const fresh = allChoices.filter((c) => Date.parse(c.validUntil) > timestamp);
  const ordinals = ordinalOf(text);
  if (ordinals.length > 1) throw new FrozenSelectionError("SELECTION_CONFLICT");
  if (ordinals.length === 1) {
    const candidates =
      selections.length === 1
        ? allChoices.filter((c) => c.choiceId === selections[0]?.choiceId)
        : fresh;
    if (candidates.length !== 1)
      return {
        kind: "CLARIFICATION",
        reasonCode:
          candidates.length > 1
            ? "SELECTION_AMBIGUOUS"
            : allChoices.length > 0
              ? "SELECTION_EXPIRED"
              : "SELECTION_CONTEXT_REQUIRED",
      };
    const choice = candidates[0]!;
    if (Date.parse(choice.validUntil) <= timestamp)
      return { kind: "CLARIFICATION", reasonCode: "SELECTION_EXPIRED" };
    const candidate = choice.candidates[ordinals[0]! - 1];
    if (!candidate || !prior)
      throw new FrozenSelectionError("SELECTION_INVALID");
    if (
      selections.length > 1 ||
      (selections.length === 1 &&
        selections[0]?.candidateId !== candidate.candidateId)
    )
      throw new FrozenSelectionError("SELECTION_CONFLICT");
    selections = [
      {
        priorGroundingId: prior.groundingId,
        priorResultHash: prior.resultHash,
        findingSetHash: prior.worldAnalysisFindings.findingSetHash,
        choiceId: choice.choiceId,
        candidateId: candidate.candidateId,
      },
    ];
  }
  const selectedProductIds: string[] = [];
  for (const selection of selections) {
    if (
      !prior ||
      selection.priorGroundingId !== prior.groundingId ||
      selection.priorResultHash !== prior.resultHash ||
      selection.findingSetHash !== prior.worldAnalysisFindings.findingSetHash
    )
      throw new FrozenSelectionError("SELECTION_UNAVAILABLE");
    const choice = allChoices.find((c) => c.choiceId === selection.choiceId);
    const candidate = choice?.candidates.find(
      (c) => c.candidateId === selection.candidateId,
    );
    if (!choice || !candidate)
      throw new FrozenSelectionError("SELECTION_UNAVAILABLE");
    const finding = choice.sourceFindingId
      ? prior.worldAnalysisFindings.findings.find(
          (f) => f.findingId === choice.sourceFindingId,
        )
      : undefined;
    if (
      Date.parse(choice.validUntil) <= timestamp ||
      (finding?.validUntil && Date.parse(finding.validUntil) <= timestamp)
    )
      throw new FrozenSelectionError("SELECTION_EXPIRED");
    if ("referenceProductId" in candidate) {
      const product = prior.referenceProducts.find(
        (p) => p.productId === candidate.referenceProductId,
      );
      if (!product) throw new FrozenSelectionError("SELECTION_UNAVAILABLE");
      if (product.validUntil && Date.parse(product.validUntil) <= timestamp)
        throw new FrozenSelectionError("SELECTION_EXPIRED");
      selectedProductIds.push(product.productId);
    }
  }
  const stableId = publicCanonicalHash({
    principalId: input.principalId,
    threadId: input.threadId,
    analysisId: input.analysisId,
    commandId: input.commandId,
  }).slice(7);
  // A reused command keeps its key even if text/profile changes: durable claims detect conflicts.
  const request: GroundingRequest12 = {
    schemaVersion: "1.0",
    requestId: "request-" + stableId,
    operation: "EXECUTE_WORLD_QUERY",
    source: {
      conversationRef: input.threadId,
      messageId: "message-" + stableId,
      originalText: text,
      originalTextSha256:
        "sha256:" + createHash("sha256").update(text).digest("hex"),
      locale: "zh-CN",
      createdAt,
    },
    requestedProducts: [
      "MENTIONS",
      "RESOLVED_REFERENCES",
      "REFERENCE_SETS",
      "WORLD_EVIDENCE",
    ],
    contextCapsule: {
      knownWorldReferences: [],
      priorGroundings:
        prior && input.contextMode !== "REPLACE"
          ? [
              {
                groundingId: prior.groundingId,
                resultHash: prior.resultHash,
                selectedProductIds: [...new Set(selectedProductIds)],
              },
            ]
          : [],
      mapSelections: [],
      externalCorrelationHints: [],
      externalPredicates: [],
    },
    executionPolicy: {
      readOnly: true,
      deadlineMs: 30000,
      maxQueryOperations: 16,
      maxCandidatesPerMention: 5,
      maxResultBytes: input.maxResultBytes ?? 1048576,
      allowApproximation: false,
    },
    ...(selections.length > 0 ? { analysisSelections: selections } : {}),
  };
  contract.parse("request", request);
  return {
    kind: "QUERY",
    request,
    requestHash: publicCanonicalHash(request),
    semanticHash: publicCanonicalHash({ contractIdentity, request }),
    idempotencyKey: "wsgs-" + stableId,
    contractIdentity,
    ...(context ? { parentRevisionId: context.revisionId } : {}),
  };
}
