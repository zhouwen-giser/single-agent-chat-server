import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  ExternalCorrelationHint,
  ExternalPredicateCapsule,
  MapSelection,
  WsgsGroundingContextCapsule,
  WsgsGroundingResult,
} from "../../wsgs-http-adapter/src/index.js";
import {
  parseWsgsGroundingContextCapsule,
  type KnownWorldReference,
} from "../../wsgs-http-adapter/src/index.js";
import type {
  GroundingRequestPlan,
  TurnPlan,
} from "../../world-grounding-contract/src/index.js";

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const referenceKey = z.strictObject({
  namespace: z.literal("gowm"),
  kind: z.string().min(1).max(128),
  id: z.string().regex(/^wrf_[0-9a-f]{32}$/u),
  version: z.string().min(1).max(128),
});

export const worldFocusReferenceStatuses = [
  "VALID",
  "STALE",
  "EXPIRED",
  "UNKNOWN",
] as const;

export const worldFocusReferenceSchema = z.strictObject({
  referenceIdentityHash: z.string().regex(/^[0-9a-f]{64}$/u),
  referenceKey,
  productId: identifier,
  displayName: z.string().min(1).max(512),
  referenceType: z.string().min(1).max(128),
  sourceGroundingId: identifier,
  sourceResultHash: sha256,
  sourceWorldVersion: z.number().int().nonnegative(),
  validUntil: z.iso.datetime().optional(),
  revalidationRequired: z.boolean(),
  status: z.enum(worldFocusReferenceStatuses),
  lastUsedAt: z.iso.datetime(),
});

export const conversationWorldFocusSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  principalId: identifier,
  threadId: identifier,
  revision: z.number().int().nonnegative(),
  lastGroundingId: identifier.optional(),
  lastGroundingResultHash: sha256.optional(),
  references: z.array(worldFocusReferenceSchema).max(64),
  updatedAt: z.iso.datetime(),
});

export const pendingGroundingChoiceStatuses = [
  "OPEN",
  "SELECTED",
  "EXPIRED",
  "CANCELLED",
] as const;

export const pendingGroundingCandidateSchema = z.strictObject({
  ordinal: z.number().int().min(1).max(20),
  productId: identifier,
  displayName: z.string().min(1).max(512),
  referenceType: z.string().max(128).optional(),
});

export const pendingGroundingChoiceSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  choiceId: identifier,
  principalId: identifier,
  threadId: identifier,
  originMessageId: identifier,
  originGroundingId: identifier,
  originResultHash: sha256,
  originTurnPlan: z.record(z.string(), z.unknown()),
  originRequestPlan: z.record(z.string(), z.unknown()),
  mentionId: identifier,
  surfaceText: z.string().min(1).max(512),
  candidates: z.array(pendingGroundingCandidateSchema).min(2).max(20),
  status: z.enum(pendingGroundingChoiceStatuses),
  selectedProductId: identifier.optional(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const groundingContinuationStates = [
  "CHOICE_SELECTED",
  "VALIDATING",
  "VALIDATED",
  "RESUMING_ORIGIN_QUERY",
  "COMPLETED",
  "FAILED",
] as const;

export const groundingContinuationSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  choiceId: identifier,
  controlMessageId: identifier,
  selectedProductId: identifier,
  validationOperation: z.literal("VALIDATE_REFERENCES"),
  resumeSourcePolicy: z.literal("RESTORE_ORIGIN_MESSAGE"),
  state: z.enum(groundingContinuationStates),
});

export type WorldFocusReference = z.infer<typeof worldFocusReferenceSchema>;
export type ConversationWorldFocus = z.infer<
  typeof conversationWorldFocusSchema
>;
export type PendingGroundingCandidate = z.infer<
  typeof pendingGroundingCandidateSchema
>;
export type PendingGroundingChoice = z.infer<
  typeof pendingGroundingChoiceSchema
>;
export type GroundingContinuation = z.infer<typeof groundingContinuationSchema>;

export interface WorldFocusScope {
  readonly principalId: string;
  readonly threadId: string;
}

export interface ContextReadyWorldReference {
  readonly focusReference: WorldFocusReference;
  readonly sourceMessageId: string;
}

export interface UpsertWorldFocusReference extends Omit<
  WorldFocusReference,
  "referenceIdentityHash" | "status" | "lastUsedAt"
