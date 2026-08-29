import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "@jest/globals";

import { calculateConsumerLockHash } from "../packages/wsgs-geospatial-consumer/src/index.js";

const root = process.cwd();
const temporaryDirectories: string[] = [];
const servers: Server[] = [];
const wsgsSha = "1234567890abcdef1234567890abcdef12345678";
const gowmSha = "234567890abcdef1234567890abcdef123456789";
const gdpsSha = "34567890abcdef1234567890abcdef1234567890";
const bearer = "test-bearer-must-never-appear";
const transportCases: Array<
  ["REQUESTED_PRODUCTS" | "RESULT_EXTENSION", readonly string[]]
> = [
  ["REQUESTED_PRODUCTS", ["GEOSPATIAL_FINDINGS"]],
  ["RESULT_EXTENSION", []],
];

describe("S24 geospatial require-ready preflight", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => closeServer(server)));
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  it("does not read credentials or send any request for the checked-in BLOCKED lock", async () => {
    const directory = await temporaryDirectory();
    const reportPath = join(directory, "report.json");
    const handoffPath = join(directory, "handoff.env");
    const baseUrl = "http://127.0.0.1:9";
    await writeHandoff(handoffPath, baseUrl);

    const result = await runPreflight({ reportPath, handoffPath });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("SACS_V0_4_GEOSPATIAL_S24_PREFLIGHT_BLOCKED\n");
    await assertSecretsAbsent(result, reportPath, [
      bearer,
      baseUrl,
      handoffPath,
    ]);
    const report = await readReport(reportPath);
    expect(report).toMatchObject({
      status: "BLOCKED",
      authorityGate: {
        consumerLockValidation: "VALID",
        authoritativeLockReady: false,
        provenanceClosureVerified: false,
        liveBusinessRequestsAllowed: false,
      },
      transportConfiguration: {
        source: "NOT_READ_FOR_BLOCKED_LOCK",
        bearerConfigured: false,
        bearerReadInProcessOnly: false,
      },
      execution: {
        readOnlyRequestsAttempted: 0,
        businessPostsAttempted: 0,
        businessPostRefused: true,
        realE2eCasesExecuted: 0,
      },
    });
    expect(report.cases).toHaveLength(18);
    expect(report.cases.every((item) => item.status === "BLOCKED")).toBe(true);
  });

  it("rejects a tampered authoritative lock before reading credentials or issuing GETs", async () => {
    const directory = await temporaryDirectory();
    const reportPath = join(directory, "report.json");
    const lockPath = join(directory, "consumer-lock.json");
    const handoffPath = join(directory, "handoff.env");
    const requests: CapturedRequest[] = [];
    const service = await startService(requests, () => validReadiness());
    const lock = readyLock("REQUESTED_PRODUCTS", ["GEOSPATIAL_FINDINGS"]);
    lock.geospatialProfile.profileSchemaHash = sha("9");
    await writeJson(lockPath, lock);
    await writeHandoff(handoffPath, service.baseUrl);

    const result = await runPreflight({ reportPath, lockPath, handoffPath });

    expect(result.code).toBe(0);
    expect(requests).toHaveLength(0);
    const report = await readReport(reportPath);
    expect(report).toMatchObject({
      status: "BLOCKED",
      blocker: { code: "WSGS_GEOSPATIAL_CONSUMER_LOCK_HASH_MISMATCH" },
      authorityGate: {
        consumerLockValidation: "INVALID",
        consumerLockHashVerified: false,
        authoritativeLockReady: false,
      },
      execution: { readOnlyRequestsAttempted: 0 },
    });
    await assertSecretsAbsent(result, reportPath, [
      bearer,
      service.baseUrl,
      handoffPath,
    ]);
  });

  it("makes --require-ready fail for a BLOCKED lock without issuing any request", async () => {
    const directory = await temporaryDirectory();
    const reportPath = join(directory, "report.json");

    const result = await runPreflight({ reportPath }, true);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("SACS_V0_4_GEOSPATIAL_S24_PREFLIGHT_BLOCKED\n");
    const report = await readReport(reportPath);
    expect(report).toMatchObject({
      status: "BLOCKED",
      execution: {
        readOnlyRequestsAttempted: 0,
        businessPostsAttempted: 0,
        realE2eCasesExecuted: 0,
      },
    });
  });

  it("rejects placeholder profile provenance even when the canonical lock hash is recomputed", async () => {
    const directory = await temporaryDirectory();
    const reportPath = join(directory, "report.json");
    const lockPath = join(directory, "consumer-lock.json");
    const lock = readyLock("RESULT_EXTENSION", []);
    lock.geospatialProfile.profileSchemaHash = sha("0");
    lock.consumerLockHash = calculateConsumerLockHash(lock);
    await writeJson(lockPath, lock);

    const result = await runPreflight({ reportPath, lockPath });

    expect(result.code).toBe(0);
    const report = await readReport(reportPath);
    expect(report).toMatchObject({
      status: "BLOCKED",
      blocker: { code: "WSGS_GEOSPATIAL_CONSUMER_LOCK_INVALID" },
      authorityGate: {
        consumerLockValidation: "INVALID",
        geospatialProfileVerified: false,
        authoritativeLockReady: false,
      },
      execution: { readOnlyRequestsAttempted: 0 },
    });
  });

  it("rejects a running WSGS SHA mismatch before the first GET", async () => {
    const fixture = await readyFixture("REQUESTED_PRODUCTS", [
      "GEOSPATIAL_FINDINGS",
    ]);
    await writeHandoff(fixture.paths.handoffPath, fixture.baseUrl, gdpsSha);

    const result = await runPreflight(fixture.paths);

    expect(result.code).toBe(0);
    expect(fixture.requests).toHaveLength(0);
    const report = await readReport(fixture.paths.reportPath);
    expect(report).toMatchObject({
      status: "BLOCKED",
      blocker: { code: "WSGS_RUNTIME_PROVENANCE_MISMATCH" },
      authorityGate: { provenanceClosureVerified: false },
      execution: { readOnlyRequestsAttempted: 0 },
    });
  });

  it.each([
    ["a non-ready status", { status: "degraded", reasons: [] }],
    ["a non-empty reason list", { status: "ready", reasons: ["MODEL_STALE"] }],
    ["a truthy but invalid body", { ready: true, reasons: [] }],
  ])("rejects HTTP 200 readiness with %s", async (_label, body) => {
    const fixture = await readyFixture("REQUESTED_PRODUCTS", [
      "GEOSPATIAL_FINDINGS",
    ]);
    fixture.respondWith(() => json(body));

    const result = await runPreflight(fixture.paths);

    expect(result.code).toBe(0);
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]).toMatchObject({
      method: "GET",
      path: "/health/ready",
      authorization: `Bearer ${bearer}`,
    });
    const report = await readReport(fixture.paths.reportPath);
    expect(report).toMatchObject({
      status: "BLOCKED",
      blocker: { code: "WSGS_READINESS_BODY_NOT_READY" },
      execution: {
        readOnlyRequestsAttempted: 1,
        businessPostsAttempted: 0,
      },
    });
  });

  it("rejects a non-200 success status even when its readiness body says ready", async () => {
    const fixture = await readyFixture("REQUESTED_PRODUCTS", [
      "GEOSPATIAL_FINDINGS",
    ]);
    fixture.respondWith(() => ({ ...validReadiness(), status: 202 }));

    const result = await runPreflight(fixture.paths);

    expect(result.code).toBe(0);
    expect(fixture.requests).toHaveLength(1);
    const report = await readReport(fixture.paths.reportPath);
    expect(report).toMatchObject({
      status: "BLOCKED",
      blocker: { code: "READ_ONLY_HTTP_STATUS_FAILED" },
      execution: { readOnlyRequestsAttempted: 1 },
    });
  });

  it.each([
    [
      "an extra operation",
      (value: Capabilities) => ({
        ...value,
        supportedOperations: [...value.supportedOperations, "EXTRA_OPERATION"],
      }),
      "WSGS_REQUIRED_OPERATION_SET_MISMATCH",
    ],
    [
      "a reordered operation list",
      (value: Capabilities) => ({
        ...value,
        supportedOperations: [...value.supportedOperations].reverse(),
      }),
      "WSGS_REQUIRED_OPERATION_SET_MISMATCH",
    ],
    [
      "requiredCapabilitiesReady=false",
      (value: Capabilities) => ({
        ...value,
        requiredCapabilitiesReady: false,
      }),
      "WSGS_GEOSPATIAL_REQUIRED_CAPABILITIES_NOT_READY",
    ],
    [
      "a mismatched grounding contract",
      (value: Capabilities) => ({
        ...value,
        contractVersion: "sacs-wsgs-grounding/9.9",
      }),
      "WSGS_GEOSPATIAL_GROUNDING_CONTRACT_MISMATCH",
    ],
    [
      "a mismatched GOWM provenance commit",
      (value: Capabilities) => ({
        ...value,
        gowmContract: { ...value.gowmContract, commit: gdpsSha },
      }),
      "WSGS_GEOSPATIAL_GOWM_COMMIT_MISMATCH",
    ],
    [
      "a missing declared requested product",
      (value: Capabilities) => ({ ...value, supportedProducts: [] }),
      "WSGS_GEOSPATIAL_REQUESTED_PRODUCT_UNAVAILABLE",
    ],
  ])(
    "rejects an otherwise successful capabilities response containing %s",
    async (_label, mutate, expectedCode) => {
      const fixture = await readyFixture("REQUESTED_PRODUCTS", [
        "GEOSPATIAL_FINDINGS",
      ]);
      fixture.respondWith((request) =>
        request.path === "/health/ready"
          ? validReadiness("readiness-id-must-not-persist")
          : json(mutate(validCapabilities(["GEOSPATIAL_FINDINGS"]))),
      );

      const result = await runPreflight(fixture.paths);

      expect(result.code).toBe(0);
      expect(fixture.requests).toHaveLength(2);
      expect(
        fixture.requests.every((request) => request.method === "GET"),
      ).toBe(true);
      expect(
        fixture.requests.every(
          (request) => request.authorization === `Bearer ${bearer}`,
        ),
      ).toBe(true);
      const report = await readReport(fixture.paths.reportPath);
      expect(report).toMatchObject({
        status: "BLOCKED",
        blocker: { code: expectedCode },
        authorityGate: { provenanceClosureVerified: false },
        execution: {
          readOnlyRequestsAttempted: 2,
          businessPostsAttempted: 0,
          realE2eCasesExecuted: 0,
        },
      });
      await assertSecretsAbsent(result, fixture.paths.reportPath, [
        bearer,
        fixture.baseUrl,
        fixture.paths.handoffPath,
        "readiness-id-must-not-persist",
      ]);
    },
  );

  it("rejects a RESULT_EXTENSION capability response without WORLD_EVIDENCE", async () => {
    const fixture = await readyFixture("RESULT_EXTENSION", []);
    fixture.respondWith((request) =>
      request.path === "/health/ready"
        ? validReadiness()
        : json(validCapabilities([])),
    );

    const result = await runPreflight(fixture.paths);

    expect(result.code).toBe(0);
    const report = await readReport(fixture.paths.reportPath);
    expect(report).toMatchObject({
      status: "BLOCKED",
      blocker: {
        code: "WSGS_GEOSPATIAL_RESULT_EXTENSION_TRANSPORT_UNAVAILABLE",
      },
    });
  });

  it("rejects a truthy HTTP 200 capabilities body that is not the strict contract", async () => {
    const fixture = await readyFixture("REQUESTED_PRODUCTS", [
      "GEOSPATIAL_FINDINGS",
    ]);
    fixture.respondWith((request) =>
      request.path === "/health/ready"
        ? validReadiness()
        : json({ requiredCapabilitiesReady: true, ok: true }),
    );

    const result = await runPreflight(fixture.paths);

    expect(result.code).toBe(0);
    expect(fixture.requests).toHaveLength(2);
    const report = await readReport(fixture.paths.reportPath);
    expect(report).toMatchObject({
      status: "BLOCKED",
      blocker: { code: "WSGS_CAPABILITIES_CONTRACT_VIOLATION" },
      execution: {
        readOnlyRequestsAttempted: 2,
        businessPostsAttempted: 0,
      },
    });
  });

  it("rejects redirects and never follows them", async () => {
    const fixture = await readyFixture("REQUESTED_PRODUCTS", [
      "GEOSPATIAL_FINDINGS",
    ]);
    fixture.respondWith(() => ({
      status: 302,
      headers: { location: "/redirected", "content-type": "application/json" },
      body: JSON.stringify({ status: "ready", reasons: [] }),
    }));

    const result = await runPreflight(fixture.paths);

    expect(result.code).toBe(0);
    expect(fixture.requests).toHaveLength(1);
    const report = await readReport(fixture.paths.reportPath);
    expect(report).toMatchObject({
      status: "BLOCKED",
      blocker: { code: "READ_ONLY_REQUEST_FAILED" },
      execution: { redirectsAllowed: false },
    });
  });

  it.each(transportCases)(
    "proves only READY_FOR_REAL_E2E preflight for %s and leaves all 18 cases NOT_RUN",
    async (transportMode, requestedProducts) => {
      const fixture = await readyFixture(transportMode, requestedProducts);
      const products =
        transportMode === "REQUESTED_PRODUCTS"
          ? [...requestedProducts, "WORLD_EVIDENCE"]
          : ["WORLD_EVIDENCE"];
      fixture.respondWith((request) =>
        request.path === "/health/ready"
          ? validReadiness("raw-readiness-id-must-not-persist")
          : json(validCapabilities(products)),
      );

      const result = await runPreflight(fixture.paths, true);

      expect(result.code).toBe(0);
      expect(result.stdout).toBe(
        "SACS_V0_4_GEOSPATIAL_S24_PREFLIGHT_READY_FOR_REAL_E2E\n",
      );
      expect(result.stderr).toBe("");
      expect(
        fixture.requests.map(({ method, path }) => ({ method, path })),
      ).toEqual([
        { method: "GET", path: "/health/ready" },
        { method: "GET", path: "/v1/capabilities" },
      ]);
      const report = await readReport(fixture.paths.reportPath);
      expect(report).toMatchObject({
        status: "READY_FOR_REAL_E2E",
        authorityGate: {
          consumerLockValidation: "VALID",
          consumerLockHashVerified: true,
          authoritativeLockReady: true,
          provenanceClosureVerified: true,
          geospatialProfileVerified: true,
          transportModeVerified: true,
          liveBusinessRequestsAllowed: true,
        },
        execution: {
          mode: "READ_ONLY_REQUIRE_READY_PREFLIGHT",
          readOnlyRequestsAttempted: 2,
          businessPostsAttempted: 0,
          businessPostRefused: true,
          realE2eCasesExecuted: 0,
          responseBodiesPersisted: false,
          credentialsPrintedOrPersisted: false,
          redirectsAllowed: false,
        },
        finalMarker: "SACS_V0_4_WORLD_GROUNDING_GEOSPATIAL_EXPLANATION_BLOCKED",
      });
      expect(report.blocker).toBeUndefined();
      expect(report.cases).toHaveLength(18);
      expect(report.cases.every((item) => item.status === "NOT_RUN")).toBe(
        true,
      );
      expect(
        report.cases.every(
          (item) => item.reasonCode === "PREFLIGHT_ONLY_REAL_E2E_NOT_RUN",
        ),
      ).toBe(true);
      await assertSecretsAbsent(result, fixture.paths.reportPath, [
        bearer,
        fixture.baseUrl,
        fixture.paths.handoffPath,
        "raw-readiness-id-must-not-persist",
      ]);
    },
  );
});

