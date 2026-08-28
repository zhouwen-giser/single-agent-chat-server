import { z } from "zod";

import {
  wsgsOperations,
  wsgsRequestedProducts,
} from "../../world-grounding-contract/src/index.js";

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const dateTime = z.iso.datetime();
const textSpan = z.strictObject({
  encoding: z.literal("UTF16_CODE_UNIT"),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
const worldFocusArrays = z.strictObject({
  knownWorldReferences: z.array(z.unknown()).max(64),
  priorGroundings: z.array(z.unknown()).max(16),
  mapSelections: z.array(z.unknown()).max(32),
  externalCorrelationHints: z.array(z.unknown()).max(32),
  externalPredicates: z.array(z.unknown()).max(32),
});
const groundingRequestSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  requestId: identifier,
  operation: z.enum(wsgsOperations),
  source: z.strictObject({
    conversationRef: identifier,
    messageId: identifier,
    originalText: z.string().min(1).max(32_768),
    originalTextSha256: sha256,
    locale: z.string().min(2).max(32),
    createdAt: dateTime,
    focusSpans: z.array(textSpan).max(32).optional(),
  }),
  requestedProducts: z
    .array(z.enum(wsgsRequestedProducts))
    .min(1)
    .max(16)
    .refine((value) => new Set(value).size === value.length),
  contextCapsule: worldFocusArrays,
  hints: z
    .strictObject({
      mentionHints: z
        .array(
          z.strictObject({
            surfaceText: z.string().max(512),
            span: textSpan.optional(),
            expectedKinds: z.array(z.string().max(128)).max(32).optional(),
            semanticRole: z.string().max(64).optional(),
          }),
        )
        .max(32)
        .optional(),
    })
    .optional(),
  executionPolicy: z.strictObject({
    readOnly: z.literal(true),
    deadlineMs: z.number().int().min(100).max(120_000),
    maxQueryOperations: z.number().int().min(1).max(64),
    maxCandidatesPerMention: z.number().int().min(1).max(20),
    maxResultBytes: z.number().int().min(1_024).max(67_108_864),
    allowApproximation: z.boolean(),
  }),
});

const errorStage = z.enum([
  "REQUEST_VALIDATION",
  "CONTEXT_LOADING",
  "DETERMINISTIC_PARSING",
  "SEMANTIC_MODEL",
  "SEMANTIC_MERGE",
  "REFERENCE_GROUNDING",
  "QUERY_COMPILATION",
  "GOWM_EXECUTION",
  "RESULT_NORMALIZATION",
  "PERSISTENCE",
]);
const safeError = z.strictObject({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(4_096),
  retryable: z.boolean(),
  stage: errorStage,
  details: z.record(z.string(), z.unknown()).optional(),
});
const terminalStatus = z.enum([
  "COMPLETED",
  "PARTIAL",
  "AMBIGUOUS",
  "UNRESOLVED",
  "FAILED",
  "CANCELLED",
]);
const groundingResultSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  requestId: identifier,
  groundingId: identifier,
  status: terminalStatus,
  source: z.strictObject({
    messageId: identifier,
    originalTextSha256: sha256,
  }),
  mentions: z.array(z.unknown()).max(32),
  semanticFrame: z.unknown().optional(),
  groundingGraph: z.unknown().optional(),
  referenceProducts: z.array(z.unknown()).max(1_000),
  evidenceItems: z.array(z.unknown()).max(1_000),
  gowmQueries: z.array(z.unknown()).max(64).optional(),
  ambiguities: z.array(z.unknown()).max(32),
  unresolvedMentions: z.array(z.unknown()).max(32),
  capabilityGaps: z.array(z.unknown()).max(64),
  warnings: z.array(z.string().max(4_096)).max(256),
  execution: z.strictObject({
    parserVersion: z.string(),
    semanticModelReceiptIds: z.array(z.string()).max(16),
    queryCompilerVersion: z.string(),
    normalizerVersion: z.string(),
    elapsedMs: z.number().nonnegative(),
  }),
  validUntil: dateTime.optional(),
  resultHash: sha256,
  error: safeError.optional(),
});
const groundingJobSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  jobId: identifier,
  groundingId: identifier,
  requestId: identifier,
  status: z.enum([
    "ACCEPTED",
    "RUNNING",
    "COMPLETED",
    "PARTIAL",
    "AMBIGUOUS",
    "UNRESOLVED",
    "FAILED",
    "CANCELLED",
  ]),
  createdAt: dateTime,
  updatedAt: dateTime,
  startedAt: dateTime.optional(),
  finishedAt: dateTime.optional(),
  result: groundingResultSchema.optional(),
  error: safeError.optional(),
});
const capabilitiesSchema = z.strictObject({
  service: z.literal("world-semantic-grounding-service"),
  version: z.literal("0.1.0"),
  contractVersion: z.literal("sacs-wsgs-grounding/1.0"),
  supportedOperations: z.array(z.string()),
  supportedProducts: z.array(z.string()),
  gowmContract: z.strictObject({
    softwareVersion: z.literal("0.4.0"),
    commit: z.literal("db575f79c874a69f65a2043a7e463338524b713d"),
    sourcePackageArtifacts: z.literal(33),
  }),
  requiredCapabilitiesReady: z.boolean(),
  optionalCapabilities: z.array(
    z.strictObject({
      operationId: z.string(),
      available: z.boolean(),
      reason: z.string().optional(),
    }),
  ),
});
const protocolErrorSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  requestId: identifier,
  error: safeError,
});

