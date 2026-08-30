import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";

import { calculateConsumerLockHash } from "./generate-v04-s14-wsgs-geospatial.mjs";

const REQUIRED_OPERATIONS = [
  "GROUND_REFERENCES",
  "COMPILE_WORLD_QUERY",
  "EXECUTE_WORLD_QUERY",
  "VALIDATE_REFERENCES",
];
const MAX_HANDOFF_BYTES = 65_536;
const MAX_RESPONSE_BYTES = 1_048_576;
const root = process.cwd();
const reportPath = resolve(
  root,
  configuredPath(
    "SACS_V04_S24_REPORT_PATH",
    "reports/v0.4/geospatial/S24-real-e2e.json",
  ),
);
const lockPath = resolve(
  root,
  configuredPath(
    "SACS_V04_S24_CONSUMER_LOCK_PATH",
    "dependencies/wsgs-geospatial-consumer-lock.json",
  ),
);
const lockSchemaPath = resolve(
  root,
  "contracts/generated/wsgs-geospatial/wsgs-geospatial-consumer-lock.schema.json",
);
const corpusPath = resolve(
  root,
  "config/geospatial-explanation/e2e-corpus.json",
);
const requireReady = process.argv.includes("--require-ready");

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const capabilitiesSchema = z.strictObject({
  service: z.literal("world-semantic-grounding-service"),
  version: z.string().min(1).max(128),
  contractVersion: z.string().min(1).max(128),
  supportedOperations: z
    .array(identifier)
    .min(1)
    .max(64)
    .refine((value) => new Set(value).size === value.length),
  supportedProducts: z
    .array(identifier)
    .max(256)
    .refine((value) => new Set(value).size === value.length),
  gowmContract: z.strictObject({
    softwareVersion: z.string().min(1).max(128),
    commit: z.string().regex(/^[0-9a-f]{40}$/u),
    sourcePackageArtifacts: z.number().int().nonnegative().max(100_000),
  }),
  requiredCapabilitiesReady: z.boolean(),
  optionalCapabilities: z
    .array(
      z.strictObject({
        operationId: identifier,
        available: z.boolean(),
        reason: z.string().min(1).max(4_096).optional(),
      }),
    )
    .max(128),
});
const readinessSchema = z.object({
  status: z.literal("ready"),
  reasons: z.array(z.string().max(2_048)).max(128).length(0),
});

await run().catch(async () => {
  await persistReport(
    minimalBlockedReport(
      "S24_PREFLIGHT_INTERNAL_FAILURE",
      "The read-only preflight failed before a safe readiness decision could be produced.",
    ),
  ).catch(() => undefined);
  process.stdout.write("SACS_V0_4_GEOSPATIAL_S24_PREFLIGHT_BLOCKED\n");
  process.exitCode = 1;
});