interface CapturedRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization?: string;
}

interface ResponseFixture {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

interface Capabilities {
  readonly service: "world-semantic-grounding-service";
  readonly version: string;
  readonly contractVersion: string;
  readonly supportedOperations: string[];
  readonly supportedProducts: string[];
  readonly gowmContract: {
    readonly softwareVersion: string;
    readonly commit: string;
    readonly sourcePackageArtifacts: number;
  };
  readonly requiredCapabilitiesReady: boolean;
  readonly optionalCapabilities: Array<{
    readonly operationId: string;
    readonly available: boolean;
    readonly reason?: string;
  }>;
}

interface PreflightReport {
  readonly status: string;
  readonly blocker?: { readonly code: string };
  readonly authorityGate: Readonly<Record<string, unknown>>;
  readonly transportConfiguration: Readonly<Record<string, unknown>>;
  readonly execution: Readonly<Record<string, unknown>>;
  readonly cases: Array<{
    readonly caseId: string;
    readonly status: string;
    readonly reasonCode: string;
  }>;
  readonly finalMarker: string;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sacs-s24-preflight-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function readyFixture(
  transportMode: "REQUESTED_PRODUCTS" | "RESULT_EXTENSION",
  requestedProducts: readonly string[],
) {
  const directory = await temporaryDirectory();
  const paths = {
    reportPath: join(directory, "report.json"),
    lockPath: join(directory, "consumer-lock.json"),
    handoffPath: join(directory, "handoff.env"),
  };
  const requests: CapturedRequest[] = [];
  let responder: (request: CapturedRequest) => ResponseFixture = () =>
    validReadiness();
  const service = await startService(requests, (request) => responder(request));
  await writeJson(paths.lockPath, readyLock(transportMode, requestedProducts));
  await writeHandoff(paths.handoffPath, service.baseUrl);
  return {
    ...service,
    paths,
    requests,
    respondWith(value: typeof responder) {
      responder = value;
    },
  };
}

async function startService(
  requests: CapturedRequest[],
  respond: (request: CapturedRequest) => ResponseFixture,
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((request, response) => {
    const captured = {
      method: request.method ?? "UNKNOWN",
      path: request.url ?? "",
      ...(typeof request.headers.authorization === "string"
        ? { authorization: request.headers.authorization }
        : {}),
    };
    requests.push(captured);
    const fixture = respond(captured);
    response.writeHead(fixture.status, fixture.headers);
    response.end(fixture.body);
  });
  servers.push(server);
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not expose a TCP port");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (!server.listening) {
      resolvePromise();
      return;
    }
    server.close((error) =>
      error === undefined ? resolvePromise() : reject(error),
    );
  });
}

