import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { buildServer } from "../apps/server/src/bootstrap.js";
import type { ServerConfig } from "../apps/server/src/config.js";
import { createV06GroundingAnalysis } from "../apps/server/src/v06-grounding-analysis.js";
import {
  setupPersistence,
  type PersistenceRuntime,
} from "../packages/persistence/src/index.js";
import { parseGroundingAnalysisConfig } from "../packages/wsgs-analysis-adapter/src/config.js";
import { SACS_AG_UI_V03_PROFILE_ID } from "../packages/ag-ui-api-contract/src/index.js";
import {
  AnalysisControlClient,
  HeadlessAnalysisReferenceClient,
  HeadlessMapEngineAdapter,
} from "../packages/analysis-client/src/index.js";
import { parseAndVerifyAgUiSharedStateV03 } from "../packages/analysis-contract/src/index.js";
import type { WorldAnalysisViewModel } from "../packages/world-explanation-runtime/src/analysis-view.js";
import { publicCanonicalHash } from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import {
  frozenNow,
  startFrozenScenarioPeer,
} from "./helpers/memory-frozen-analysis.js";

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const secret = "frozen-postgres-http-test-secret-32-characters";
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
function headers() {
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(frozenNow().getTime() / 1000);
  const h = encode({ alg: "HS256", typ: "JWT" });
  const p = encode({
    iss: "open-webui",
    sub: "pg-frozen-user",
    role: "user",
    iat: now - 1,
    exp: now + 299,
  });
  return {
    authorization: "Bearer " + secret,
    "x-openwebui-user-jwt":
      h +
      "." +
      p +
      "." +
      createHmac("sha256", secret)
        .update(h + "." + p)
        .digest("base64url"),
    "content-type": "application/json",
  };
}