async function run() {
  const [lockBytes, lockSchemaBytes, corpusBytes] = await Promise.all([
    readFile(lockPath),
    readFile(lockSchemaPath),
    readFile(corpusPath),
  ]);
  const corpus = parseCorpus(corpusBytes);
  const lockValidation = parseConsumerLock(lockBytes, lockSchemaBytes);

  let status = "BLOCKED";
  let blocker = lockValidation.blocker;
  let configuration = emptyTransportConfiguration();
  let provenanceClosureVerified = false;
  let readOnlyRequestsAttempted = 0;
  const readOnlyChecks = [];

  if (lockValidation.authoritativeLockReady) {
    configuration = await loadTransportConfiguration().catch(() =>
      invalidTransportConfiguration("HANDOFF_ENV_FILE_UNAVAILABLE"),
    );
    if (!configuration.baseUrlConfigured || !configuration.bearerConfigured) {
      blocker = safeBlocker(
        "WSGS_TRANSPORT_CONFIGURATION_MISSING",
        "An authoritative lock is present, but the in-process WSGS transport configuration is incomplete.",
      );
    } else if (!configuration.instanceCommitConfigured) {
      blocker = safeBlocker(
        "WSGS_RUNTIME_PROVENANCE_MISSING",
        "The WSGS runtime commit was not supplied by the credential handoff.",
      );
    } else if (
      configuration.instanceCommit !== lockValidation.lock.sources.wsgsSha
    ) {
      blocker = safeBlocker(
        "WSGS_RUNTIME_PROVENANCE_MISMATCH",
        "The running WSGS source identity does not match the authoritative consumer lock.",
      );
    } else {
      const readiness = await safeGetJson(
        "/health/ready",
        "READINESS",
        configuration,
      );
      readOnlyRequestsAttempted += 1;
      const readinessCheck = validateReadiness(readiness);
      readOnlyChecks.push(readinessCheck.safeCheck);
      if (!readinessCheck.ok) {
        blocker = safeBlocker(
          readinessCheck.failureCode,
          "WSGS did not publish an application-level ready state with no reasons.",
        );
      } else {
        const capabilities = await safeGetJson(
          "/v1/capabilities",
          "CAPABILITIES",
          configuration,
        );
        readOnlyRequestsAttempted += 1;
        const capabilitiesCheck = validateCapabilities(
          capabilities,
          lockValidation.lock,
        );
        readOnlyChecks.push(capabilitiesCheck.safeCheck);
        if (capabilitiesCheck.ok) {
          status = "READY_FOR_REAL_E2E";
          blocker = undefined;
          provenanceClosureVerified = true;
        } else {
          blocker = safeBlocker(
            capabilitiesCheck.failureCode,
            "WSGS capabilities did not close the authoritative contract, provenance, operation, and geospatial transport requirements.",
          );
        }
      }
    }
  }

  const report = {
    schemaVersion: "sacs-geospatial-real-e2e-preflight/1.0",
    status,
    ...(blocker === undefined ? {} : { blocker }),
    authorityGate: {
      consumerLockValidation: lockValidation.validationStatus,
      consumerLockStatus: lockValidation.safeStatus,
      consumerLockProvenance: lockValidation.safeProvenance,
      ...(lockValidation.safeConsumerLockHash === undefined
        ? {}
        : { consumerLockHash: lockValidation.safeConsumerLockHash }),
      consumerLockBytesHash: sha256(lockBytes),
      consumerLockHashVerified: lockValidation.hashVerified,
      authoritativeLockReady: lockValidation.authoritativeLockReady,
      provenanceClosureVerified,
      geospatialProfileVerified: lockValidation.profileVerified,
      transportModeVerified: lockValidation.transportVerified,
      liveBusinessRequestsAllowed: status === "READY_FOR_REAL_E2E",
    },
    transportConfiguration: {
      source: configuration.source,
      baseUrlConfigured: configuration.baseUrlConfigured,
      bearerConfigured: configuration.bearerConfigured,
      instanceCommitConfigured: configuration.instanceCommitConfigured,
      bearerReadInProcessOnly: configuration.bearerConfigured,
    },
    execution: {
      mode: "READ_ONLY_REQUIRE_READY_PREFLIGHT",
      readOnlyRequestsAttempted,
      businessPostsAttempted: 0,
      businessPostRefused: true,
      realE2eCasesExecuted: 0,
      responseBodiesPersisted: false,
      credentialsPrintedOrPersisted: false,
      redirectsAllowed: false,
      readOnlyChecks,
    },
    cases: corpus.cases.map((item) => ({
      caseId: item.caseId,
      status: status === "READY_FOR_REAL_E2E" ? "NOT_RUN" : "BLOCKED",
      reasonCode:
        status === "READY_FOR_REAL_E2E"
          ? "PREFLIGHT_ONLY_REAL_E2E_NOT_RUN"
          : (blocker?.code ?? "S24_PREFLIGHT_BLOCKED"),
    })),
    finalMarker: "SACS_V0_4_WORLD_GROUNDING_GEOSPATIAL_EXPLANATION_BLOCKED",
  };

  await persistReport(report);
  process.stdout.write(`SACS_V0_4_GEOSPATIAL_S24_PREFLIGHT_${status}\n`);
  if (requireReady && status !== "READY_FOR_REAL_E2E") process.exitCode = 2;
}