function validReadiness(rawId?: string): ResponseFixture {
  return json({
    status: "ready",
    reasons: [],
    ...(rawId === undefined ? {} : { probeId: rawId }),
  });
}

function validCapabilities(supportedProducts: readonly string[]): Capabilities {
  return {
    service: "world-semantic-grounding-service",
    version: "0.2.0-test",
    contractVersion: "sacs-wsgs-grounding/1.0",
    supportedOperations: [
      "GROUND_REFERENCES",
      "COMPILE_WORLD_QUERY",
      "EXECUTE_WORLD_QUERY",
      "VALIDATE_REFERENCES",
    ],
    supportedProducts: [...supportedProducts],
    gowmContract: {
      softwareVersion: "0.6.4-test",
      commit: gowmSha,
      sourcePackageArtifacts: 37,
    },
    requiredCapabilitiesReady: true,
    optionalCapabilities: [],
  };
}

function readyLock(
  transportMode: "REQUESTED_PRODUCTS" | "RESULT_EXTENSION",
  requestedProducts: readonly string[],
) {
  const value = {
    schemaVersion: "sacs-wsgs-geospatial-consumer-lock/1.0",
    provenance: "AUTHORITATIVE_WSGS_HANDOFF",
    sources: { wsgsSha, gowmSha, gdpsSha },
    groundingContract: {
      contractVersion: "sacs-wsgs-grounding/1.0",
      resultSchemaHash: sha("1"),
      capabilitiesSchemaHash: sha("2"),
    },
    geospatialProfile: {
      profile: "sacs-wsgs-geospatial-findings/1.0",
      transportMode,
      profileSchemaHash: sha("3"),
      findingSchemaHash: sha("4"),
      sourceProductSchemaHash: sha("5"),
      gapSchemaHash: sha("6"),
      requestedProducts: [...requestedProducts],
    },
    currentness: {
      mode: "DEDICATED_OPERATION",
      operation: "VALIDATE_REFERENCES",
    },
    status: "READY",
    consumerLockHash: sha("f"),
  };
  return {
    ...value,
    consumerLockHash: calculateConsumerLockHash(value),
  };
}

