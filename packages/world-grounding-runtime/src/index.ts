import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { planGroundingRequest } from "../../grounding-request-planner/src/index.js";
import type {
  GroundingPersistenceRepository,
  InteractionPersistenceRepository,
  JsonValue,
} from "../../persistence/src/index.js";
import type { CompletedRequestResult } from "../../request-result/src/index.js";
import {
  parseWsgsGroundingResult,
  WsgsHttpError,
  type WsgsGroundingJob,
  type WsgsGroundingRequest,
  type WsgsGroundingResult,
  type WsgsHttpClient,
} from "../../wsgs-http-adapter/src/index.js";
import {
  parseOperationalGroundingBundle,
  parseTurnPlan,
  type OperationalGroundingBundle,
  type TurnPlan,
} from "../../world-grounding-contract/src/index.js";

const compatibilityLockSchema = z
  .object({
    profile: z.literal("sacs-sdar-operational-grounding/1.0"),
    status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
    dataPartMediaType: z.string().min(1).max(256).nullable(),
    schemaSha256: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/u)
      .nullable(),
    handlerEvidence: z.unknown().nullable(),
    validatorEvidence: z.unknown().nullable(),
    realE2eEvidence: z.unknown().nullable(),
    requiredRuntimeError: z.literal("SDAR_GROUNDING_EXTENSION_UNAVAILABLE"),
    fallback: z.object({
      dropDataPart: z.literal(false),
      convertToText: z.literal(false),
      modifySdar: z.literal(false),
    }),
  })
  .passthrough();

export type SdarGroundingCompatibilityLock = z.infer<
  typeof compatibilityLockSchema
>;

export const worldGroundingRuntimeCodes = [
  "WORLD_GROUNDING_IN_PROGRESS",
  "WORLD_GROUNDING_CONTEXT_UNAVAILABLE",
  "WORLD_GROUNDING_CAPABILITY_UNAVAILABLE",
  "WORLD_GROUNDING_CONTRACT_VIOLATION",
  "WORLD_GROUNDING_FAILED",
  "SDAR_GROUNDING_EXTENSION_UNAVAILABLE",
] as const;

export type WorldGroundingRuntimeCode =
  (typeof worldGroundingRuntimeCodes)[number];

export class WorldGroundingRuntimeError extends Error {
  constructor(readonly code: WorldGroundingRuntimeCode) {
    super(code);
    this.name = "WorldGroundingRuntimeError";
  }
}

export interface WorldGroundingRuntimeTurn {
  readonly protocol: "openai" | "ag_ui";
  readonly principalId: string;
  readonly threadId: string;
  readonly externalRequestId: string;
  readonly userText: string;
  readonly turnPlan: TurnPlan;
  readonly signal?: AbortSignal;
}

export interface WorldGroundingRuntimeOptions {
  readonly requests: Pick<
    InteractionPersistenceRepository,
    "claimRequest" | "completeRequest" | "authorizedRequestCreatedAt"
  >;
  readonly grounding: Pick<
    GroundingPersistenceRepository,
    "claim" | "recordGroundingReady" | "complete" | "fail" | "cancel"
  >;
  readonly wsgs: WsgsHttpClient;
  readonly sdarCompatibilityLock: unknown;
  readonly nextLeaseOwner?: () => string;
}

export class WorldGroundingRuntime {
  private readonly lock: SdarGroundingCompatibilityLock;
  private readonly nextLeaseOwner: () => string;

  constructor(private readonly options: WorldGroundingRuntimeOptions) {
    this.lock = compatibilityLockSchema.parse(options.sdarCompatibilityLock);
    this.nextLeaseOwner = options.nextLeaseOwner ?? randomUUID;
  }