> {
  readonly sourceMessageId: string;
  readonly lastUsedAt?: string;
}

export interface WorldFocusRepository {
  getFocus(scope: WorldFocusScope): Promise<ConversationWorldFocus>;
  listUsableReferences(
    scope: WorldFocusScope & { readonly limit: number; readonly now?: string },
  ): Promise<readonly ContextReadyWorldReference[]>;
  listReferencesRequiringValidation(
    scope: WorldFocusScope & { readonly limit: number; readonly now?: string },
  ): Promise<readonly ContextReadyWorldReference[]>;
  applyReferences(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly expectedRevision: number;
    readonly groundingId: string;
    readonly groundingResultHash: string;
    readonly references: readonly UpsertWorldFocusReference[];
  }): Promise<ConversationWorldFocus>;
  getOpenChoice(
    scope: WorldFocusScope & { readonly now?: string },
  ): Promise<PendingGroundingChoice | undefined>;
  createChoice(choice: PendingGroundingChoice): Promise<PendingGroundingChoice>;
  selectChoice(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly choiceId: string;
    readonly selectedProductId: string;
    readonly now?: string;
  }): Promise<PendingGroundingChoice>;
  closeChoice(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly choiceId: string;
    readonly status: "EXPIRED" | "CANCELLED";
    readonly now?: string;
  }): Promise<PendingGroundingChoice>;
}

export interface GroundingContextAssembly {
  readonly schemaVersion: "1.0";
  readonly focusRevision: number;
  readonly contextCapsule: WsgsGroundingContextCapsule;
  readonly source:
    "CURRENT_FOCUS" | "CONTINUATION" | "AUTHORITY_FUSION" | "EMPTY";
}

export interface GroundingContextAssemblerInput extends WorldFocusScope {
  readonly turnPlan: TurnPlan;
  readonly continuationReferences?: readonly KnownWorldReference[];
  readonly mapSelections?: readonly MapSelection[];
  readonly fusionRequirements?: {
    readonly correlationHints: readonly ExternalCorrelationHint[];
    readonly predicates: readonly ExternalPredicateCapsule[];
  };
  readonly now?: string;
}

export class GroundingContextAssembler {
  constructor(private readonly repository: WorldFocusRepository) {}

  async assemble(
    input: GroundingContextAssemblerInput,
  ): Promise<GroundingContextAssembly> {
    const focus = await this.repository.getFocus(input);
    const known = input.turnPlan.worldFocusUsage.knownWorldReferences
      ? await this.repository.listUsableReferences({
          principalId: input.principalId,
          threadId: input.threadId,
          limit: 64,
          ...(input.now === undefined ? {} : { now: input.now }),
        })
      : [];
    const knownWorldReferences = [
      ...known.map(toKnownWorldReference),
      ...(input.continuationReferences ?? []),
    ].slice(0, 64);
    const priorGroundings =
      input.turnPlan.worldFocusUsage.priorGrounding &&
      focus.lastGroundingId !== undefined &&
      focus.lastGroundingResultHash !== undefined
        ? [
            {
              groundingId: focus.lastGroundingId,
              resultHash: focus.lastGroundingResultHash,
              selectedProductIds: focus.references.map(
                ({ productId }) => productId,
              ),
            },
          ]
        : [];
    const mapSelections = input.turnPlan.worldFocusUsage.mapSelections
      ? [...(input.mapSelections ?? [])]
      : [];
    const fusion = input.fusionRequirements;
    const externalCorrelationHints =
      input.turnPlan.worldFocusUsage.externalCorrelationHints &&
      fusion !== undefined
        ? [...fusion.correlationHints]
        : [];
    const externalPredicates =
      input.turnPlan.worldFocusUsage.externalPredicates && fusion !== undefined
        ? [...fusion.predicates]
        : [];
    const contextCapsule = parseWsgsGroundingContextCapsule({
      knownWorldReferences,
      priorGroundings,
      mapSelections,
      externalCorrelationHints,
      externalPredicates,
    });
    const source =
      input.continuationReferences !== undefined
        ? "CONTINUATION"
        : fusion !== undefined
          ? "AUTHORITY_FUSION"
          : Object.values(contextCapsule).some((values) => values.length > 0)
            ? "CURRENT_FOCUS"
            : "EMPTY";
    return {
      schemaVersion: "1.0",
      focusRevision: focus.revision,
      contextCapsule,
      source,
    };
  }
}