function parseConsumerLock(lockBytes, schemaBytes) {
  let candidate;
  let schema;
  try {
    candidate = JSON.parse(lockBytes.toString("utf8"));
    schema = JSON.parse(schemaBytes.toString("utf8"));
  } catch {
    return invalidLock("WSGS_GEOSPATIAL_CONSUMER_LOCK_INVALID");
  }
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
  }).compile(schema);
  if (!validate(candidate) || !semanticLockClosure(candidate)) {
    return invalidLock("WSGS_GEOSPATIAL_CONSUMER_LOCK_INVALID");
  }
  const calculatedHash = calculateConsumerLockHash(candidate);
  if (candidate.consumerLockHash !== calculatedHash) {
    return invalidLock("WSGS_GEOSPATIAL_CONSUMER_LOCK_HASH_MISMATCH");
  }
  const authoritativeLockReady =
    candidate.status === "READY" &&
    candidate.provenance === "AUTHORITATIVE_WSGS_HANDOFF";
  return {
    lock: candidate,
    validationStatus: "VALID",
    safeStatus: candidate.status,
    safeProvenance: candidate.provenance,
    safeConsumerLockHash: candidate.consumerLockHash,
    hashVerified: true,
    authoritativeLockReady,
    profileVerified:
      authoritativeLockReady &&
      candidate.geospatialProfile.profile ===
        "sacs-wsgs-geospatial-findings/1.0" &&
      !isZeroHash(candidate.geospatialProfile.profileSchemaHash) &&
      !isZeroHash(candidate.geospatialProfile.findingSchemaHash) &&
      !isZeroHash(candidate.geospatialProfile.sourceProductSchemaHash) &&
      !isZeroHash(candidate.geospatialProfile.gapSchemaHash),
    transportVerified:
      authoritativeLockReady &&
      ["REQUESTED_PRODUCTS", "RESULT_EXTENSION"].includes(
        candidate.geospatialProfile.transportMode,
      ),
    blocker: authoritativeLockReady
      ? undefined
      : safeBlocker(
          "AUTHORITATIVE_WSGS_GEOSPATIAL_HANDOFF_MISSING",
          "The checked-in WSGS geospatial consumer lock is valid but is not an authoritative READY handoff.",
        ),
  };
}

function semanticLockClosure(value) {
  if (value.status === "READY") {
    if (
      value.provenance !== "AUTHORITATIVE_WSGS_HANDOFF" ||
      value.blocker !== undefined ||
      value.geospatialProfile.transportMode === "UNRESOLVED" ||
      isZeroHash(value.groundingContract.resultSchemaHash) ||
      isZeroHash(value.groundingContract.capabilitiesSchemaHash) ||
      isZeroHash(value.geospatialProfile.profileSchemaHash) ||
      isZeroHash(value.geospatialProfile.findingSchemaHash) ||
      isZeroHash(value.geospatialProfile.sourceProductSchemaHash) ||
      isZeroHash(value.geospatialProfile.gapSchemaHash) ||
      Object.values(value.sources).some(isZeroSha)
    ) {
      return false;
    }
  } else if (
    value.blocker === undefined ||
    value.geospatialProfile.transportMode !== "UNRESOLVED" ||
    value.geospatialProfile.requestedProducts.length !== 0 ||
    value.currentness.mode !== "UNSUPPORTED"
  ) {
    return false;
  }
  if (
    value.geospatialProfile.transportMode === "REQUESTED_PRODUCTS" &&
    value.geospatialProfile.requestedProducts.length === 0
  ) {
    return false;
  }
  if (
    value.geospatialProfile.transportMode !== "REQUESTED_PRODUCTS" &&
    value.geospatialProfile.requestedProducts.length !== 0
  ) {
    return false;
  }
  const currentness = value.currentness;
  return (
    (currentness.mode === "DEDICATED_OPERATION" &&
      typeof currentness.operation === "string" &&
      currentness.profile === undefined) ||
    (currentness.mode === "EXECUTE_WORLD_QUERY_PROFILE" &&
      typeof currentness.profile === "string" &&
      currentness.operation === undefined) ||
    (currentness.mode === "UNSUPPORTED" &&
      currentness.operation === undefined &&
      currentness.profile === undefined)
  );
}

function invalidLock(code) {
  return {
    lock: undefined,
    validationStatus: "INVALID",
    safeStatus: "INVALID",
    safeProvenance: "INVALID",
    safeConsumerLockHash: undefined,
    hashVerified: false,
    authoritativeLockReady: false,
    profileVerified: false,
    transportVerified: false,
    blocker: safeBlocker(
      code,
      "The WSGS geospatial consumer lock failed strict schema, semantic, or canonical hash validation.",
    ),
  };
}

function parseCorpus(bytes) {
  const value = JSON.parse(bytes.toString("utf8"));
  if (
    value === null ||
    typeof value !== "object" ||
    !Array.isArray(value.cases) ||
    value.cases.length !== 18 ||
    !value.cases.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof item.caseId === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(item.caseId),
    ) ||
    new Set(value.cases.map((item) => item.caseId)).size !== 18
  ) {
    throw new Error("S24_CORPUS_INVALID");
  }
  return value;
}