  async answerWorld(input: WorldGroundingRuntimeTurn): Promise<string> {
    const turnPlan = parseTurnPlan(input.turnPlan);
    if (turnPlan.turnRoute !== "WORLD_ANSWER") {
      throw new WorldGroundingRuntimeError(
        "WORLD_GROUNDING_CONTRACT_VIOLATION",
      );
    }
    try {
      assertContextAvailable(turnPlan);
    } catch (error) {
      if (error instanceof WorldGroundingRuntimeError) return error.code;
      throw error;
    }
    const plan = planGroundingRequest(turnPlan);
    const stableHash = stableTurnHash(input, turnPlan);
    const leaseOwner = this.nextLeaseOwner();
    const outerClaim = await this.options.requests.claimRequest({
      protocol: input.protocol,
      externalRequestId: `wg-` + stableHash,
      principalId: input.principalId,
      threadId: input.threadId,
      requestHash: stableHash,
      leaseOwner,
      leaseMs: 180_000,
    });
    if (outerClaim.outcome === "conflict") {
      throw new WorldGroundingRuntimeError(
        "WORLD_GROUNDING_CONTRACT_VIOLATION",
      );
    }
    if (outerClaim.outcome === "in_progress") {
      return "WORLD_GROUNDING_IN_PROGRESS";
    }
    if (outerClaim.outcome === "replay") {
      if (outerClaim.result.kind !== "message") {
        throw new WorldGroundingRuntimeError(
          "WORLD_GROUNDING_CONTRACT_VIOLATION",
        );
      }
      return outerClaim.result.renderedText;
    }

    const requestCreatedAt =
      await this.options.requests.authorizedRequestCreatedAt({
        requestId: outerClaim.requestId,
        principalId: input.principalId,
        threadId: input.threadId,
      });
    const groundingId = `grounding-` + stableHash;
    const wsgsRequestId = `wsgs-` + stableHash;
    const request = createWsgsRequest({
      input,
      plan,
      requestId: wsgsRequestId,
      createdAt: requestCreatedAt,
    });
    const groundingClaim = await this.options.grounding.claim({
      groundingId,
      principalId: input.principalId,
      threadId: input.threadId,
      interactionRequestId: outerClaim.requestId,
      wsgsRequestId,
      idempotencyKey: `wsgs-grounding-` + stableHash,
      requestHash: hashJsonValue(request),
      wsgsOperation: plan.operation,
      requestedProducts: plan.requestedProducts,
      contextUsage: turnPlan.worldFocusUsage,
      leaseOwner,
      leaseMs: 180_000,
    });
    if (groundingClaim.kind === "BUSY") {
      return "WORLD_GROUNDING_IN_PROGRESS";
    }

    let response: string | undefined;
    try {
      let result: WsgsGroundingResult | undefined;
      if (groundingClaim.kind === "REPLAY") {
        if (groundingClaim.execution.groundingResult === undefined) {
          response = terminalFailureText(
            groundingClaim.execution.failureCode ?? "WORLD_GROUNDING_FAILED",
          );
        } else {
          result = parseWsgsGroundingResult(
            groundingClaim.execution.groundingResult,
          );
        }
      } else {
        const capabilities = await this.options.wsgs.capabilities(input.signal);
        if (!capabilities.requiredCapabilitiesReady) {
          throw new WorldGroundingRuntimeError(
            "WORLD_GROUNDING_CAPABILITY_UNAVAILABLE",
          );
        }
        result = await resolveGroundingResult(
          this.options.wsgs,
          request,
          `wsgs-grounding-` + stableHash,
          input.signal,
        );
        assertResultIdentity(result, request);
        await this.options.grounding.recordGroundingReady({
          groundingId,
          principalId: input.principalId,
          threadId: input.threadId,
          leaseOwner,
          wsgsGroundingId: result.groundingId,
          resultHash: result.resultHash,
          result: asJsonValue(result),
        });
        if (result.status === "CANCELLED") {
          await this.options.grounding.cancel({
            groundingId,
            principalId: input.principalId,
            threadId: input.threadId,
          });
        } else if (!["COMPLETED", "PARTIAL"].includes(result.status)) {
          await this.options.grounding.fail({
            groundingId,
            principalId: input.principalId,
            threadId: input.threadId,
            failureCode: `WSGS_` + result.status,
          });
        }
      }

      if (result !== undefined) {
        response = renderSafeWorldAnswer(result);
        if (
          ["COMPLETED", "PARTIAL"].includes(result.status) &&
          groundingClaim.execution.state !== "COMPLETED"
        ) {
          await this.options.grounding.complete({
            groundingId,
            principalId: input.principalId,
            threadId: input.threadId,
          });
        }
      }
    } catch (error) {
      const code = safeRuntimeCode(error);
      if (code === undefined) throw error;
      await this.options.grounding
        .fail({
          groundingId,
          principalId: input.principalId,
          threadId: input.threadId,
          failureCode: code,
        })
        .catch(() => undefined);
      response = terminalFailureText(code);
    }
    if (response === undefined) {
      throw new WorldGroundingRuntimeError(
        "WORLD_GROUNDING_CONTRACT_VIOLATION",
      );
    }
    await this.completeOuterRequest(
      outerClaim.requestId,
      input,
      leaseOwner,
      stableHash,
      response,
    );
    return response;
  }