export type PendingChoiceResolution =
  | {
      readonly kind: "SELECTED";
      readonly candidate: PendingGroundingCandidate;
    }
  | { readonly kind: "CLARIFY"; readonly reason: string };

export class PendingChoiceResolver {
  resolve(
    userText: string,
    choice: PendingGroundingChoice,
  ): PendingChoiceResolution {
    const parsed = parsePendingGroundingChoice(choice);
    if (parsed.status !== "OPEN") {
      return { kind: "CLARIFY", reason: "PENDING_CHOICE_NOT_OPEN" };
    }
    const normalized = userText.trim();
    const exact = parsed.candidates.filter(
      ({ displayName }) => displayName === normalized,
    );
    if (exact.length === 1 && exact[0] !== undefined) {
      return { kind: "SELECTED", candidate: exact[0] };
    }
    const ordinal = deterministicOrdinal(normalized);
    if (ordinal === undefined) {
      return { kind: "CLARIFY", reason: "CHOICE_INPUT_NOT_DETERMINISTIC" };
    }
    const candidate = parsed.candidates.find(
      ({ ordinal: value }) => value === ordinal,
    );
    return candidate === undefined
      ? { kind: "CLARIFY", reason: "CHOICE_ORDINAL_OUT_OF_RANGE" }
      : { kind: "SELECTED", candidate };
  }
}

export function isDeterministicChoiceControl(userText: string): boolean {
  return deterministicOrdinal(userText.trim()) !== undefined;
}

export interface WorldFocusUpdateResult {
  readonly focus: ConversationWorldFocus;
  readonly choice?: PendingGroundingChoice;
}

