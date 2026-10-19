import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const hash = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const privatePath = process.env.SACS_V06_INTEGRATION_ENV;
assert.ok(
  privatePath,
  "SACS_V06_INTEGRATION_ENV must name a private configuration file",
);
const config = parseEnv(await readFile(privatePath, "utf8"));
assert.equal(
  config.ALLOW_REAL_WSGS,
  "YES",
  "Explicit real-analysis opt-in required",
);
const endpoint = new URL(config.WSGS_BASE_URL);
assert.ok(["http:", "https:"].includes(endpoint.protocol));
assert.ok(
  !(endpoint.username || endpoint.password || endpoint.search || endpoint.hash),
  "Endpoint must not embed credentials, query or fragment",
);
const output = resolve(
  process.env.SACS_V06_EVIDENCE_DIR ?? "reports/v0.6/real-integration-20260909",
);
const operationTimeoutMs = Number(config.WSGS_OPERATION_TIMEOUT_MS ?? "30000");
const preflightTimeoutMs = Number(
  config.SACS_V06_PREFLIGHT_TIMEOUT_MS ?? "45000",
);
for (const timeout of [operationTimeoutMs, preflightTimeoutMs]) {
  assert.ok(Number.isInteger(timeout) && timeout >= 100 && timeout <= 120000);
}
assert.ok(
  !config.SACS_V06_PREFLIGHT_VERSION ||
    config.SACS_V06_PREFLIGHT_VERSION === "1.2",
);
const preflightVersions = config.SACS_V06_PREFLIGHT_VERSION
  ? ["1.2"]
  : ["1.0", "1.1", "1.2"];