  async submitOperational(input: WorldGroundingRuntimeTurn): Promise<string> {
    const turnPlan = parseTurnPlan(input.turnPlan);
    if (
      turnPlan.turnRoute !== "SDAR_TASK" ||
      turnPlan.groundingRequirement === "NONE"
    ) {
      throw new WorldGroundingRuntimeError(
        "WORLD_GROUNDING_CONTRACT_VIOLATION",
      );
    }
    try {
      assertSdarGroundingExtensionAvailable(this.lock);
    } catch (error) {
      if (
        error instanceof WorldGroundingRuntimeError &&
        error.code === "SDAR_GROUNDING_EXTENSION_UNAVAILABLE"
      ) {
        return error.code;
      }
      throw error;
    }
    throw new WorldGroundingRuntimeError(
      "WORLD_GROUNDING_CAPABILITY_UNAVAILABLE",
    );
  }

  private async completeOuterRequest(
    requestId: string,
    input: WorldGroundingRuntimeTurn,
    leaseOwner: string,
    stableHash: string,
    response: string,
  ): Promise<void> {
    await this.options.requests.completeRequest({
      requestId,
      principalId: input.principalId,
      leaseOwner,
      result: messageResult(stableHash, response),
    });
  }
}

export function assertSdarGroundingExtensionAvailable(
  value: unknown,
): asserts value is SdarGroundingCompatibilityLock {
  const lock = compatibilityLockSchema.parse(value);
  if (
    lock.status !== "AVAILABLE" ||
    lock.dataPartMediaType === null ||
    lock.schemaSha256 === null ||
    lock.handlerEvidence === null ||
    lock.validatorEvidence === null ||
    lock.realE2eEvidence === null
  ) {
    throw new WorldGroundingRuntimeError(
      "SDAR_GROUNDING_EXTENSION_UNAVAILABLE",
    );
  }
}

export function buildOperationalGroundingBundle(input: {
  readonly validationResult: WsgsGroundingResult;
  readonly selectedProductIds: readonly string[];
  readonly explicitlyConfirmedProductIds: readonly string[];
  readonly validatedAt: string;
  readonly createdAt: string;
}): OperationalGroundingBundle {
  const result = parseWsgsGroundingResult(input.validationResult);
  if (
    result.status !== "COMPLETED" ||
    result.unresolvedMentions.length > 0 ||
    result.capabilityGaps.length > 0
  ) {
    throw new WorldGroundingRuntimeError("WORLD_GROUNDING_CONTRACT_VIOLATION");
  }
  const selected = new Set(input.selectedProductIds);
  const confirmed = new Set(input.explicitlyConfirmedProductIds);
  if (
    selected.size === 0 ||
    selected.size !== input.selectedProductIds.length
  ) {
    throw new WorldGroundingRuntimeError("WORLD_GROUNDING_CONTRACT_VIOLATION");
  }
  const ambiguousProductIds = new Set(
    result.ambiguities.flatMap(({ candidateProductIds }) =>
      candidateProductIds.filter((productId) => selected.has(productId)),
    ),
  );
  for (const productId of ambiguousProductIds) {
    if (!confirmed.has(productId)) {
      throw new WorldGroundingRuntimeError(
        "WORLD_GROUNDING_CONTRACT_VIOLATION",
      );
    }
  }
  const products = result.referenceProducts.filter(({ productId }) =>
    selected.has(productId),
  );
  if (products.length !== selected.size) {
    throw new WorldGroundingRuntimeError("WORLD_GROUNDING_CONTRACT_VIOLATION");
  }
  return parseOperationalGroundingBundle({
    schemaVersion: "1.0",
    purpose: "SDAR_OPERATION",
    groundingId: result.groundingId,
    groundingResultHash: result.resultHash,
    references: products.map((product) => {
      if (
        product.sourceOperation !== "VALIDATE_REFERENCES" ||
        product.validUntil === undefined ||
        product.revalidationRequired !== false
      ) {
        throw new WorldGroundingRuntimeError(
          "WORLD_GROUNDING_CONTRACT_VIOLATION",
        );
      }
      return {
        productId: product.productId,
        referenceKey: product.referenceKey,
        sourceWorldVersion: product.sourceWorldVersion,
        validUntil: product.validUntil,
        revalidationRequired: false,
        validationStatus: "VALIDATED",
        confirmationStatus: ambiguousProductIds.has(product.productId)
          ? "EXPLICITLY_CONFIRMED"
          : "NOT_REQUIRED",
      };
    }),
    evidenceItemIds: result.evidenceItems.map(
      ({ evidenceProductId }) => evidenceProductId,
    ),
    ambiguityPolicy: {
      outcome:
        ambiguousProductIds.size > 0 ? "EXPLICITLY_CONFIRMED" : "NO_AMBIGUITY",
      autoAcceptSuggestedUnique: false,
    },
    validation: {
      authority: "WSGS",
      operation: "VALIDATE_REFERENCES",
      validatedAt: input.validatedAt,
      validationResultHash: result.resultHash,
    },
    createdAt: input.createdAt,
  });
}

