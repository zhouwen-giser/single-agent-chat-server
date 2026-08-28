import { createHash } from "node:crypto";

import { z } from "zod";

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