const configSchema = z.strictObject({
  baseUrl: z.string().url(),
  operationTimeoutMs: z.number().int().min(100).max(120_000).default(30_000),
  pollIntervalMs: z.number().int().min(10).max(10_000).default(250),
  maxPollAttempts: z.number().int().min(1).max(1_000).default(240),
  maxResponseBytes: z
    .number()
    .int()
    .min(1_024)
    .max(67_108_864)
    .default(16_777_216),
  bearerToken: z.string().min(1).max(16_384).optional(),
});

const forbiddenAuthorityFields = new Set([
  "servicePrincipalId",
  "service_principal_id",
  "principalId",
  "principal_id",
  "actorId",
  "actor_id",
  "actor",
  "dataScopes",
  "data_scopes",
  "dataScope",
  "data_scope",
  "datasetScopes",
  "dataset_scopes",
  "datasetScope",
  "dataset_scope",
  "permissions",
  "authorization",
  "accessToken",
  "access_token",
  "token",
]);
const forbiddenDecisionFields = new Set([
  "intent",
  "route",
  "shouldAnswer",
  "shouldForwardToSdar",
  "shouldCreateTask",
  "operationalBindings",
]);
const terminalStatuses = new Set([
  "COMPLETED",
  "PARTIAL",
  "AMBIGUOUS",
  "UNRESOLVED",
  "FAILED",
  "CANCELLED",
]);

export type WsgsGroundingRequest = z.infer<typeof groundingRequestSchema>;
export type WsgsGroundingResult = z.infer<typeof groundingResultSchema>;
export type WsgsGroundingJob = z.infer<typeof groundingJobSchema>;
export type WsgsCapabilities = z.infer<typeof capabilitiesSchema>;

export interface WsgsHttpAdapterConfig {
  readonly baseUrl: string;
  readonly operationTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly maxPollAttempts?: number;
  readonly maxResponseBytes?: number;
  readonly bearerToken?: string;
  readonly fetchImpl?: typeof fetch;
  readonly sleepImpl?: (milliseconds: number) => Promise<void>;
}

export interface WsgsHttpClient {
  readonly contractVersion: "sacs-wsgs-grounding/1.0";
  readonly endpoint: string;
  capabilities(signal?: AbortSignal): Promise<WsgsCapabilities>;
  createGrounding(
    request: WsgsGroundingRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<WsgsGroundingResult | WsgsGroundingJob>;
  getGrounding(
    groundingId: string,
    signal?: AbortSignal,
  ): Promise<WsgsGroundingJob>;
  waitForGrounding(
    groundingId: string,
    signal?: AbortSignal,
  ): Promise<WsgsGroundingJob>;
  cancelGrounding(
    groundingId: string,
    signal?: AbortSignal,
  ): Promise<WsgsGroundingJob>;
}

export class WsgsHttpError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode?: number,
    readonly retryable = false,
    readonly stage?: string,
  ) {
    super(`WSGS request failed: ${code}`);
  }
}

