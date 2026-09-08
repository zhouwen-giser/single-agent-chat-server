import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, it, expect } from "@jest/globals";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import {
  setupPersistence,
  type PersistenceRuntime,
} from "../packages/persistence/src/index.js";
import { createV06GroundingAnalysis } from "../apps/server/src/v06-grounding-analysis.js";
import { buildServer } from "../apps/server/src/bootstrap.js";
import { parseGroundingAnalysisConfig } from "../packages/wsgs-analysis-adapter/src/config.js";
import type { ServerConfig } from "../apps/server/src/config.js";
import { WSGS_V11_HEADERS } from "../packages/wsgs-geospatial-consumer/src/authoritative.js";
import { SACS_AG_UI_V03_PROFILE_ID } from "../packages/ag-ui-api-contract/src/index.js";
import { parseAndVerifyAgUiSharedStateV03 } from "../packages/analysis-contract/src/index.js";
const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const secret = "local-test-secret-at-least-thirty-two-characters";
const config: ServerConfig = {
  serviceKey: secret,
  agUiServiceKey: secret,
  openWebUiUserJwtSecret: secret,
  host: "127.0.0.1",
  port: 3000,
  bodyLimitBytes: 262144,
  requestTimeoutMs: 10000,
  modelId: "sdar-single-agent",
  corsAllowedOrigins: [],
  rateLimitMax: 200,
  rateLimitWindowMs: 60000,
  maxMessages: 64,
  maxMessageChars: 32768,
  maxResponseChars: 65536,
  logLevel: "silent",
  streamBudgetMs: 30000,
  pollingBudgetMs: 5000,
  pollingIntervalMs: 1000,
};
function headers(user = "local-user") {
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const h = encode({ alg: "HS256", typ: "JWT" });
  const p = encode({
    iss: "open-webui",
    sub: user,
    role: "user",
    iat: now - 1,
    exp: now + 299,
  });
  const token =
    h +
    "." +
    p +
    "." +
    createHmac("sha256", secret)
      .update(h + "." + p)
      .digest("base64url");
  return {
    authorization: "Bearer " + secret,
    "x-openwebui-user-jwt": token,
    "content-type": "application/json",
  };
}
/** Real local HTTP and PostgreSQL, simulated WSGS data. NOT REAL_INTEGRATION evidence. */
suite("v06 normal composition local HTTP / PostgreSQL E2E", () => {
  const name = "sacs_v06_http_" + randomUUID().replaceAll("-", "");
  let admin: pg.Pool,
    persistence: PersistenceRuntime,
    server: FastifyInstance,
    upstream: Server;
  let composition: ReturnType<typeof createV06GroundingAnalysis>;
  let baseUrl = "";
  let creates = 0;
  let polls = 0;
  let request: any;
  let remote: any;
  const paths: string[] = [];
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString, max: 1 });
    await admin.query(`CREATE DATABASE "${name}"`);
    const db = new URL(connectionString!);
    db.pathname = "/" + name;
    persistence = await setupPersistence({
      connectionString: db.href,
      poolMax: 12,
      operationTimeoutMs: 10000,
      idempotencyLeaseMs: 180000,
      maxActiveTasksPerChat: 8,
    });
    upstream = createServer(async (req, res) => {
      paths.push((req.method ?? "GET") + " " + req.url);
      for (const [key, value] of Object.entries(WSGS_V11_HEADERS))
        expect(req.headers[key]).toBe(value);
      let data: any;
      if (req.url?.endsWith("capabilities"))
        data = read(
          "dependencies/wsgs-v06/examples/capabilities-response-v1.1.json",
        );
      else if (req.method === "POST" && req.url === "/v1/groundings") {
        creates++;
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        request = JSON.parse(Buffer.concat(chunks).toString());
        remote = {
          schemaVersion: "1.0",
          requestId: request.requestId,
          groundingId: "remote-" + request.requestId,
          jobId: "job-" + request.requestId,
          status: "ACCEPTED",
          createdAt: "2026-09-06T00:00:00Z",
          updatedAt: "2026-09-06T00:00:00Z",
        };
        data = remote;
        res.statusCode = 202;
      } else if (
        req.method === "GET" &&
        req.url?.startsWith("/v1/groundings/")
      ) {
        polls++;
        const result = {
          ...read(
            "dependencies/wsgs-v06/examples/grounding-result-with-geospatial-findings.json",
          ),
          requestId: request.requestId,
          groundingId: remote.groundingId,
          source: {
            ...read(
              "dependencies/wsgs-v06/examples/grounding-result-with-geospatial-findings.json",
            ).source,
            messageId: request.source.messageId,
            originalTextSha256: request.source.originalTextSha256,
          },
        };
        data = { ...remote, status: "COMPLETED", result };
      } else {
        res.statusCode = 404;
        data = {};
      }
      res.writeHead(res.statusCode, {
        "content-type": "application/json",
        ...WSGS_V11_HEADERS,
      });
      res.end(JSON.stringify(data));
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const address = upstream.address();
    if (!address || typeof address === "string") throw Error("address");
    composition = createV06GroundingAnalysis({
      persistence,
      config: parseGroundingAnalysisConfig({
        SACS_WSGS_ANALYSIS_ENABLED: "true",
        // This regression fixture deliberately serves the legacy v1.1 contract.
        SACS_WSGS_ANALYSIS_CONTRACT_VERSION: "sacs-wsgs-grounding/1.1",
        SACS_WSGS_ANALYSIS_RESULT_PROFILE: "sacs-wsgs-geospatial-findings/1.0",
        SACS_WSGS_ANALYSIS_POLL_INTERVAL_MS: "10",
      }),
      wsgsConfig: { baseUrl: "http://127.0.0.1:" + address.port },
      sdarCompatibilityLock: read(
        "dependencies/sdar-grounding-extension-compatibility-lock.json",
      ),
    });
    server = buildServer({
      config,
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
    baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
  });
  afterAll(async () => {
    await server?.close();
    await composition?.source?.close();
    await persistence?.close();
    if (upstream)
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      );
    await admin?.query(`DROP DATABASE "${name}"`);
    await admin?.end();
  });
  it("starts via the normal v0.3 endpoint, persists source-only identity, and reconnects without new WSGS work", async () => {
    const payload = {
      threadId: "local-thread",
      runId: "local-run",
      state: {},
      messages: [{ id: "message-1", role: "user", content: "查询该点的坡度" }],
      tools: [],
      context: [],
      forwardedProps: { mode: "START" },
    };
    const run = async (value: unknown) => {
      const response = await fetch(baseUrl + "/ag-ui", {
        method: "POST",
        headers: {
          ...headers(),
          accept: "text/event-stream",
          "x-sacs-ag-ui-profile": SACS_AG_UI_V03_PROFILE_ID,
        },
        body: JSON.stringify(value),
      });
      expect(response.status).toBe(200);
      return (await response.text())
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)));
    };
    const events = await run(payload);
    expect(events.filter((e) => e.type === "RUN_ERROR")).toEqual([]);
    expect(events.at(-1)?.type).toBe("RUN_FINISHED");
    const snapshot = events
      .filter((e) => e.type === "STATE_SNAPSHOT")
      .at(-1)?.snapshot;
    const state = parseAndVerifyAgUiSharedStateV03(snapshot);
    const revision = Object.values(state.analysis.revisionsById)[0]!;
    expect(revision.source).toMatchObject({
      kind: "WSGS_GROUNDING_JOB",
      sourceId: remote.groundingId,
    });
    expect(revision.wsgsPlanId).toBeUndefined();
    expect(state.analysis.nodesById).toEqual({});
    expect(state.worldExplanation).toMatchObject({ status: "COMPLETED" });
    expect(events.some((e) => e.type.startsWith("TOOL_CALL"))).toBe(false);
    expect(creates).toBe(1);
    expect(polls).toBe(1);
    const count = paths.length;
    const replay = await run({
      ...payload,
      runId: "local-reconnect",
      messages: [],
      forwardedProps: {
        mode: "RECONNECT",
        analysisId: state.analysis.session.analysisId,
      },
    });
    expect(replay.at(-1)?.type).toBe("RUN_FINISHED");
    expect(paths).toHaveLength(count);
    const foreign = await fetch(
      baseUrl +
        "/api/v1/analyses/" +
        state.analysis.session.analysisId +
        "/snapshot",
      { headers: headers("foreign") },
    );
    expect(foreign.status).toBe(404);
  });
  it("authenticates capabilities and never advertises Native readiness", async () => {
    expect(
      (await fetch(baseUrl + "/api/v1/analysis-capabilities")).status,
    ).toBe(401);
    const response = await fetch(baseUrl + "/api/v1/analysis-capabilities", {
      headers: headers(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: true,
      groundingContractReady: true,
      nativeReady: false,
    });
    expect(
      paths.every(
        (path) => !path.includes("plan") && !path.includes("analysis"),
      ),
    ).toBe(true);
  });
});