// Real local TCP + PostgreSQL; WSGS is a frozen public-contract fixture, not live evidence.
suite("S07 frozen 1.2 PostgreSQL and normal HTTP/SSE closure", () => {
  jest.setTimeout(60_000);
  const name = "sacs_frozen_http_" + randomUUID().replaceAll("-", "");
  let admin: pg.Pool;
  let dbUrl: string;
  let persistence: PersistenceRuntime;
  let composition: ReturnType<typeof createV06GroundingAnalysis>;
  let server: FastifyInstance;
  let peer: Awaited<ReturnType<typeof startFrozenScenarioPeer>>;
  let baseUrl: string;
  const client = new HeadlessAnalysisReferenceClient(
    new HeadlessMapEngineAdapter(),
    () => frozenNow().getTime(),
  );

  async function open() {
    persistence = await setupPersistence({
      connectionString: dbUrl,
      poolMax: 12,
      operationTimeoutMs: 10000,
      idempotencyLeaseMs: 180000,
      maxActiveTasksPerChat: 8,
    });
    composition = createV06GroundingAnalysis({
      persistence,
      config: parseGroundingAnalysisConfig({
        SACS_WSGS_ANALYSIS_ENABLED: "true",
        SACS_WSGS_ANALYSIS_POLL_INTERVAL_MS: "10",
        SACS_WSGS_ANALYSIS_MAX_WAIT_MS: "2000",
      }),
      wsgsConfig: { baseUrl: peer.baseUrl },
      sdarCompatibilityLock: JSON.parse(
        readFileSync(
          "dependencies/sdar-grounding-extension-compatibility-lock.json",
          "utf8",
        ),
      ),
      now: frozenNow,
    });
    server = buildServer({
      config,
      now: () => frozenNow().getTime(),
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
  }
  async function close() {
    await server?.close();
    await composition?.source?.close();
    await persistence?.close();
  }
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString, max: 1 });
    await admin.query(`CREATE DATABASE "${name}"`);
    const db = new URL(connectionString!);
    db.pathname = "/" + name;
    dbUrl = db.href;
    peer = await startFrozenScenarioPeer({
      examples: ["ranking", "action", "event-incomplete"],
      async: true,
    });
    await open();
  });
  afterAll(async () => {
    await close();
    await peer?.close();
    await admin?.query(`DROP DATABASE "${name}"`);
    await admin?.end();
  });
  async function observe(runId: string, analysisId?: string) {
    const response = await fetch(baseUrl + "/ag-ui", {
      method: "POST",
      headers: {
        ...headers(),
        accept: "text/event-stream",
        "x-sacs-ag-ui-profile": SACS_AG_UI_V03_PROFILE_ID,
      },
      body: JSON.stringify({
        threadId: "pg-frozen-thread",
        runId,
        state: {},
        messages: analysisId
          ? []
          : [
              {
                id: "message-" + runId,
                role: "user",
                content: "查询历史信号最强的候选位置",
              },
            ],
        tools: [],
        context: [],
        forwardedProps: analysisId
          ? { mode: "RECONNECT", analysisId }
          : { mode: "START" },
      }),
    });
    expect(response.status).toBe(200);
    const wire = await response.text();
    const events = wire
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    expect(
      events.filter(
        (e) => e.type === "RUN_ERROR" || e.type.startsWith("TOOL_CALL"),
      ),
    ).toEqual([]);
    expect(events.at(-1).type).toBe("RUN_FINISHED");
    await client.acceptSseChunk(wire, client.observationGeneration);
    await client.finishStream();
    const state = parseAndVerifyAgUiSharedStateV03(
      events.filter((e) => e.type === "STATE_SNAPSHOT").at(-1).snapshot,
    );
    expect(client.state.sharedState).toEqual(state);
    expect(client.state.needsFullStateSnapshot).toBe(false);
    expect(client.state.needsFullActivitySnapshot).toBe(false);
    expect(client.mapPresentation.shared).toEqual(state.map);
    return state;
  }
  const send = jest.fn(
    async (
      request: Parameters<
        ConstructorParameters<typeof AnalysisControlClient>[0]["send"]
      >[0],
    ) => {
      const response = await fetch(baseUrl + request.path, {
        method: request.method,
        headers: headers(),
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      return {
        status: response.status,
        body: (await response.json()) as unknown,
      };
    },
  );
  const control = new AnalysisControlClient({ send });

  it("persists choice -> new Revision -> local map draft -> explicit query, then reopens PostgreSQL and restores without extra Grounding work", async () => {
    const first = await observe("pg-first");
    const analysisId = first.analysis.session.analysisId;
    const view = first.worldExplanation as unknown as WorldAnalysisViewModel;
    const choice = view.choices.find((c) => "selector" in c);
    if (!choice || !("selector" in choice))
      throw Error("CHOICE_FIXTURE_REQUIRED");
    expect(client.state.runStatus).toBe("INTERRUPTED");
    await client.inspectFrozenChoice(choice.choiceId, choice.candidateId);
    expect(peer.requests).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
    const selection = {
      confirmed: true,
      commandId: "pg-selection",
      idempotencyKey: "pg-selection",
      originalText: "采用所选历史候选",
    };
    await client.resolveSelection(control, selection);
    await client.resolveSelection(control, selection);
    expect(peer.requests).toHaveLength(2);
    expect(peer.requests[1]?.analysisSelections).toEqual([choice.selector]);
    expect(client.state.sharedState).toEqual(first);
    await client.disconnect();
    client.reconnect();
    const second = await observe("pg-selected", analysisId);
    expect(second.analysis.session.latestRevisionNumber).toBe(
      first.analysis.session.latestRevisionNumber + 1,
    );
    expect(second.analysis.activeRevisionId).not.toBe(
      first.analysis.activeRevisionId,
    );
    expect(second.pendingIntervention).toBeUndefined();
    const geometry = {
      type: "Point" as const,
      coordinates: [116.39, 39.9] as [number, number],
    };
    await client.dispatchMapAction({
      type: "DRAW_POINT",
      coordinates: geometry.coordinates,
    });
    expect(peer.requests).toHaveLength(2);
    const query = {
      confirmed: true,
      expectedDraftRevision: 1,
      commandId: "pg-query",
      idempotencyKey: "pg-query",
      originalText: "查询该位置的历史停车事件",
      contextMode: "REPLACE" as const,
    };
    await client.submitNewQuery(control, query);
    expect(peer.requests).toHaveLength(3);
    expect(peer.requests[2]?.contextCapsule.mapSelections[0]).toMatchObject({
      geometry,
      geometryHash: publicCanonicalHash(geometry),
    });
    expect(client.state.sharedState).toEqual(second);
    await client.disconnect();
    client.reconnect();
    const third = await observe("pg-queried", analysisId);
    expect(third.analysis.session.latestRevisionNumber).toBe(
      second.analysis.session.latestRevisionNumber + 1,
    );
    expect(third.worldExplanation?.["status"]).toBe("PARTIAL");
    expect(third.analysis.activeRevisionId).not.toBe(
      second.analysis.activeRevisionId,
    );
    const requestCount = peer.captured.length;
    await client.disconnect();
    await close();
    await open(); // New DB pool/repositories, composition and HTTP listener; same dedicated DB.
    client.reconnect();
    const restored = await observe("pg-restored", analysisId);
    expect(restored).toEqual(third);
    expect(peer.captured).toHaveLength(requestCount);
    // Replay a durable command after reopening; no duplicate source or new Revision.
    const submitted = send.mock.calls.at(-1)?.[0];
    if (!submitted) throw Error("QUERY_COMMAND_REQUIRED");
    expect((await send(submitted)).status).toBe(202);
    expect(peer.requests).toHaveLength(3);
    expect(new Set(peer.results.map((r) => r.groundingId)).size).toBe(3);
  });
});