async function loadTransportConfiguration() {
  let source = "NONE";
  const values = {};
  const handoffPath = process.env.WSGS_HANDOFF_ENV_FILE;
  if (typeof handoffPath === "string" && handoffPath.length > 0) {
    source = "HANDOFF_ENV_FILE";
    const handoffBytes = await readFile(handoffPath);
    if (handoffBytes.length > MAX_HANDOFF_BYTES) {
      return invalidTransportConfiguration(source);
    }
    for (const line of handoffBytes.toString("utf8").split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      if (
        ![
          "WSGS_BASE_URL",
          "WSGS_BEARER_TOKEN",
          "WSGS_INSTANCE_COMMIT",
        ].includes(key)
      ) {
        continue;
      }
      let value = trimmed.slice(separator + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
  }
  for (const key of [
    "WSGS_BASE_URL",
    "WSGS_BEARER_TOKEN",
    "WSGS_INSTANCE_COMMIT",
  ]) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      source = source === "NONE" ? "PROCESS_ENV" : "PROCESS_ENV_OVERRIDE";
      values[key] = value;
    }
  }
  const baseUrl = validateBaseUrl(values.WSGS_BASE_URL);
  const bearer = normalizedSecret(values.WSGS_BEARER_TOKEN);
  const instanceCommit = validateGitSha(values.WSGS_INSTANCE_COMMIT);
  return {
    source,
    baseUrl,
    bearer,
    instanceCommit,
    baseUrlConfigured: baseUrl !== undefined,
    bearerConfigured: bearer !== undefined,
    instanceCommitConfigured: instanceCommit !== undefined,
  };
}

function emptyTransportConfiguration() {
  return invalidTransportConfiguration("NOT_READ_FOR_BLOCKED_LOCK");
}

function invalidTransportConfiguration(source) {
  return {
    source,
    baseUrl: undefined,
    bearer: undefined,
    instanceCommit: undefined,
    baseUrlConfigured: false,
    bearerConfigured: false,
    instanceCommitConfigured: false,
  };
}

function validateBaseUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function normalizedSecret(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 16_384
    ? value
    : undefined;
}

function validateGitSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value)
    ? value
    : undefined;
}

async function safeGetJson(path, requestKind, configuration) {
  try {
    const response = await fetch(new URL(path, configuration.baseUrl), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${configuration.bearer}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return failedReadOnlyResponse(
        requestKind,
        response.status,
        "READ_ONLY_RESPONSE_NOT_JSON",
      );
    }
    const body = await readBoundedBody(response);
    if (response.status !== 200) {
      return {
        ...failedReadOnlyResponse(
          requestKind,
          response.status,
          "READ_ONLY_HTTP_STATUS_FAILED",
        ),
        bodySha256: sha256(body),
      };
    }
    let value;
    try {
      value = JSON.parse(body.toString("utf8"));
    } catch {
      return {
        ...failedReadOnlyResponse(
          requestKind,
          response.status,
          "READ_ONLY_RESPONSE_INVALID_JSON",
        ),
        bodySha256: sha256(body),
      };
    }
    return {
      requestKind,
      transportOk: true,
      httpStatus: response.status,
      bodySha256: sha256(body),
      value,
    };
  } catch {
    return {
      requestKind,
      transportOk: false,
      failureCode: "READ_ONLY_REQUEST_FAILED",
    };
  }
}