export class WorldFocusUpdater {
  private readonly nextChoiceId: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly repository: WorldFocusRepository,
    options: {
      readonly nextChoiceId?: () => string;
      readonly now?: () => Date;
      readonly choiceTtlMs?: number;
    } = {},
  ) {
    this.nextChoiceId = options.nextChoiceId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.choiceTtlMs = options.choiceTtlMs ?? 15 * 60_000;
  }

  private readonly choiceTtlMs: number;

  async apply(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly groundingExecutionId: string;
    readonly originMessageId: string;
    readonly turnPlan: TurnPlan;
    readonly requestPlan: GroundingRequestPlan;
    readonly result: WsgsGroundingResult;
  }): Promise<WorldFocusUpdateResult> {
    const current = await this.repository.getFocus(input);
    if (
      current.lastGroundingId === input.result.groundingId &&
      current.lastGroundingResultHash === input.result.resultHash
    ) {
      return { focus: current };
    }
    if (input.result.status === "AMBIGUOUS") {
      const choice = await this.createChoice(input);
      return { focus: current, ...(choice === undefined ? {} : { choice }) };
    }
    if (!["COMPLETED", "PARTIAL"].includes(input.result.status)) {
      return { focus: current };
    }
    const ambiguousProducts = new Set(
      input.result.ambiguities.flatMap(
        ({ candidateProductIds }) => candidateProductIds,
      ),
    );
    const now = this.now();
    const references = input.result.referenceProducts
      .filter(
        (product) =>
          !ambiguousProducts.has(product.productId) &&
          (input.result.status === "COMPLETED" ||
            (product.revalidationRequired !== true &&
              (product.validUntil === undefined ||
                Date.parse(product.validUntil) > now.getTime()))),
      )
      .map((product) => ({
        referenceKey: product.referenceKey,
        productId: product.productId,
        displayName: product.displayName,
        referenceType: product.referenceType,
        sourceMessageId: input.originMessageId,
        sourceGroundingId: input.result.groundingId,
        sourceResultHash: input.result.resultHash,
        sourceWorldVersion: product.sourceWorldVersion,
        ...(product.validUntil === undefined
          ? {}
          : { validUntil: product.validUntil }),
        revalidationRequired: product.revalidationRequired ?? false,
        lastUsedAt: now.toISOString(),
      }));
    if (references.length === 0) return { focus: current };
    try {
      return {
        focus: await this.repository.applyReferences({
          principalId: input.principalId,
          threadId: input.threadId,
          expectedRevision: current.revision,
          groundingId: input.result.groundingId,
          groundingResultHash: input.result.resultHash,
          references,
        }),
      };
    } catch {
      const refreshed = await this.repository.getFocus(input);
      if (
        refreshed.lastGroundingId === input.result.groundingId &&
        refreshed.lastGroundingResultHash === input.result.resultHash
      ) {
        return { focus: refreshed };
      }
      throw new Error("WORLD_FOCUS_CONCURRENT_UPDATE");
    }
  }

  private async createChoice(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly groundingExecutionId: string;
    readonly originMessageId: string;
    readonly turnPlan: TurnPlan;
    readonly requestPlan: GroundingRequestPlan;
    readonly result: WsgsGroundingResult;
  }): Promise<PendingGroundingChoice | undefined> {
    const ambiguity = input.result.ambiguities[0];
    if (ambiguity === undefined) return undefined;
    const products = new Map(
      input.result.referenceProducts.map((product) => [
        product.productId,
        product,
      ]),
    );
    const candidates = ambiguity.candidateProductIds
      .map((productId, index) => {
        const product = products.get(productId);
        return product === undefined
          ? undefined
          : {
              ordinal: index + 1,
              productId,
              displayName: product.displayName,
              referenceType: product.referenceType,
            };
      })
      .filter(
        (candidate): candidate is Exclude<typeof candidate, undefined> =>
          candidate !== undefined,
      );
    if (candidates.length < 2) return undefined;
    const now = this.now();
    return this.repository.createChoice({
      schemaVersion: "1.0",
      choiceId: "choice-" + this.nextChoiceId(),
      principalId: input.principalId,
      threadId: input.threadId,
      originMessageId: input.originMessageId,
      originGroundingId: input.groundingExecutionId,
      originResultHash: input.result.resultHash,
      originTurnPlan: asObject(input.turnPlan),
      originRequestPlan: asObject(input.requestPlan),
      mentionId: ambiguity.mentionId,
      surfaceText: ambiguity.surfaceText,
      candidates,
      status: "OPEN",
      expiresAt: new Date(now.getTime() + this.choiceTtlMs).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }
}

export function parseConversationWorldFocus(
  value: unknown,
): ConversationWorldFocus {
  return conversationWorldFocusSchema.parse(value);
}

export function parsePendingGroundingChoice(
  value: unknown,
): PendingGroundingChoice {
  return pendingGroundingChoiceSchema.parse(value);
}

export function parseGroundingContinuation(
  value: unknown,
): GroundingContinuation {
  return groundingContinuationSchema.parse(value);
}

export function worldReferenceIdentityHash(
  value: z.infer<typeof referenceKey>,
): string {
  const parsed = referenceKey.parse(value);
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: parsed.id,
        kind: parsed.kind,
        namespace: parsed.namespace,
      }),
    )
    .digest("hex");
}

export function effectiveReferenceStatus(
  reference: WorldFocusReference,
  now = new Date(),
): WorldFocusReference["status"] {
  const parsed = worldFocusReferenceSchema.parse(reference);
  if (
    parsed.validUntil !== undefined &&
    Date.parse(parsed.validUntil) <= now.getTime()
  ) {
    return "EXPIRED";
  }
  if (parsed.revalidationRequired && parsed.status === "VALID") return "STALE";
  return parsed.status;
}

function toKnownWorldReference(
  reference: ContextReadyWorldReference,
): KnownWorldReference {
  return {
    alias: reference.focusReference.displayName,
    referenceKey: reference.focusReference.referenceKey,
    referenceType: reference.focusReference.referenceType,
    sourceMessageId: reference.sourceMessageId,
    sourceGroundingId: reference.focusReference.sourceGroundingId,
    ...(reference.focusReference.validUntil === undefined
      ? {}
      : { validUntil: reference.focusReference.validUntil }),
  };
}

function deterministicOrdinal(value: string): number | undefined {
  const ordinals: Record<string, number> = {
    "1": 1,
    "2": 2,
    "3": 3,
    第1个: 1,
    第2个: 2,
    第3个: 3,
    第一个: 1,
    第二个: 2,
    第三个: 3,
  };
  return ordinals[value];
}

function asObject(value: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