function sha(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function json(value: unknown): ResponseFixture {
  return {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(value),
  };
}

async function writeHandoff(
  path: string,
  baseUrl: string,
  instanceCommit = wsgsSha,
): Promise<void> {
  await writeFile(
    path,
    [
      `WSGS_BASE_URL=${baseUrl}`,
      `WSGS_BEARER_TOKEN=${bearer}`,
      `WSGS_INSTANCE_COMMIT=${instanceCommit}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, "utf8");
}

async function readReport(path: string): Promise<PreflightReport> {
  return JSON.parse(await readFile(path, "utf8")) as PreflightReport;
}

async function assertSecretsAbsent(
  result: { readonly stdout: string; readonly stderr: string },
  reportPath: string,
  secrets: readonly string[],
): Promise<void> {
  const combined = `${result.stdout}${result.stderr}${await readFile(reportPath, "utf8")}`;
  for (const secret of secrets) expect(combined).not.toContain(secret);
}

function runPreflight(
  paths: {
    readonly reportPath: string;
    readonly lockPath?: string;
    readonly handoffPath?: string;
  },
  requireReady = false,
) {
  return runNode(
    [
      "scripts/phase-v04-s24-geospatial-preflight.mjs",
      ...(requireReady ? ["--require-ready"] : []),
    ],
    {
      SACS_V04_S24_REPORT_PATH: paths.reportPath,
      ...(paths.lockPath === undefined
        ? {}
        : { SACS_V04_S24_CONSUMER_LOCK_PATH: paths.lockPath }),
      ...(paths.handoffPath === undefined
        ? {}
        : { WSGS_HANDOFF_ENV_FILE: paths.handoffPath }),
    },
  );
}

function runNode(args: string[], extraEnvironment: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolvePromise, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: resolve(root),
        env: {
          ...process.env,
          WSGS_BASE_URL: "",
          WSGS_BEARER_TOKEN: "",
          WSGS_INSTANCE_COMMIT: "",
          WSGS_HANDOFF_ENV_FILE: "",
          SACS_V04_S24_CONSUMER_LOCK_PATH: "",
          SACS_V04_S24_REPORT_PATH: "",
          ...extraEnvironment,
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += String(chunk)));
      child.stderr.on("data", (chunk) => (stderr += String(chunk)));
      child.once("error", reject);
      child.once("close", (code) => resolvePromise({ code, stdout, stderr }));
    },
  );
}