export function parseWsgsHttpConfig(
  environment: NodeJS.ProcessEnv,
): WsgsHttpAdapterConfig {
  const parsed = z
    .object({
      WSGS_BASE_URL: z.string().url().default("http://127.0.0.1:8080"),
      WSGS_OPERATION_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(100)
        .max(120_000)
        .default(30_000),
      WSGS_POLL_INTERVAL_MS: z.coerce
        .number()
        .int()
        .min(10)
        .max(10_000)
        .default(250),
      WSGS_MAX_POLL_ATTEMPTS: z.coerce
        .number()
        .int()
        .min(1)
        .max(1_000)
        .default(240),
      WSGS_MAX_RESPONSE_BYTES: z.coerce
        .number()
        .int()
        .min(1_024)
        .max(67_108_864)
        .default(16_777_216),
      WSGS_BEARER_TOKEN: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.string().optional(),
      ),
    })
    .parse(environment);
  return {
    baseUrl: parsed.WSGS_BASE_URL,
    operationTimeoutMs: parsed.WSGS_OPERATION_TIMEOUT_MS,
    pollIntervalMs: parsed.WSGS_POLL_INTERVAL_MS,
    maxPollAttempts: parsed.WSGS_MAX_POLL_ATTEMPTS,
    maxResponseBytes: parsed.WSGS_MAX_RESPONSE_BYTES,
    ...(parsed.WSGS_BEARER_TOKEN === undefined
      ? {}
      : { bearerToken: parsed.WSGS_BEARER_TOKEN }),
  };
}