export function renderSafeWorldAnswer(result: WsgsGroundingResult): string {
  const parsed = parseWsgsGroundingResult(result);
  if (parsed.status === "AMBIGUOUS") {
    return [
      "WORLD_GROUNDING_CLARIFICATION_REQUIRED",
      ...parsed.ambiguities.map(
        (ambiguity) =>
          `Ambiguous reference: ` + safeText(ambiguity.surfaceText),
      ),
      "No candidate was selected automatically.",
    ].join("\n");
  }
  if (parsed.status === "UNRESOLVED") {
    return "WSGS could not resolve this world request. No conclusion about absence was made.";
  }
  if (parsed.status === "FAILED") return terminalFailureText("WSGS_FAILED");
  if (parsed.status === "CANCELLED") {
    return "World grounding was cancelled; no world-state conclusion was made.";
  }
  const lines = [
    parsed.status === "PARTIAL"
      ? "WSGS published a partial world-grounding result."
      : "WSGS published a world-grounding result.",
  ];
  for (const reference of parsed.referenceProducts) {
    const summary =
      reference.safeSummary === undefined
        ? ""
        : ` — ` + safeJson(reference.safeSummary);
    lines.push(`Reference: ` + safeText(reference.displayName) + summary);
  }
  for (const evidence of parsed.evidenceItems) {
    if (evidence.upstreamStatus === "NO_DATA") {
      lines.push(
        `Evidence ` +
          safeText(evidence.evidenceProductId) +
          " reported NO_DATA; this does not establish that the requested fact is absent.",
      );
      continue;
    }
    const payload =
      evidence.safePayload === undefined
        ? ""
        : ` — ` + safeJson(evidence.safePayload);
    lines.push(
      `Evidence ` +
        safeText(evidence.evidenceProductId) +
        ` (` +
        evidence.upstreamStatus +
        `)` +
        payload,
    );
  }
  if (
    parsed.referenceProducts.length === 0 &&
    parsed.evidenceItems.length === 0
  ) {
    lines.push(
      "No safe reference or evidence payload was published; this is not evidence of absence.",
    );
  }
  if (parsed.unresolvedMentions.length > 0) {
    lines.push(
      `Unresolved mentions: ` + String(parsed.unresolvedMentions.length) + ".",
    );
  }
  if (parsed.capabilityGaps.length > 0) {
    lines.push(
      `Capability gaps: ` + String(parsed.capabilityGaps.length) + ".",
    );
  }
  lines.push(`Result hash: ` + parsed.resultHash);
  return lines.join("\n").slice(0, 16_000);
}