async function readBoundedBody(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("READ_ONLY_RESPONSE_TOO_LARGE");
  }
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        throw new Error("READ_ONLY_RESPONSE_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

function failedReadOnlyResponse(requestKind, httpStatus, failureCode) {
  return {
    requestKind,
    transportOk: false,
    httpStatus,
    failureCode,
  };
}

function validateReadiness(result) {
  if (!result.transportOk) {
    return failedSemanticCheck(result, result.failureCode);
  }
  const parsed = readinessSchema.safeParse(result.value);
  if (!parsed.success) {
    return failedSemanticCheck(result, "WSGS_READINESS_BODY_NOT_READY");
  }
  return {
    ok: true,
    safeCheck: safeSemanticCheck(result, "READY"),
  };
}

function validateCapabilities(result, lock) {
  if (!result.transportOk) {
    return failedSemanticCheck(result, result.failureCode);
  }
  const parsed = capabilitiesSchema.safeParse(result.value);
  if (!parsed.success) {
    return failedSemanticCheck(result, "WSGS_CAPABILITIES_CONTRACT_VIOLATION");
  }
  const capabilities = parsed.data;
  if (capabilities.contractVersion !== lock.groundingContract.contractVersion) {
    return failedSemanticCheck(
      result,
      "WSGS_GEOSPATIAL_GROUNDING_CONTRACT_MISMATCH",
    );
  }
  if (!capabilities.requiredCapabilitiesReady) {
    return failedSemanticCheck(
      result,
      "WSGS_GEOSPATIAL_REQUIRED_CAPABILITIES_NOT_READY",
    );
  }
  if (!arraysEqual(capabilities.supportedOperations, REQUIRED_OPERATIONS)) {
    return failedSemanticCheck(result, "WSGS_REQUIRED_OPERATION_SET_MISMATCH");
  }
  if (capabilities.gowmContract.commit !== lock.sources.gowmSha) {
    return failedSemanticCheck(result, "WSGS_GEOSPATIAL_GOWM_COMMIT_MISMATCH");
  }
  const transportMode = lock.geospatialProfile.transportMode;
  const requiredProducts =
    transportMode === "REQUESTED_PRODUCTS"
      ? lock.geospatialProfile.requestedProducts
      : ["WORLD_EVIDENCE"];
  if (
    requiredProducts.some(
      (product) => !capabilities.supportedProducts.includes(product),
    )
  ) {
    return failedSemanticCheck(
      result,
      transportMode === "REQUESTED_PRODUCTS"
        ? "WSGS_GEOSPATIAL_REQUESTED_PRODUCT_UNAVAILABLE"
        : "WSGS_GEOSPATIAL_RESULT_EXTENSION_TRANSPORT_UNAVAILABLE",
    );
  }
  if (
    lock.currentness.mode === "DEDICATED_OPERATION" &&
    !capabilities.supportedOperations.includes(lock.currentness.operation)
  ) {
    return failedSemanticCheck(
      result,
      "WSGS_GEOSPATIAL_CURRENTNESS_OPERATION_UNAVAILABLE",
    );
  }
  return {
    ok: true,
    safeCheck: safeSemanticCheck(result, "CONTRACT_AND_PROVENANCE_MATCH"),
  };
}

function failedSemanticCheck(result, failureCode) {
  return {
    ok: false,
    failureCode,
    safeCheck: {
      ...safeTransportFields(result),
      ok: false,
      failureCode,
    },
  };
}

function safeSemanticCheck(result, semanticStatus) {
  return {
    ...safeTransportFields(result),
    ok: true,
    semanticStatus,
  };
}

function safeTransportFields(result) {
  return {
    requestKind: result.requestKind,
    ...(typeof result.httpStatus === "number"
      ? { httpStatus: result.httpStatus }
      : {}),
    ...(typeof result.bodySha256 === "string"
      ? { bodySha256: result.bodySha256 }
      : {}),
  };
}

function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function safeBlocker(code, safeDetail) {
  return { code, safeDetail };
}

function isZeroHash(value) {
  return value === `sha256:${"0".repeat(64)}`;
}

function isZeroSha(value) {
  return value === "0".repeat(40);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function persistReport(report) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify(report, undefined, 2)}\n`,
    "utf8",
  );
}

function minimalBlockedReport(code, safeDetail) {
  return {
    schemaVersion: "sacs-geospatial-real-e2e-preflight/1.0",
    status: "BLOCKED",
    blocker: safeBlocker(code, safeDetail),
    authorityGate: {
      consumerLockValidation: "UNKNOWN",
      authoritativeLockReady: false,
      provenanceClosureVerified: false,
      liveBusinessRequestsAllowed: false,
    },
    transportConfiguration: {
      source: "NOT_READ",
      baseUrlConfigured: false,
      bearerConfigured: false,
      instanceCommitConfigured: false,
      bearerReadInProcessOnly: false,
    },
    execution: {
      mode: "READ_ONLY_REQUIRE_READY_PREFLIGHT",
      readOnlyRequestsAttempted: 0,
      businessPostsAttempted: 0,
      businessPostRefused: true,
      realE2eCasesExecuted: 0,
      responseBodiesPersisted: false,
      credentialsPrintedOrPersisted: false,
      redirectsAllowed: false,
      readOnlyChecks: [],
    },
    cases: [],
    finalMarker: "SACS_V0_4_WORLD_GROUNDING_GEOSPATIAL_EXPLANATION_BLOCKED",
  };
}

function configuredPath(name, fallback) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : fallback;
}
