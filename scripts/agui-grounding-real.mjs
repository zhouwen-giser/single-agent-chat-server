import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Independent, opt-in live acceptance. No fixture imports or shared deployment changes.
const hash = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const path = process.env.SACS_AGUI_REAL_ENV;
assert.ok(path, "SACS_AGUI_REAL_ENV must name a private configuration file");
assert.equal(
  (await stat(path)).mode & 0o077,
  0,
  "Private config must not be group/world accessible",
);
const config = parseEnv(await readFile(path, "utf8"));
const localOnly = process.argv.includes("--local-startup-only");
assert.equal(config.ALLOW_REAL_WSGS, "YES");
assert.ok(
  config.SACS_AGUI_QUERY_TEXT?.length > 0 &&
    config.SACS_AGUI_QUERY_TEXT.length <= 32768,
);
const endpoint = new URL(config.WSGS_BASE_URL);
assert.ok(["http:", "https:"].includes(endpoint.protocol));
assert.ok(
  !endpoint.username &&
    !endpoint.password &&
    !endpoint.search &&
    !endpoint.hash,
);
assert.equal(
  git(
    "status",
    "--porcelain",
    "--",
    "apps",
    "packages",
    "scripts",
    "tests",
    "contracts",
    "dependencies",
    "package.json",
    "pnpm-lock.yaml",
  ),
  "",
  "Commit source before real acceptance",
);
const output = resolve(
  process.env.SACS_AGUI_REAL_OUTPUT ??
    `reports/v0.6/agui-v03-grounding-presentation/real/${randomUUID()}`,
);
await mkdir(output, { recursive: true });
const evidencePath = resolve(output, "EVIDENCE.json");
await writeFile(evidencePath, "{}\n", { flag: "wx", mode: 0o600 });
const evidence = {
  schemaVersion: "sacs-agui-grounding-real-attempt/1.0",
  sourceSha: git("rev-parse", "HEAD"),
  entrypointHash: hash(await readFile(new URL(import.meta.url))),
  startedAt: new Date().toISOString(),
  mode: localOnly ? "LOCAL_STARTUP_CHECK" : "REAL",
  endpointOrigin: endpoint.origin,
  operationTimeoutMs: 120000,
  queryHash: hash(config.SACS_AGUI_QUERY_TEXT),
  exchanges: [],
  observations: [],
  cases: [
    { id: "R01", status: "NOT_RUN" },
    { id: "R02", status: "NOT_RUN" },
  ],
  status: "INCOMPLETE",
  nonClaims: [
    "DEVICE_EXECUTION",
    "PRODUCTION_READINESS",
    "UPSTREAM_DATABASE_ACCESS",
    "PROCESS_CRASH_RECOVERY",
  ],
};
const save = async () =>
  writeFile(
    evidencePath,
    JSON.stringify(
      { ...evidence, updatedAt: new Date().toISOString() },
      null,
      2,
    ) + "\n",
  );
let container, server, persistence, composition;
let postLimit = 1,
  postCount = 0;
const sourceResults = new Map();
const sourceStatuses = new Map();
const submittedRequests = [];
const negotiated = {
  "wsgs-contract-version": "sacs-wsgs-grounding/1.2",
  "wsgs-result-profile": "wsgs-world-analysis-findings/1.0",
};
const realFetch = async (url, init = {}) => {
  const target = new URL(String(url));
  assert.equal(target.origin, endpoint.origin, "Unexpected upstream origin");
  const method = init.method ?? "GET";
  assert.ok(
    (method === "GET" &&
      (target.pathname === "/v1/capabilities" ||
        /^\/v1\/groundings\/[^/]+$/u.test(target.pathname))) ||
      (method === "POST" && target.pathname === "/v1/groundings"),
    "Only public read-only Grounding lifecycle allowed",
  );
  if (method === "POST") {
    assert.ok(
      ++postCount <= postLimit,
      "Unexpected/repeated business submission",
    );
    const body = JSON.parse(init.body);
    submittedRequests.push(body);
    assert.equal(body.executionPolicy.readOnly, true);
    assert.equal(body.executionPolicy.deadlineMs, 120000);
    assert.equal(body.executionPolicy.allowApproximation, false);
  }
  const started = Date.now();
  const response = await fetch(url, { ...init, redirect: "error" });
  const bytes = await response.clone().text();
  evidence.exchanges.push({
    method,
    destination: target.origin,
    pathHash: hash(target.pathname),
    httpStatus: response.status,
    elapsedMs: Date.now() - started,
    responseHash: hash(bytes),
  });
  for (const [key, value] of Object.entries(negotiated))
    assert.equal(response.headers.get(key), value, "Negotiation mismatch");
  let body;
  try {
    body = JSON.parse(bytes);
  } catch {
    return response;
  }
  if (body.groundingId && body.status) {
    const statuses = sourceStatuses.get(body.groundingId) ?? new Set();
    statuses.add(body.status);
    sourceStatuses.set(body.groundingId, statuses);
  }
  const result = body.result ?? body;
  if (result.worldAnalysisFindings)
    sourceResults.set(result.groundingId, result);
  await save();
  return response;
};