async function resolveGroundingResult(
  wsgs: WsgsHttpClient,
  request: WsgsGroundingRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<WsgsGroundingResult> {
  const created = await wsgs.createGrounding(request, idempotencyKey, signal);
  if (!("jobId" in created)) return created;
  const job: WsgsGroundingJob =
    created.result === undefined &&
    ![
      "COMPLETED",
      "PARTIAL",
      "AMBIGUOUS",
      "UNRESOLVED",
      "FAILED",
      "CANCELLED",
    ].includes(created.status)
      ? await wsgs.waitForGrounding(created.groundingId, signal)
      : created;
  if (job.result === undefined) {
    throw new WorldGroundingRuntimeError("WORLD_GROUNDING_CONTRACT_VIOLATION");
  }
  return job.result;
}

function createWsgsRequest(input: {
  readonly input: WorldGroundingRuntimeTurn;
  readonly plan: ReturnType<typeof planGroundingRequest>;
  readonly requestId: string;
  readonly createdAt: string;
}): WsgsGroundingRequest {
  return {
    schemaVersion: "1.0",
    requestId: input.requestId,
    operation: input.plan.operation,
    source: {
      conversationRef: input.input.threadId,
      messageId: input.input.externalRequestId,
      originalText: input.input.userText,
      originalTextSha256: `sha256:` + sha256Hex(input.input.userText),
      locale: "und",
      createdAt: input.createdAt,
    },
    requestedProducts: input.plan.requestedProducts,
    contextCapsule: {
      knownWorldReferences: [],
      priorGroundings: [],
      mapSelections: [],
      externalCorrelationHints: [],
      externalPredicates: [],
    },
    executionPolicy: input.plan.executionPolicy,
  };
}

function assertContextAvailable(turnPlan: TurnPlan): void {
  if (Object.values(turnPlan.worldFocusUsage).some(Boolean)) {
    throw new WorldGroundingRuntimeError("WORLD_GROUNDING_CONTEXT_UNAVAILABLE");
  }
}

function assertResultIdentity(
  result: WsgsGroundingResult,
  request: WsgsGroundingRequest,
): void {
  if (
    result.requestId !== request.requestId ||
    result.source.messageId !== request.source.messageId ||
    result.source.originalTextSha256 !== request.source.originalTextSha256
  ) {
    throw new WorldGroundingRuntimeError("WORLD_GROUNDING_CONTRACT_VIOLATION");
  }
}

function stableTurnHash(
  input: WorldGroundingRuntimeTurn,
  turnPlan: TurnPlan,
): string {
  return hashJsonValue({
    protocol: input.protocol,
    principalId: input.principalId,
    threadId: input.threadId,
    externalRequestId: input.externalRequestId,
    userText: input.userText,
    turnPlan,
  });
}

function hashJsonValue(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(asJsonValue(value)))
    .digest("hex");
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[` + value.map(canonicalJson).join(",") + `]`;
  return (
    `{` +
    Object.keys(value)
      .sort()
      .map(
        (key) => JSON.stringify(key) + ":" + canonicalJson(value[key] ?? null),
      )
      .join(",") +
    `}`
  );
}

function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function messageResult(
  stableHash: string,
  response: string,
): CompletedRequestResult {
  const messageId = `world-answer-` + stableHash;
  return {
    kind: "message",
    messageId,
    message: {
      messageId,
      role: "AGENT",
      parts: [{ kind: "text", mediaType: "text/plain", text: response }],
    },
    renderedText: response,
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeText(value: string): string {
  const withoutControlCharacters = Array.from(
    value.replaceAll(/[\\`*_{}[\]()#+.!<>|~-]/gu, " "),
    (character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    },
  ).join("");
  return withoutControlCharacters
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, 2_000);
}

function safeJson(value: JsonValue): string {
  return safeText(JSON.stringify(value)).slice(0, 4_000);
}

function safeRuntimeCode(
  error: unknown,
): WorldGroundingRuntimeCode | undefined {
  if (error instanceof WorldGroundingRuntimeError) return error.code;
  if (error instanceof z.ZodError) {
    return "WORLD_GROUNDING_CONTRACT_VIOLATION";
  }
  if (error instanceof WsgsHttpError) {
    return error.code.includes("CAPABIL")
      ? "WORLD_GROUNDING_CAPABILITY_UNAVAILABLE"
      : error.code.includes("CONTRACT")
        ? "WORLD_GROUNDING_CONTRACT_VIOLATION"
        : "WORLD_GROUNDING_FAILED";
  }
  return undefined;
}

function terminalFailureText(code: string): string {
  if (code === "WORLD_GROUNDING_CONTEXT_UNAVAILABLE") return code;
  if (code === "WORLD_GROUNDING_CAPABILITY_UNAVAILABLE") return code;
  if (code === "WORLD_GROUNDING_CONTRACT_VIOLATION") return code;
  return "WORLD_GROUNDING_FAILED";
}
