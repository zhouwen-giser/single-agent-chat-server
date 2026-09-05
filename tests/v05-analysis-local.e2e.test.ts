import { createHmac, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { FastifyInstance } from "fastify";
import pg from "pg";

import { createV05AnalysisDevelopmentServer } from "../apps/server/src/v05-analysis-development.js";
import type { ServerConfig } from "../apps/server/src/config.js";
import { SACS_AG_UI_V03_PROFILE_ID } from "../packages/ag-ui-api-contract/src/index.js";
import {
  HeadlessAnalysisReferenceClient,
  HeadlessMapEngineAdapter,
} from "../packages/analysis-client/src/index.js";
import type {
  AnalysisRevision,
  AnalysisRun,
  FocusTarget,
} from "../packages/analysis-contract/src/index.js";
import {
  setupPersistence,
  type PersistenceRuntime,
} from "../packages/persistence/src/index.js";
import type {
  FixtureWsgsAnalysisAdapter,
  FixtureWsgsAnalysisScenario,
} from "../packages/wsgs-analysis-adapter/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;
const databaseName = `sacs_v05_local_e2e_${randomUUID().replaceAll("-", "")}`;
const nowMilliseconds = Date.parse("2026-09-05T04:00:00.000Z");
const nowSeconds = Math.floor(nowMilliseconds / 1_000);
const runtimeNow = "2026-09-05T04:00:00.000Z";
const userId = "v05-local-e2e-user";
const serviceKey = "v05-local-e2e-service-key-at-least-32-characters";
const agUiServiceKey = "v05-local-e2e-ag-ui-service-key-at-least-32-characters";
const jwtSecret = "v05-local-e2e-jwt-secret-at-least-32-characters";
const principalJwt = signPrincipal(userId);
const config: ServerConfig = {
  serviceKey,
  agUiServiceKey,
  openWebUiUserJwtSecret: jwtSecret,
  host: "127.0.0.1",
  port: 3000,
  bodyLimitBytes: 262_144,
  requestTimeoutMs: 10_000,
  modelId: "sdar-single-agent",
  corsAllowedOrigins: [],
  rateLimitMax: 200,
  rateLimitWindowMs: 60_000,
  maxMessages: 64,
  maxMessageChars: 32_768,
  maxResponseChars: 65_536,
  logLevel: "silent",
  streamBudgetMs: 30_000,
  pollingBudgetMs: 5_000,
  pollingIntervalMs: 1_000,
};

interface AnalysisSummary {
  readonly analysisId: string;
  readonly groundingId: string;
  readonly status: string;
  readonly activeRevision: AnalysisRevision;
  readonly currentRun: AnalysisRun;
  readonly stateRevision: number;
  readonly pendingIntervention?: {
    readonly interventionId: string;
    readonly interruptId: string;
    readonly reason: string;
    readonly status: string;
  };
}

interface AnalysisSnapshotResponse {
  readonly analysis: {
    readonly session: {
      readonly activeRevisionId: string;
      readonly latestRevisionNumber: number;
    };
    readonly activeRevisionId: string;
    readonly revisionsById: Readonly<Record<string, AnalysisRevision>>;
    readonly runsById: Readonly<Record<string, AnalysisRun>>;
  };
}

interface AnalysisRunFixture {
  readonly analysisId: string;
  readonly groundingId: string;
  readonly externalThreadId: string;
  readonly runId: string;
  readonly client: HeadlessAnalysisReferenceClient;
  readonly mapEngine: HeadlessMapEngineAdapter;
}

interface DevelopmentControlAudit {
  readonly revision_count: number;
  readonly proposal_count: number;
  readonly control_command_count: number;
}

describeWithPostgres("v0.5 local HTTP/AG-UI/PostgreSQL functional E2E", () => {
  let adminPool: pg.Pool | undefined;
  let persistence: PersistenceRuntime | undefined;
  let auditPool: pg.Pool | undefined;
  let server: FastifyInstance | undefined;
  let adapter: FixtureWsgsAnalysisAdapter | undefined;
  let baseUrl = "";
  let nextRuntimeId = 0;

  beforeAll(async () => {
    if (connectionString === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    adminPool = new Pool({ connectionString, max: 1 });
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    const isolatedConnection = withDatabase(connectionString, databaseName);
    persistence = await setupPersistence({
      connectionString: isolatedConnection,
      poolMax: 12,
      operationTimeoutMs: 10_000,
      idempotencyLeaseMs: 60_000,
      maxActiveTasksPerChat: 8,
    });
    auditPool = new Pool({ connectionString: isolatedConnection, max: 1 });
    const composition = createV05AnalysisDevelopmentServer({
      config,
      persistence,
      environment: { nodeEnv: "test", adapterMode: "fixture" },
      httpNow: () => nowMilliseconds,
      runtimeNow: () => runtimeNow,
      runtimeNextId: (kind) => `${kind}-v05-local-e2e-${++nextRuntimeId}`,
    });
    server = composition.server;
    adapter = composition.adapter;
    baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    if (server !== undefined) {
      await server.close();
    } else {
      await persistence?.close();
    }
    await auditPool?.end();
    if (adminPool !== undefined) {
      await waitForDatabaseDisconnect(adminPool, databaseName);
      await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await adminPool.end();
    }
  });

  it("DEV-E2E-01 runs unattended read-only analysis successfully with zero interrupts", async () => {
    const readiness = await fetch(`${baseUrl}/ready`);
    expect(readiness.status).toBe(200);
    await expect(readiness.json()).resolves.toMatchObject({
      status: "ready",
      checks: { postgres: "ok" },
    });
    const countersBefore = fixtureAdapter().getCounters();
    const run = await startAnalysis("unattended", "SUCCESS");
    const summary = await getAnalysis(run.analysisId);

    expect(run.client.state.runStatus).toBe("FINISHED");
    expect(run.client.state.pendingInterrupts).toEqual([]);
    expect(run.client.state.sharedState?.pendingIntervention).toBeUndefined();
    expect(summary.currentRun).toMatchObject({
      runId: run.runId,
      status: "SUCCEEDED",
    });
    expect(summary.activeRevision.status).toBe("COMPLETED");
    expect(fixtureAdapter().getCounters()).toMatchObject({
      toolExecutions: countersBefore.toolExecutions + 1,
      clientPublicArgsExecutions: 0,
    });
  });

  it("DEV-E2E-02 keeps pan, zoom, hover, and inspection local with zero backend commands", async () => {
    const run = await startAnalysis("map-observation", "SUCCESS");
    const countersBefore = fixtureAdapter().getCounters();
    const auditBefore = await controlAudit(run.analysisId);
    const summaryBefore = await getAnalysis(run.analysisId);
    const inspection = focus("inspection-focus");

    await run.client.dispatchMapAction({
      type: "PAN",
      viewport: { longitude: 121.47, latitude: 31.23 },
    });
    await run.client.dispatchMapAction({ type: "ZOOM", zoom: 11 });
    await run.client.dispatchMapAction({
      type: "HOVER",
      hover: { layerId: "fixture-layer", featureId: "feature-1" },
    });
    await run.client.dispatchMapAction({
      type: "INSPECT",
      focus: inspection,
    });
    const summaryAfter = await getAnalysis(run.analysisId);
    const auditAfter = await controlAudit(run.analysisId);

    expect(run.client.mapPresentation.local).toMatchObject({
      viewport: { zoom: 11 },
      hover: { featureId: "feature-1" },
      inspectionFocus: inspection,
    });
    expect(run.mapEngine.inspectionFocuses).toEqual([inspection]);
    expect(run.mapEngine.localMapActions.map(({ type }) => type)).toEqual([
      "PAN",
      "ZOOM",
      "HOVER",
      "INSPECT",
    ]);
    expect(summaryAfter).toEqual(summaryBefore);
    expect(auditAfter).toEqual(auditBefore);
    expect(auditAfter).toMatchObject({
      proposal_count: 0,
      control_command_count: 0,
    });
    expect(fixtureAdapter().getCounters()).toEqual(countersBefore);
  });

  it("DEV-E2E-03 changes pinned focus without creating or activating a Revision", async () => {
    const run = await startAnalysis("pin-focus", "SUCCESS");
    const before = await getSnapshot(run.analysisId);
    const auditBefore = await controlAudit(run.analysisId);
    const countersBefore = fixtureAdapter().getCounters();
    const pinnedFocus = focus("pinned-focus");
    await run.client.dispatchMapAction({
      type: "FOCUS_PIN",
      focus: pinnedFocus,
    });
    const after = await getSnapshot(run.analysisId);
    const auditAfter = await controlAudit(run.analysisId);

    expect(
      run.client.mapPresentation.shared?.pinnedFocusById[pinnedFocus.focusId],
    ).toEqual(pinnedFocus);
    expect(after.analysis.activeRevisionId).toBe(
      before.analysis.activeRevisionId,
    );
    expect(after.analysis.session.latestRevisionNumber).toBe(
      before.analysis.session.latestRevisionNumber,
    );
    expect(Object.keys(after.analysis.revisionsById)).toEqual(
      Object.keys(before.analysis.revisionsById),
    );
    expect(auditAfter).toEqual(auditBefore);
    expect(auditAfter).toMatchObject({
      revision_count: 1,
      proposal_count: 0,
      control_command_count: 0,
    });
    expect(fixtureAdapter().getCounters()).toEqual(countersBefore);
  });

  it("DEV-E2E-04 compiles an immutable next Revision while the current Run remains active", async () => {
    const run = await startAnalysis("suggest-next", "AMBIGUITY");
    const before = await getSnapshot(run.analysisId);
    const beforeSummary = await getAnalysis(run.analysisId);
    const descriptor = publishedDescriptor(run);
    const compileCountBefore =
      fixtureAdapter().getCounters().executions.COMPILE_REVISION;
    const invalidPatches = [
      {
        label: "negative-radius",
        patch: [{ op: "replace", path: "/radiusMeters", value: -1 }],
      },
      {
        label: "oversized-radius",
        patch: [{ op: "replace", path: "/radiusMeters", value: 1e12 }],
      },
      {
        label: "invalid-relation",
        patch: [{ op: "replace", path: "/relation", value: "outside" }],
      },
    ] as const;
    for (const invalid of invalidPatches) {
      const invalidResponse = await fetch(
        `${baseUrl}/api/v1/analyses/${run.analysisId}/proposals`,
        {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({
            ...proposalCommand(invalid.label, beforeSummary, descriptor),
            patch: invalid.patch,
          }),
        },
      );
      const invalidBody = (await invalidResponse.json()) as {
        readonly error?: { readonly code?: string };
      };
      expect(invalidResponse.status).toBe(422);
      expect(invalidBody.error?.code).toBe("PUBLIC_ARGS_SCHEMA_INVALID");
      expect(fixtureAdapter().getCounters().executions.COMPILE_REVISION).toBe(
        compileCountBefore,
      );
    }
    const response = await requestJson<{
      readonly status: string;
      readonly proposalId: string;
      readonly revisionId: string;
      readonly appliedRevisionId: string;
    }>(`/api/v1/analyses/${run.analysisId}/proposals`, {
      method: "POST",
      body: proposalCommand("suggest-next", beforeSummary, descriptor),
      expectedStatus: 202,
    });
    const afterSummary = await getAnalysis(run.analysisId);
    const after = await getSnapshot(run.analysisId);
    const nextRevision = after.analysis.revisionsById[response.revisionId];

    expect(beforeSummary.currentRun.status).toBe("WAITING_INTERVENTION");
    expect(afterSummary.currentRun).toEqual(beforeSummary.currentRun);
    expect(afterSummary.activeRevision.revisionId).toBe(
      beforeSummary.activeRevision.revisionId,
    );
    expect(response).toMatchObject({
      status: "COMPILED",
      appliedRevisionId: response.revisionId,
    });
    expect(nextRevision).toMatchObject({
      parentRevisionId: beforeSummary.activeRevision.revisionId,
      revisionNumber: beforeSummary.activeRevision.revisionNumber + 1,
      cause: "USER_PROPOSAL",
      status: "QUEUED",
    });
    expect(
      after.analysis.revisionsById[beforeSummary.activeRevision.revisionId],
    ).toEqual(
      before.analysis.revisionsById[beforeSummary.activeRevision.revisionId],
    );
    expect(fixtureAdapter().getCounters().executions.COMPILE_REVISION).toBe(
      compileCountBefore + 1,
    );
  });

  it("DEV-E2E-05 persists reference ambiguity and projects a real AG-UI interrupt", async () => {
    const toolExecutionsBefore = fixtureAdapter().getCounters().toolExecutions;
    const run = await startAnalysis("ambiguity", "AMBIGUITY");
    const summary = await getAnalysis(run.analysisId);
    const intervention = run.client.state.sharedState?.pendingIntervention;

    expect(run.client.state.runStatus).toBe("INTERRUPTED");
    expect(run.client.state.pendingInterrupts).toHaveLength(1);
    expect(intervention).toMatchObject({
      reason: "AMBIGUITY",
      status: "OPEN",
    });
    expect(summary.pendingIntervention).toMatchObject({
      interventionId: intervention?.interventionId,
      interruptId: intervention?.interruptId,
      reason: "AMBIGUITY",
      status: "OPEN",
    });
    expect(summary.currentRun.status).toBe("WAITING_INTERVENTION");
    expect(fixtureAdapter().getCounters().toolExecutions).toBe(
      toolExecutionsBefore,
    );
  });

  it("DEV-E2E-06 completes DATA_GAP automatically as unknown with zero interrupts", async () => {
    const gapCountBefore = fixtureAdapter().getCounters().dataGapCompletions;
    const run = await startAnalysis("data-gap", "DATA_GAP");
    const summary = await getAnalysis(run.analysisId);
    const publishedText = Object.values(run.client.state.textByMessageId).join(
      "\n",
    );
    const toolResult = Object.values(run.client.state.toolCallsById).find(
      (toolCall) => toolCall.status === "RESULT",
    )?.result;

    expect(run.client.state.runStatus).toBe("FINISHED");
    expect(run.client.state.pendingInterrupts).toEqual([]);
    expect(run.client.state.sharedState?.pendingIntervention).toBeUndefined();
    expect(summary.currentRun.status).toBe("PARTIAL");
    expect(toolResult?.status).toBe("NO_DATA");
    expect(publishedText).toContain("DATA_GAP");
    expect(publishedText.toLowerCase()).toContain("unknown");
    expect(publishedText).not.toMatch(/(?:is false|does not exist)/iu);
    expect(fixtureAdapter().getCounters().dataGapCompletions).toBe(
      gapCountBefore + 1,
    );
  });

  it("DEV-E2E-07 returns exact 409 ANALYSIS_REVISION_CONFLICT for a stale Proposal", async () => {
    const run = await startAnalysis("stale-proposal", "AMBIGUITY");
    const summary = await getAnalysis(run.analysisId);
    const descriptor = publishedDescriptor(run);
    const compileCountBefore =
      fixtureAdapter().getCounters().executions.COMPILE_REVISION;
    const response = await fetch(
      `${baseUrl}/api/v1/analyses/${run.analysisId}/proposals`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          ...proposalCommand("stale", summary, descriptor),
          expectedRevisionId: "revision-that-is-stale",
        }),
      },
    );
    const body = (await response.json()) as {
      readonly error?: { readonly code?: string };
    };

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("ANALYSIS_REVISION_CONFLICT");
    expect(fixtureAdapter().getCounters().executions.COMPILE_REVISION).toBe(
      compileCountBefore,
    );
  });

  it("DEV-E2E-08 restores State and Activity on reconnect without adapter re-execution", async () => {
    const run = await startAnalysis("reconnect", "SUCCESS");
    const sharedBefore = structuredClone(requiredSharedState(run.client));
    const activitiesBefore = structuredClone(
      run.client.state.activitiesByMessageId,
    );
    const countersBefore = fixtureAdapter().getCounters();

    await run.client.disconnect();
    expect(run.client.state.connected).toBe(false);
    expect(run.client.reconnect()).toEqual([
      "REQUEST_FULL_STATE_SNAPSHOT",
      "REQUEST_FULL_ACTIVITY_SNAPSHOT",
    ]);
    await streamAnalysisToClient({
      ...run,
      runId: `${run.runId}-reconnect`,
      scenario: "SUCCESS",
      mode: "RECONNECT",
    });

    expect(run.client.state).toMatchObject({
      connected: true,
      runStatus: "FINISHED",
      currentRunHasStateSnapshot: true,
      currentRunHasActivitySnapshot: true,
      needsFullStateSnapshot: false,
      needsFullActivitySnapshot: false,
    });
    expect(run.client.state.sharedState).toEqual(sharedBefore);
    expect(run.client.state.activitiesByMessageId).toEqual(activitiesBefore);
    expect(fixtureAdapter().getCounters()).toEqual(countersBefore);
  });

  async function startAnalysis(
    label: string,
    scenario: FixtureWsgsAnalysisScenario,
  ): Promise<AnalysisRunFixture> {
    const mapEngine = new HeadlessMapEngineAdapter();
    const fixture: AnalysisRunFixture = {
      analysisId: `analysis-${label}`,
      groundingId: `grounding-${label}`,
      externalThreadId: `thread-${label}`,
      runId: `run-${label}`,
      mapEngine,
      client: new HeadlessAnalysisReferenceClient(mapEngine),
    };
    await streamAnalysisToClient({
      ...fixture,
      scenario,
      mode: "START",
    });
    return fixture;
  }

  async function streamAnalysisToClient(input: {
    readonly analysisId: string;
    readonly groundingId: string;
    readonly externalThreadId: string;
    readonly runId: string;
    readonly client: HeadlessAnalysisReferenceClient;
    readonly scenario: FixtureWsgsAnalysisScenario;
    readonly mode: "START" | "RECONNECT";
  }): Promise<void> {
    const response = await fetch(`${baseUrl}/ag-ui`, {
      method: "POST",
      headers: {
        ...jsonHeaders(),
        accept: "text/event-stream",
        "x-sacs-ag-ui-profile": SACS_AG_UI_V03_PROFILE_ID,
      },
      body: JSON.stringify({
        threadId: input.externalThreadId,
        runId: input.runId,
        state: {},
        messages: [],
        tools: [],
        context: [],
        forwardedProps: {
          analysisId: input.analysisId,
          groundingId: input.groundingId,
          scenario: input.scenario,
          mode: input.mode,
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(
      /^text\/event-stream/iu,
    );
    if (response.body === null) throw new Error("AG-UI SSE body is missing");
    const reader = response.body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      await input.client.acceptSseChunk(chunk.value);
    }
    await input.client.finishStream();
  }

  async function getAnalysis(analysisId: string): Promise<AnalysisSummary> {
    return requestJson(`/api/v1/analyses/${analysisId}`, {
      expectedStatus: 200,
    });
  }

  async function getSnapshot(
    analysisId: string,
  ): Promise<AnalysisSnapshotResponse> {
    return requestJson(`/api/v1/analyses/${analysisId}/snapshot`, {
      expectedStatus: 200,
    });
  }

  async function requestJson<T>(
    path: string,
    options: {
      readonly method?: "GET" | "POST";
      readonly body?: unknown;
      readonly expectedStatus: number;
    },
  ): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: jsonHeaders(),
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    const body = (await response.json()) as T;
    expect(response.status).toBe(options.expectedStatus);
    return body;
  }

  function fixtureAdapter(): FixtureWsgsAnalysisAdapter {
    if (adapter === undefined) throw new Error("fixture adapter not started");
    return adapter;
  }

  async function controlAudit(
    analysisId: string,
  ): Promise<DevelopmentControlAudit> {
    if (auditPool === undefined) throw new Error("audit pool not started");
    const result = await auditPool.query<DevelopmentControlAudit>(
      `
        SELECT
          (SELECT count(*)::int
             FROM chat_service.analysis_revision
            WHERE analysis_id = $1) AS revision_count,
          (SELECT count(*)::int
             FROM chat_service.analysis_change_proposal
            WHERE analysis_id = $1) AS proposal_count,
          (SELECT count(*)::int
             FROM chat_service.analysis_control_command
            WHERE analysis_id = $1) AS control_command_count
      `,
      [analysisId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("analysis audit is missing");
    return row;
  }
});

function proposalCommand(
  label: string,
  summary: AnalysisSummary,
  descriptor: PublishedDescriptor,
) {
  return {
    commandId: `command-${label}`,
    proposalId: `proposal-${label}`,
    expectedRevisionId: summary.activeRevision.revisionId,
    expectedRevisionNumber: summary.activeRevision.revisionNumber,
    targetNodeId: descriptor.nodeId,
    publicArgsHash: descriptor.publicArgsHash,
    editSchemaHash: descriptor.publicEditSchemaHash,
    patch: [{ op: "replace", path: "/radiusMeters", value: 750 }],
    mode: "SUGGEST_NEXT_REVISION",
    idempotencyKey: `idempotency-${label}`,
  } as const;
}

interface PublishedDescriptor {
  readonly nodeId: string;
  readonly publicArgsHash: string;
  readonly publicEditSchemaHash: string;
}

function publishedDescriptor(run: AnalysisRunFixture): PublishedDescriptor {
  const activity =
    run.client.state.activitiesByMessageId[`${run.analysisId}:activity`];
  const interactions = recordField(
    activity?.content,
    "toolInteractionsByNodeId",
  );
  const descriptor = recordField(interactions, "query");
  return {
    nodeId: stringField(descriptor, "nodeId"),
    publicArgsHash: stringField(descriptor, "publicArgsHash"),
    publicEditSchemaHash: stringField(descriptor, "publicEditSchemaHash"),
  };
}

function requiredSharedState(client: HeadlessAnalysisReferenceClient) {
  const shared = client.state.sharedState;
  if (shared === undefined) throw new Error("AG-UI shared state is missing");
  return shared;
}

function focus(focusId: string): FocusTarget {
  return {
    focusId,
    targetKind: "TOOL_OUTPUT",
    analysisNodeId: "query",
    semanticRole: "SELECTED_RESULT",
    currentness: "CURRENT",
  };
}

function jsonHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${agUiServiceKey}`,
    "x-openwebui-user-jwt": principalJwt,
    "content-type": "application/json",
  };
}

function signPrincipal(subject: string): string {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "open-webui",
    sub: subject,
    role: "user",
    iat: nowSeconds - 1,
    exp: nowSeconds + 299,
  });
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${payload}`, "ascii")
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function withDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}

async function waitForDatabaseDisconnect(
  adminPool: pg.Pool,
  database: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const result = await adminPool.query<{ connection_count: string }>(
      `
        SELECT count(*) AS connection_count
        FROM pg_stat_activity
        WHERE datname = $1
      `,
      [database],
    );
    if (Number(result.rows[0]?.connection_count ?? 0) === 0) return;
    if (Date.now() >= deadline) {
      throw new Error("v0.5 E2E PostgreSQL connections did not close");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function recordField(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected record before ${field}`);
  }
  const result = (value as Readonly<Record<string, unknown>>)[field];
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`Expected record field ${field}`);
  }
  return result as Readonly<Record<string, unknown>>;
}

function stringField(
  value: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const result = value[field];
  if (typeof result !== "string") throw new Error(`Expected string ${field}`);
  return result;
}