export function createWsgsHttpClient(
  input: WsgsHttpAdapterConfig,
): WsgsHttpClient {
  const parsed = configSchema.parse({
    baseUrl: input.baseUrl,
    operationTimeoutMs: input.operationTimeoutMs,
    pollIntervalMs: input.pollIntervalMs,
    maxPollAttempts: input.maxPollAttempts,
    maxResponseBytes: input.maxResponseBytes,
    bearerToken: input.bearerToken,
  });
  const endpoint = normalizedEndpoint(parsed.baseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleepImpl =
    input.sleepImpl ??
    ((milliseconds: number) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));

  async function request(
    method: "GET" | "POST",
    path: string,
    options: {
      body?: unknown;
      idempotencyKey?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<{ status: number; value: unknown }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined)
      headers["content-type"] = "application/json";
    if (options.idempotencyKey !== undefined) {
      headers["idempotency-key"] = requiredIdentifier(
        options.idempotencyKey,
        "idempotencyKey",
      );
      headers["prefer"] = "respond-async";
    }
    if (parsed.bearerToken !== undefined) {
      headers["authorization"] = `Bearer ${parsed.bearerToken}`;
    }
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, endpoint), {
        method,
        headers,
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
        signal: operationSignal(parsed.operationTimeoutMs, options.signal),
      });
    } catch {
      throw new WsgsHttpError("WSGS_TRANSPORT_ERROR", undefined, true);
    }
    const value = await readBoundedJson(response, parsed.maxResponseBytes);
    if (!response.ok) throw protocolFailure(response.status, value);
    return { status: response.status, value };
  }

  return {
    contractVersion: "sacs-wsgs-grounding/1.0",
    endpoint: endpoint.href,
    async capabilities(signal) {
      const response = await request("GET", "/v1/capabilities", { signal });
      const capabilities = parseContract(
        capabilitiesSchema,
        response.value,
        "WSGS_CAPABILITIES_CONTRACT_VIOLATION",
      );
      const missing = wsgsOperations.filter(
        (operation) => !capabilities.supportedOperations.includes(operation),
      );
      if (missing.length > 0) {
        throw new WsgsHttpError("WSGS_REQUIRED_OPERATION_UNAVAILABLE");
      }
      return capabilities;
    },
    async createGrounding(requestBody, idempotencyKey, signal) {
      const body = groundingRequestSchema.parse(requestBody);
      assertNoForbiddenFields(body, forbiddenAuthorityFields);
      const response = await request("POST", "/v1/groundings", {
        body,
        idempotencyKey,
        signal,
      });
      if (response.status === 200) {
        const result = parseContract(
          groundingResultSchema,
          response.value,
          "WSGS_RESULT_CONTRACT_VIOLATION",
        );
        assertNoForbiddenFields(result, forbiddenDecisionFields);
        return result;
      }
      if (response.status === 202) {
        const job = parseContract(
          groundingJobSchema,
          response.value,
          "WSGS_JOB_CONTRACT_VIOLATION",
        );
        assertNoForbiddenFields(job, forbiddenDecisionFields);
        return job;
      }
      throw new WsgsHttpError("WSGS_UNEXPECTED_CREATE_STATUS", response.status);
    },
    async getGrounding(groundingId, signal) {
      const response = await request(
        "GET",
        `/v1/groundings/${encodeURIComponent(
          requiredIdentifier(groundingId, "groundingId"),
        )}`,
        { signal },
      );
      const job = parseContract(
        groundingJobSchema,
        response.value,
        "WSGS_JOB_CONTRACT_VIOLATION",
      );
      assertNoForbiddenFields(job, forbiddenDecisionFields);
      return job;
    },
    async waitForGrounding(groundingId, signal) {
      for (let attempt = 0; attempt < parsed.maxPollAttempts; attempt += 1) {
        const job = await this.getGrounding(groundingId, signal);
        if (terminalStatuses.has(job.status)) return job;
        await sleepImpl(parsed.pollIntervalMs);
      }
      throw new WsgsHttpError("WSGS_POLL_LIMIT_EXCEEDED", undefined, true);
    },
    async cancelGrounding(groundingId, signal) {
      const response = await request(
        "POST",
        `/v1/groundings/${encodeURIComponent(
          requiredIdentifier(groundingId, "groundingId"),
        )}:cancel`,
        { signal },
      );
      return parseContract(
        groundingJobSchema,
        response.value,
        "WSGS_JOB_CONTRACT_VIOLATION",
      );
    },
  };
}

function normalizedEndpoint(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("WSGS base URL must use http or https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "WSGS base URL must not contain credentials, query, or hash",
    );
  }
  url.pathname = "/";
  return url;
}

function operationSignal(
  timeoutMs: number,
  supplied: AbortSignal | undefined,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return supplied === undefined
    ? timeout
    : AbortSignal.any([supplied, timeout]);
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    throw new WsgsHttpError("WSGS_RESPONSE_TOO_LARGE", response.status);
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new WsgsHttpError("WSGS_RESPONSE_TOO_LARGE", response.status);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WsgsHttpError("WSGS_INVALID_JSON_RESPONSE", response.status);
  }
}

function protocolFailure(status: number, value: unknown): WsgsHttpError {
  const parsed = protocolErrorSchema.safeParse(value);
  if (!parsed.success) {
    return new WsgsHttpError("WSGS_HTTP_ERROR", status, status >= 500);
  }
  return new WsgsHttpError(
    parsed.data.error.code,
    status,
    parsed.data.error.retryable,
    parsed.data.error.stage,
  );
}

function parseContract<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new WsgsHttpError(code);
  return parsed.data;
}

function requiredIdentifier(value: string, label: string): string {
  const parsed = identifier.safeParse(value);
  if (!parsed.success) throw new Error(`${label} is invalid`);
  return parsed.data;
}

function assertNoForbiddenFields(
  value: unknown,
  forbidden: ReadonlySet<string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenFields(item, forbidden);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) {
      throw new WsgsHttpError("WSGS_FORBIDDEN_AUTHORITY_FIELD");
    }
    assertNoForbiddenFields(child, forbidden);
  }
}