try {
  evidence.stage = "PREFLIGHT";
  const { FrozenWorldAnalysisContract, verifyFrozenWorldAnalysis } =
    await import("../dist/packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js");
  const { verifyGroundingObservation, createAcceptanceServerConfig } =
    await import("../dist/scripts/lib/agui-grounding-observation.js");
  const { setupPersistence } =
    await import("../dist/packages/persistence/src/index.js");
  const { createV06GroundingAnalysis } =
    await import("../dist/apps/server/src/v06-grounding-analysis.js");
  const { parseGroundingAnalysisConfig } =
    await import("../dist/packages/wsgs-analysis-adapter/src/config.js");
  const { buildServer } = await import("../dist/apps/server/src/bootstrap.js");
  const { SACS_AG_UI_V03_PROFILE_ID } =
    await import("../dist/packages/ag-ui-api-contract/src/index.js");
  const { AnalysisControlClient } =
    await import("../dist/packages/analysis-client/src/index.js");
  evidence.frozenFileCount = verifyFrozenWorldAnalysis();
  evidence.frozenManifestHash = hash(
    await readFile(
      "dependencies/wsgs-world-analysis-v1/public/contract-release-lock.json",
    ),
  );
  const contract = new FrozenWorldAnalysisContract();
  if (!localOnly) {
    const ready = await realFetch(new URL("/v1/capabilities", endpoint), {
      headers: negotiated,
      signal: AbortSignal.timeout(120000),
    });
    assert.equal(ready.status, 200, "Capabilities unavailable");
    const caps = contract.parse("capabilities", await ready.json());
    evidence.preflight = {
      httpStatus: ready.status,
      exactNegotiation: true,
      requiredCapabilitiesReady: caps.requiredCapabilitiesReady,
      capabilities: caps.worldAnalysis.capabilities.map(
        ({ capability, available, reasonCodes }) => ({
          capability,
          available,
          reasonCodes,
        }),
      ),
    };
    assert.equal(
      caps.requiredCapabilitiesReady,
      true,
      "Required capability readiness unavailable",
    );
    await save();
  }

  container = "sacs-agui-real-" + randomUUID();
  evidence.stage = "ISOLATED_DATABASE";
  const password = randomBytes(32).toString("hex");
  const image = "postgres:17.10-alpine3.23";
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
      "POSTGRES_DB=sacs_agui_real",
      "--publish",
      "127.0.0.1::5432",
      image,
    ],
    { stdio: "pipe", timeout: 30000 },
  );
  const port = execFileSync("docker", ["port", container, "5432/tcp"], {
    encoding: "utf8",
    timeout: 10000,
  })
    .trim()
    .match(/^127\.0\.0\.1:(\d+)$/u)?.[1];
  assert.ok(port);
  for (let n = 0; ; n++) {
    try {
      execFileSync(
        "docker",
        ["exec", container, "pg_isready", "-U", "postgres"],
        { stdio: "pipe", timeout: 5000 },
      );
      break;
    } catch {
      assert.ok(n < 60, "Dedicated database unavailable");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/sacs_agui_real`;
  const secret = randomBytes(32).toString("hex");
  let local;
  const open = async () => {
    evidence.stage = "DATABASE_MIGRATIONS";
    persistence = await setupPersistence({
      connectionString: databaseUrl,
      poolMax: 12,
      operationTimeoutMs: 10000,
      idempotencyLeaseMs: 180000,
      maxActiveTasksPerChat: 8,
    });
    evidence.stage = "SACS_COMPOSITION";
    composition = createV06GroundingAnalysis({
      persistence,
      config: parseGroundingAnalysisConfig({
        SACS_WSGS_ANALYSIS_ENABLED: "true",
        SACS_WSGS_ANALYSIS_POLL_INTERVAL_MS: "1000",
        SACS_WSGS_ANALYSIS_MAX_WAIT_MS: "120000",
      }),
      wsgsConfig: {
        baseUrl: endpoint.href,
        fetchImpl: realFetch,
        operationTimeoutMs: 120000,
      },
      sdarCompatibilityLock: await json(
        "dependencies/sdar-grounding-extension-compatibility-lock.json",
      ),
    });
    evidence.stage = "SACS_LISTENER";
    server = buildServer({
      config: createAcceptanceServerConfig(secret),
      readinessCheck: () => persistence.readiness(),
      resolveChatThread: (input) =>
        persistence.repository.getOrCreateThread(input),
      runAgUiV03: composition.runAgUiV03,
      analysisControl: composition.analysisControl,
      analysisCapabilities: composition.capabilities,
      resolveAgUiThread: async (input) => {
        const p = await persistence.interactionRepository.resolvePrincipal({
          issuer: "openwebui-jwt",
          subject: input.userId,
          role: input.userRole,
        });
        return persistence.interactionRepository.getOrCreateThread({
          clientType: "ag_ui",
          externalThreadId: input.externalThreadId,
          principalId: p.principalId,
        });
      },
    });
    local = await server.listen({ host: "127.0.0.1", port: 0 });
  };
  const close = async () => {
    await composition?.source?.close();
    await server?.close();
    await persistence?.close();
  };
  const headers = () => {
    const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const token =
      encode({ alg: "HS256", typ: "JWT" }) +
      "." +
      encode({
        iss: "open-webui",
        sub: "agui-real-acceptance",
        role: "user",
        iat: Math.floor(Date.now() / 1000) - 1,
        exp: Math.floor(Date.now() / 1000) + 600,
      });
    return {
      authorization: "Bearer " + secret,
      "x-openwebui-user-jwt":
        token +
        "." +
        createHmac("sha256", secret).update(token).digest("base64url"),
      "content-type": "application/json",
    };
  };
  await open();
  evidence.database = { isolated: true, image, migrations: "PASS" };
  if (localOnly) {
    evidence.status = "LOCAL_STARTUP_PASS";
    evidence.stage = "FINISHED";
    process.exitCode = 0;
  } else {
    const threadId = randomUUID();
    const observe = async (analysisId) => {
      const response = await fetch(local + "/ag-ui", {
        method: "POST",
        headers: {
          ...headers(),
          accept: "text/event-stream",
          "x-sacs-ag-ui-profile": SACS_AG_UI_V03_PROFILE_ID,
        },
        body: JSON.stringify({
          threadId,
          runId: randomUUID(),
          state: {},
          messages: analysisId
            ? []
            : [
                {
                  id: randomUUID(),
                  role: "user",
                  content: config.SACS_AGUI_QUERY_TEXT,
                },
              ],
          tools: [],
          context: [],
          forwardedProps: analysisId
            ? { mode: "RECONNECT", analysisId }
            : { mode: "START" },
        }),
        signal: AbortSignal.timeout(270000),
      });
      assert.equal(response.status, 200, "AGUI_HTTP_FAILED");
      const wire = await response.text();
      const events = wire
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)));
      const state = events
        .filter((e) => e.type === "STATE_SNAPSHOT")
        .at(-1)?.snapshot;
      const result = sourceResults.get(state?.worldExplanation?.groundingId);
      assert.ok(result, "No captured public source result");
      contract.parse("result", result);
      const verified = await verifyGroundingObservation(wire, result);
      for (const event of events.filter((e) => e.type === "ACTIVITY_SNAPSHOT"))
        assert.ok(
          sourceStatuses
            .get(event.content.groundingId)
            ?.has(event.content.sourceStatus),
          "Activity status was not observed from WSGS",
        );
      evidence.observations.push(verified.summary);
      await save();
      return verified;
    };
    const control = new AnalysisControlClient({
      send: async (request) => {
        const response = await fetch(local + request.path, {
          method: request.method,
          headers: headers(),
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
          signal: AbortSignal.timeout(270000),
        });
        evidence.controlHttpStatuses ??= [];
        evidence.controlHttpStatuses.push(response.status);
        return { status: response.status, body: await response.json() };
      },
    });
    evidence.stage = "INITIAL_OBSERVATION";
    let current = await observe();
    const analysisId = current.state.analysis.session.analysisId;
    const acceptNormal = (observation) =>
      ["COMPLETED", "PARTIAL"].includes(observation.summary.sourceStatus) &&
      observation.summary.findingCount > 0;
    evidence.cases[0] = {
      id: "R01",
      status: acceptNormal(current) ? "PASS" : "BLOCKED_EXTERNAL",
      reason: acceptNormal(current)
        ? "SOURCE_AND_PRESENTATION_VERIFIED"
        : "NO_POSITIVE_FINDING_YET",
      observation: 0,
    };
    const choice = current.state.worldExplanation.choices.find(
      (c) => c.selector && Date.parse(c.validUntil) > Date.now(),
    );
    if (choice && current.state.pendingIntervention) {
      evidence.stage = "EXPLICIT_SELECTION";
      assert.equal(
        config.ALLOW_REAL_SELECTION,
        "YES",
        "Real selection requires explicit configuration",
      );
      const previous = current;
      const count = postCount;
      await current.client.inspectFrozenChoice(
        choice.choiceId,
        choice.candidateId,
      );
      assert.equal(postCount, count, "Inspection created work");
      postLimit = 2;
      await current.client.resolveSelection(control, {
        confirmed: true,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        originalText: "采用所选候选继续只读历史分析，不执行设备动作。",
      });
      assert.equal(postCount, count + 1);
      assert.deepEqual(submittedRequests.at(-1).analysisSelections, [
        choice.selector,
      ]);
      current = await observe(analysisId);
      assert.equal(
        current.state.analysis.session.latestRevisionNumber,
        previous.state.analysis.session.latestRevisionNumber + 1,
      );
      assert.notEqual(
        current.state.analysis.activeRevisionId,
        previous.state.analysis.activeRevisionId,
      );
      assert.notEqual(
        current.state.worldExplanation.groundingId,
        previous.state.worldExplanation.groundingId,
      );
      evidence.cases[1] = {
        id: "R02",
        status: "PASS",
        reason: "REAL_CHOICE_CONTROL_NEW_REVISION_GROUNDING_SNAPSHOT",
        selectorHash: hash(JSON.stringify(choice.selector)),
        observation: evidence.observations.length - 1,
      };
      if (acceptNormal(current))
        evidence.cases[0] = {
          id: "R01",
          status: "PASS",
          reason: "SOURCE_AND_PRESENTATION_VERIFIED",
          observation: evidence.observations.length - 1,
        };
    } else
      evidence.cases[1] = {
        id: "R02",
        status: "BLOCKED_EXTERNAL",
        reason: "NO_UNEXPIRED_PUBLIC_CHOICE_IN_THIS_AUTHORIZED_QUERY",
        choiceCount: current.summary.choiceCount,
        scope:
          "This request only; not a claim that WSGS selection is globally unavailable.",
      };
    const before = JSON.stringify(current.state);
    evidence.stage = "PERSISTENCE_REOPEN";
    const calls = evidence.exchanges.length;
    await close();
    await open();
    const restored = await observe(analysisId);
    assert.equal(
      JSON.stringify(restored.state),
      before,
      "Persistent projection changed on reopen",
    );
    assert.equal(
      evidence.exchanges.length,
      calls,
      "Reconnect issued upstream requests",
    );
    evidence.recovery = {
      status: "PASS",
      kind: "repository-composition-reopen",
      sameRevision: true,
      sameGrounding: true,
      additionalUpstreamRequests: 0,
    };
    evidence.stage = "FINISHED";
    evidence.status = evidence.cases.every((c) => c.status === "PASS")
      ? "PASS"
      : "INCOMPLETE";
    process.exitCode = evidence.status === "PASS" ? 0 : 2;
  }
} catch (error) {
  evidence.status = "FAILED";
  evidence.errorType = error.name;
  evidence.errorCode = /^[A-Z0-9_]{1,80}$/u.test(error.code)
    ? error.code
    : undefined;
  evidence.errorFrames = String(error.stack ?? "")
    .split("\n")
    .slice(1, 6)
    .map((line) => line.match(/[A-Za-z0-9_./-]+\.(?:mjs|js|ts):\d+:\d+/u)?.[0])
    .filter(Boolean);
  // Never serialize error messages, query text, task IDs, geometries or credentials.
  evidence.assertionCode = /^[A-Z][A-Z0-9_]{1,100}$/u.test(error.message)
    ? error.message
    : undefined;
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
      evidence.cleanup = "FAILED";
      process.exitCode = 1;
    }
  }
  evidence.businessSubmissions = postCount;
  evidence.exitCode = process.exitCode ?? 0;
  await save();
  console.log(
    JSON.stringify({
      status: evidence.status,
      cases: evidence.cases,
      evidence: evidencePath,
    }),
  );
}