await mkdir(output, { recursive: true });
// Reserve this attempt before any network request; never overwrite old evidence.
await (
  await open(resolve(output, "INTEGRATION_EVIDENCE.json"), "wx", 0o600)
).close();
const maxCases = Number(config.SACS_V06_MAX_CASES ?? "6");
assert.ok(Number.isInteger(maxCases) && maxCases >= 1 && maxCases <= 6);
assert.ok(
  !config.SACS_V06_QUERY_TEXT || config.SACS_V06_QUERY_TEXT.length <= 32768,
);
const evidence = {
  schemaVersion: "sacs-v06-real-integration/1.0",
  startedAt: new Date().toISOString(),
  sourceSha: git("rev-parse", "HEAD"),
  sourceDiffHash: hash(git("diff", "HEAD")),
  entrypointHash: hash(await readFile(new URL(import.meta.url))),
  endpointOrigin: endpoint.origin,
  mode: "REAL",
  operationTimeoutMs,
  preflightTimeoutMs,
  preflightVersions,
  clientObservationTimeoutMs: operationTimeoutMs + 120000 + 30000,
  readiness: [],
  exchanges: [],
  cases: [],
  status: "NOT_RUN",
  nonClaims: ["DEVICE_EXECUTION", "PRODUCTION_RELEASE", "MODEL_QUALITY"],
};
let container;
let server;
let persistence;
let composition;
const save = async () => {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(
    resolve(output, "INTEGRATION_EVIDENCE.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
};
const headers = (version) => ({
  "wsgs-contract-version": `sacs-wsgs-grounding/${version}`,
  ...(version === "1.0"
    ? {}
    : {
        "wsgs-result-profile":
          version === "1.2"
            ? "wsgs-world-analysis-findings/1.0"
            : "sacs-wsgs-geospatial-findings/1.0",
      }),
});
const realFetch = async (url, init) => {
  const target = new URL(String(url));
  assert.equal(
    target.origin,
    endpoint.origin,
    "Unexpected SACS upstream destination",
  );
  let requestDeadlineMs;
  if (init?.method === "POST" && target.pathname === "/v1/groundings") {
    requestDeadlineMs = JSON.parse(init.body).executionPolicy.deadlineMs;
    assert.equal(
      requestDeadlineMs,
      120_000,
      "Retest must send the 120-second deadline",
    );
  }
  const started = Date.now();
  const response = await fetch(url, { ...init, redirect: "error" });
  const bytes = await response.clone().text();
  let summary = {};
  try {
    const body = JSON.parse(bytes);
    const result = body.result ?? body;
    const component =
      result.worldAnalysisFindings ?? result.extensions?.worldAnalysisFindings;
    summary = {
      groundingIdHash:
        typeof body.groundingId === "string"
          ? hash(body.groundingId)
          : undefined,
      businessStatus: /^[A-Z_]{1,64}$/u.test(body.status)
        ? body.status
        : undefined,
      resultHash: /^sha256:[a-f0-9]{64}$/u.test(result.resultHash)
        ? result.resultHash
        : undefined,
      findingCount: component?.findings?.length,
      choiceCount: component?.choices?.length,
      referenceProductCount: result.referenceProducts?.length,
      referenceProductHashes: result.referenceProducts?.map((product) =>
        hash(JSON.stringify(product.referenceKey)),
      ),
      unresolvedMentionCount: result.unresolvedMentions?.length,
      gapKinds: component?.gaps
        ?.map((gap) => gap.gapKind)
        .filter((code) => /^[A-Z_]{1,80}$/u.test(code)),
      errorCode: /^[A-Z_]{1,80}$/u.test(body.code ?? body.error?.code)
        ? (body.code ?? body.error.code)
        : undefined,
    };
  } catch {
    /* Only allowlisted metadata is retained. */
  }
  evidence.exchanges.push({
    ...summary,
    requestDeadlineMs,
    method: init?.method ?? "GET",
    destination: target.origin,
    pathHash: hash(target.pathname),
    httpStatus: response.status,
    elapsedMs: Date.now() - started,
    responseHash: hash(bytes),
    contractVersion: response.headers.get("wsgs-contract-version"),
    resultProfile: response.headers.get("wsgs-result-profile"),
  });
  return response;
};
try {
  const { FrozenWorldAnalysisContract, verifyFrozenWorldAnalysis } =
    await import("../dist/packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js");
  evidence.frozenFileCount = verifyFrozenWorldAnalysis();
  const contract = new FrozenWorldAnalysisContract();
  for (const version of preflightVersions) {
    try {
      const response = await realFetch(new URL("/v1/capabilities", endpoint), {
        headers: headers(version),
        signal: AbortSignal.timeout(preflightTimeoutMs),
      });
      const body = await response.json();
      if (version === "1.2" && response.ok)
        contract.parse("capabilities", body);
      const exact =
        response.headers.get("wsgs-contract-version") ===
          headers(version)["wsgs-contract-version"] &&
        (version === "1.0" ||
          response.headers.get("wsgs-result-profile") ===
            headers(version)["wsgs-result-profile"]);
      evidence.readiness.push({
        version,
        httpStatus: response.status,
        exactNegotiation: exact,
        status: response.ok && exact ? "PASS" : "BLOCKED_EXTERNAL",
        body,
      });
    } catch (error) {
      evidence.readiness.push({
        version,
        status: "BLOCKED_EXTERNAL",
        errorType: error.name,
      });
    }
  }
  await save();
  const current = evidence.readiness.find((row) => row.version === "1.2");
  assert.equal(
    current.status,
    "PASS",
    "Frozen 1.2 negotiation/contract not ready",
  );
  if (process.argv.includes("--readiness")) {
    evidence.status = current.body.worldAnalysis.capabilities.every(
      (item) => item.available,
    )
      ? "PREFLIGHT_PASS"
      : "BLOCKED_EXTERNAL";
    process.exitCode = evidence.status === "PREFLIGHT_PASS" ? 0 : 2;
  } else {
    container = "sacs-v06-real-" + randomUUID();
    const password = randomBytes(24).toString("hex");
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--detach",
        "--name",
        container,
        "--env",
        "POSTGRES_PASSWORD=" + password,
        "--env",
        "POSTGRES_DB=sacs_v06_real",
        "--publish",
        "127.0.0.1::5432",
        "postgres:16.9-alpine",
      ],
      { stdio: "pipe" },
    );
    const port = execFileSync("docker", ["port", container, "5432/tcp"], {
      encoding: "utf8",
    })
      .trim()
      .match(/^127\.0\.0\.1:(\d+)$/u)?.[1];
    assert.ok(port);
    for (let attempt = 0; ; attempt++) {
      try {
        execFileSync(
          "docker",
          ["exec", container, "pg_isready", "-U", "postgres"],
          { stdio: "pipe" },
        );
        break;
      } catch {
        assert.ok(attempt < 60, "Isolated PostgreSQL startup timeout");
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const { setupPersistence } =
      await import("../dist/packages/persistence/src/index.js");
    persistence = await setupPersistence({
      connectionString: `postgresql://postgres:${password}@127.0.0.1:${port}/sacs_v06_real`,
      poolMax: 12,
      operationTimeoutMs: 10000,
      idempotencyLeaseMs: 180000,
      maxActiveTasksPerChat: 8,
    });
    evidence.database = {
      image: "postgres:16.9-alpine",
      isolated: true,
      migrationStatus: "PASS",
    };
    const { createV06GroundingAnalysis } =
      await import("../dist/apps/server/src/v06-grounding-analysis.js");
    const { parseGroundingAnalysisConfig } =
      await import("../dist/packages/wsgs-analysis-adapter/src/config.js");
    composition = createV06GroundingAnalysis({
      persistence,
      config: parseGroundingAnalysisConfig({
        SACS_WSGS_ANALYSIS_ENABLED: "true",
        SACS_WSGS_ANALYSIS_POLL_INTERVAL_MS: "1000",
      }),
      wsgsConfig: {
        baseUrl: endpoint.href,
        fetchImpl: realFetch,
        operationTimeoutMs,
      },
      sdarCompatibilityLock: await readJson(
        "dependencies/sdar-grounding-extension-compatibility-lock.json",
      ),
    });
    const { buildServer } =
      await import("../dist/apps/server/src/bootstrap.js");
    const { parseServerConfig } =
      await import("../dist/apps/server/src/config.js");
    const secret = randomBytes(32).toString("hex");
    server = buildServer({
      config: parseServerConfig({
        CHAT_SERVER_SERVICE_KEY: randomBytes(32).toString("hex"),
        AG_UI_SERVICE_KEY: secret,
        OPENWEBUI_USER_JWT_SECRET: secret,
        LOG_LEVEL: "silent",
      }),
      readinessCheck: () => persistence.readiness(),
      resolveChatThread: (input) =>
        persistence.repository.getOrCreateThread(input),
      runAgUiV03: composition.runAgUiV03,
      analysisControl: composition.analysisControl,
      analysisCapabilities: composition.capabilities,
      resolveAgUiThread: async (input) => {
        const principal =
          await persistence.interactionRepository.resolvePrincipal({
            issuer: "openwebui-jwt",
            subject: input.userId,
            role: input.userRole,
          });
        return persistence.interactionRepository.getOrCreateThread({
          clientType: "ag_ui",
          externalThreadId: input.externalThreadId,
          principalId: principal.principalId,
        });
      },
    });
    const local = await server.listen({ host: "127.0.0.1", port: 0 });
    const encoded = (value) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const makeToken = () => {
      const tokenBase =
        encoded({ alg: "HS256", typ: "JWT" }) +
        "." +
        encoded({
          iss: "open-webui",
          sub: "sacs-real-analysis",
          role: "user",
          iat: Math.floor(Date.now() / 1000) - 1,
          exp: Math.floor(Date.now() / 1000) + 299,
        });
      return (
        tokenBase +
        "." +
        createHmac("sha256", secret).update(tokenBase).digest("base64url")
      );
    };
    const { SACS_AG_UI_V03_PROFILE_ID } =
      await import("../dist/packages/ag-ui-api-contract/src/index.js");
    const { parseAndVerifyAgUiSharedStateV03 } =
      await import("../dist/packages/analysis-contract/src/index.js");
    // No coordinates or invented identity: ask WSGS to resolve authorized context.
    const queries = [
      {
        id: "BASIC",
        text:
          config.SACS_V06_QUERY_TEXT ??
          "查询当前可用的地理对象和任务，如上下文不足请给出可选项。",
      },
      ...current.body.worldAnalysis.capabilities
        .filter(
          (c) => c.available && c.capability !== "ACTION_TARGET_CANDIDATE",
        )
        .map((c) => ({
          id: c.capability,
          text: {
            HISTORICAL_TRACE: "查询最近一次任务的历史轨迹。",
            ROAD_ASSOCIATION: "查询最近一次任务轨迹与道路的关联。",
            TEMPORAL_EVENT: "查询最近一次任务的停车时段。",
            CROSS: "查询最近一次任务的道路穿越事件。",
            METRIC_RANKING: "查询最近一次任务的速度最高位置排名。",
          }[c.capability],
        }))
        .filter((q) => q.text),
    ].slice(0, maxCases);
    for (const query of queries) {
      const row = { id: query.id, status: "NOT_RUN" };
      evidence.cases.push(row);
      try {
        const response = await fetch(local + "/ag-ui", {
          method: "POST",
          headers: {
            authorization: "Bearer " + secret,
            "x-openwebui-user-jwt": makeToken(),
            "content-type": "application/json",
            accept: "text/event-stream",
            "x-sacs-ag-ui-profile": SACS_AG_UI_V03_PROFILE_ID,
          },
          body: JSON.stringify({
            threadId: randomUUID(),
            runId: randomUUID(),
            state: {},
            messages: [{ id: randomUUID(), role: "user", content: query.text }],
            tools: [],
            context: [],
            forwardedProps: { mode: "START" },
          }),
          signal: AbortSignal.timeout(evidence.clientObservationTimeoutMs),
        });
        row.httpStatus = response.status;
        const wire = await response.text();
        row.wireHash = hash(wire);
        const events = wire
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => JSON.parse(line.slice(6)));
        row.eventTypes = [...new Set(events.map((event) => event.type))];
        const snapshot = events
          .filter((event) => event.type === "STATE_SNAPSHOT")
          .at(-1)?.snapshot;
        assert.equal(response.status, 200);
        assert.ok(snapshot, "No durable SACS snapshot");
        const state = parseAndVerifyAgUiSharedStateV03(snapshot);
        row.projectionHash = hash(JSON.stringify(state));
        row.businessStatus = state.worldExplanation?.status;
        row.runErrors = events
          .filter((event) => event.type === "RUN_ERROR")
          .map((event) => event.code ?? "RUN_ERROR");
        row.status = row.runErrors.length ? "FAIL" : "OBSERVED";
        row.note =
          "Transport/projection observation only; semantic acceptance requires source result and case-specific assertions.";
      } catch (error) {
        row.status = "FAIL";
        row.errorType = error.name;
      }
      await save();
    }
    evidence.status = "INCOMPLETE";
    process.exitCode = 2;
  }
} catch (error) {
  evidence.status = "FAIL";
  evidence.errorType = error.name;
  // Do not serialize error messages: upstream errors can contain private URLs/data.
  process.exitCode = 1;
} finally {
  await composition?.source?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  await persistence?.close().catch(() => undefined);
  if (container) {
    try {
      execFileSync("docker", ["stop", "--time", "5", container], {
        stdio: "pipe",
        timeout: 15000,
      });
      evidence.cleanup = "PASS";
    } catch {
      evidence.cleanup = "FAIL";
      process.exitCode = 1;
    }
  }
  await save();
  console.log(
    JSON.stringify({
      status: evidence.status,
      cases: evidence.cases.map(({ id, status }) => ({ id, status })),
      evidence: resolve(output, "INTEGRATION_EVIDENCE.json"),
    }),
  );
}
