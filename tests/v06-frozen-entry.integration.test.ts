import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, jest } from "@jest/globals";
import {
  createV06GroundingAnalysis,
  type V06GroundingPersistence,
} from "../apps/server/src/v06-grounding-analysis.js";
import { buildServer } from "../apps/server/src/bootstrap.js";
import { createSdarChatRunner } from "../apps/server/src/chat/sdar-chat-runner.js";
import { parseGroundingAnalysisConfig } from "../packages/wsgs-analysis-adapter/src/config.js";
import { SdarTaskCoordinator } from "../packages/chat-runtime/src/index.js";
import type { SdarA2aClient } from "../packages/sdar-a2a-adapter/src/index.js";
import type { ServerConfig } from "../apps/server/src/config.js";
import { SACS_AG_UI_V03_PROFILE_ID } from "../packages/ag-ui-api-contract/src/index.js";
import { parseAndVerifyAgUiSharedStateV03 } from "../packages/analysis-contract/src/index.js";
import {
  createFrozenChoiceResolution,
  createFrozenSourceQuery,
} from "../packages/analysis-client/src/index.js";
import type { WorldAnalysisViewModel } from "../packages/world-explanation-runtime/src/analysis-view.js";
import { parseTurnPlan } from "../packages/world-grounding-contract/src/index.js";
import {
  FrozenWorldAnalysisContract,
  publicCanonicalHash,
  type AnalysisSelection,
  type GroundingResult12,
} from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import {
  MemoryFrozenAnalysis,
  MemoryFrozenControl,
  MemoryFrozenInteraction,
  frozenNow,
  startFrozenScenarioPeer,
} from "./helpers/memory-frozen-analysis.js";
import { MemoryGrounding } from "./helpers/memory-grounding.js";

const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const secret = "frozen-entry-test-secret-32-characters-minimum";
const userId = "local-user";
const threadId = "local-thread";
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
function headers(user = userId) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(frozenNow().getTime() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "open-webui",
    sub: user,
    role: "user",
    iat: now - 1,
    exp: now + 299,
  });
  const token =
    header +
    "." +
    payload +
    "." +
    createHmac("sha256", secret)
      .update(header + "." + payload)
      .digest("base64url");
  return {
    authorization: "Bearer " + secret,
    "x-openwebui-user-jwt": token,
    "content-type": "application/json",
  };
}
function aguiPayload(
  runId: string,
  text: string,
  forwardedProps: Record<string, unknown> = { mode: "START" },
) {
  return {
    threadId,
    runId,
    state: {},
    messages: text
      ? [{ id: "message-" + runId, role: "user" as const, content: text }]
      : [],
    tools: [],
    context: [],
    forwardedProps,
  };
}
const prohibited = async (): Promise<never> => {
  throw Error("EXECUTION_SIDE_EFFECT_FORBIDDEN");
};
async function setup(
  options: Parameters<typeof startFrozenScenarioPeer>[0] = {},
  now: () => Date = frozenNow,
  maxResultCandidates = 100,
  internalPrincipalId = userId,
) {
  const peer = await startFrozenScenarioPeer(options);
  const grounding = new MemoryGrounding(now);
  const analysis = new MemoryFrozenAnalysis(grounding, now);
  const controls = new MemoryFrozenControl(
    analysis,
    now,
    new Map([[userId, internalPrincipalId]]),
  );
  const interactions = new MemoryFrozenInteraction(now);
  const persistence: V06GroundingPersistence = {
    groundingRepository: grounding,
    analysisRepository: analysis,
    analysisDevelopmentRepository: controls,
    interactionRepository: interactions,
  };
  const makeComposition = () =>
    createV06GroundingAnalysis({
      persistence,
      config: parseGroundingAnalysisConfig({
        SACS_WSGS_ANALYSIS_ENABLED: "true",
        SACS_WSGS_ANALYSIS_TRANSPORT: "GROUNDING_JOB",
        SACS_WSGS_ANALYSIS_POLL_INTERVAL_MS: "10",
        SACS_WSGS_ANALYSIS_MAX_WAIT_MS: "2000",
        SACS_WSGS_ANALYSIS_MAX_RESULT_CANDIDATES: String(maxResultCandidates),
      }),
      wsgsConfig: { baseUrl: peer.baseUrl },
      sdarCompatibilityLock: read(
        "dependencies/sdar-grounding-extension-compatibility-lock.json",
      ),
      now,
    });
  let composition = makeComposition();
  const a2a = {
    protocolBinding: "HTTP+JSON",
    protocolVersion: "1.0",
    endpoint: "http://never-executed.invalid",
    submitTaskStream: jest.fn(async function* () {
      yield await prohibited();
    }),
    sendFollowUp: jest.fn(prohibited),
    getTask: jest.fn(prohibited),
    cancelTask: jest.fn(prohibited),
  } satisfies SdarA2aClient;
  const getClient = jest.fn(async () => a2a);
  // The normal coordinator remains in place; only its persistence and A2A port are controlled.
  const coordinator = new SdarTaskCoordinator({
    getClient,
    repository: {
      claimRequest: prohibited,
      completeRequest: prohibited,
      abandonRequestClaim: prohibited,
      claimTaskSubmissionSlot: prohibited,
      claimTaskInteractionSlot: prohibited,
      releaseTaskSubmissionSlot: prohibited,
      releaseTaskInteractionSlot: prohibited,
      listActiveTasksForChat: async () => [],
      setFocusedTask: prohibited,
      findAuthorizedTask: async () => undefined,
      createTaskBinding: prohibited,
      updateTaskBinding: prohibited,
      recordEvent: prohibited,
    },
  });
  const decideTurn = jest.fn(async () => ({
    schemaVersion: "0.4",
    turnRoute: "WORLD_ANSWER",
    groundingRequirement: "ANSWER_WORLD_QUERY",
    answerMode: "GROUNDED",
    worldFocusUsage: {
      knownWorldReferences: false,
      priorGrounding: false,
      mapSelections: false,
      externalCorrelationHints: false,
      externalPredicates: false,
    },
  }));
  const makeServer = () =>
    buildServer({
      config,
      now: () => frozenNow().getTime(),
      resolveChatThread: async (input) => ({
        ...input,
        threadId,
        principalId:
          input.userId === userId
            ? internalPrincipalId
            : "principal-" + input.userId,
      }),
      resolveAgUiThread: async (input) => ({
        bindingId: "memory-thread-binding",
        clientType: "ag_ui",
        externalThreadId: input.externalThreadId,
        principalId:
          input.userId === userId
            ? internalPrincipalId
            : "principal-" + input.userId,
        threadId,
      }),
      runAgUiV03: composition.runAgUiV03,
      analysisControl: composition.analysisControl,
      analysisCapabilities: composition.capabilities,
      runChat: createSdarChatRunner({
        repository: {
          listActiveTasksForChat: async () => [],
          findAuthorizedTask: async () => undefined,
          touchTaskReference: async () => undefined,
        },
        coordinator,
        worldGrounding: composition.world,
        model: { decideTurn, answer: async () => "受控普通回答" },
      }),
    });
  let server = makeServer();
  await server.ready();
  const agui = async (payload: unknown, user = userId) => {
    const response = await server.inject({
      method: "POST",
      url: "/ag-ui",
      headers: {
        ...headers(user),
        accept: "text/event-stream",
        "x-sacs-ag-ui-profile": SACS_AG_UI_V03_PROFILE_ID,
      },
      payload: JSON.stringify(payload),
    });
    expect(response.statusCode).toBe(200);
    const events = response.body
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
    expect(events.filter((event) => event["type"] === "RUN_ERROR")).toEqual([]);
    return events;
  };
  const chat = async (messageId: string, text: string) => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...headers(),
        "x-openwebui-chat-id": threadId,
        "x-openwebui-message-id": "answer-" + messageId,
        "x-openwebui-user-message-id": messageId,
      },
      payload: {
        model: config.modelId,
        messages: [{ role: "user", content: text }],
        stream: false,
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ choices: { message: { content: string } }[] }>()
      .choices[0]!.message.content;
  };
  return {
    peer,
    grounding,
    analysis,
    controls,
    interactions,
    agui,
    chat,
    decideTurn,
    get composition() {
      return composition;
    },
    get server() {
      return server;
    },
    async rebuild() {
      await server.close();
      await composition.source?.close();
      composition = makeComposition();
      server = makeServer();
      await server.ready();
    },
    assertNoExecution() {
      expect(getClient).not.toHaveBeenCalled();
      for (const method of [
        a2a.submitTaskStream,
        a2a.sendFollowUp,
        a2a.getTask,
        a2a.cancelTask,
      ])
        expect(method).not.toHaveBeenCalled();
    },
    async close() {
      await server.close();
      await composition.source?.close();
      await peer.close();
    },
  };
}
function stateFrom(events: Record<string, unknown>[]) {
  const snapshot = events
    .filter((event) => event["type"] === "STATE_SNAPSHOT")
    .at(-1)?.["snapshot"];
  return parseAndVerifyAgUiSharedStateV03(snapshot);
}
function selector(result: GroundingResult12): AnalysisSelection {
  const choice = result.worldAnalysisFindings.choices[0]!;
  return {
    priorGroundingId: result.groundingId,
    priorResultHash: result.resultHash,
    findingSetHash: result.worldAnalysisFindings.findingSetHash,
    choiceId: choice.choiceId,
    candidateId: choice.candidates[1]!.candidateId,
  };
}
function interactionContext(
  state: ReturnType<typeof stateFrom>,
  now: () => number = () => frozenNow().getTime(),
) {
  return {
    view: state.worldExplanation as unknown as WorldAnalysisViewModel,
    activeRevisionId: state.analysis.activeRevisionId,
    activeRevisionNumber: state.analysis.session.latestRevisionNumber,
    interventionId: state.pendingIntervention?.interventionId,
    now,
  };
}
function choiceCommand(
  state: ReturnType<typeof stateFrom>,
  commandId = "button-command",
) {
  const context = interactionContext(state);
  const choices = context.view.choices.filter((choice) => "selector" in choice);
  return createFrozenChoiceResolution({
    context,
    choices: [choices[1]!],
    commandId,
    idempotencyKey: commandId,
    originalText: "将所选候选作为历史返回目标",
  });
}
function interventionUrl(state: ReturnType<typeof stateFrom>) {
  return `/api/v1/analyses/${state.analysis.session.analysisId}/interventions/${state.pendingIntervention!.interventionId}:resolve`;
}
function proposalUrl(state: ReturnType<typeof stateFrom>) {
  return `/api/v1/analyses/${state.analysis.session.analysisId}/proposals`;
}

describe("frozen normal composition HTTP entries (memory storage, not PostgreSQL)", () => {
  it.each([false, true])(
    "AC-007 AC-008 saves and projects %s async source once through normal AG-UI",
    async (asynchronous) => {
      const app = await setup({ async: asynchronous, repeatedRunning: 2 });
      try {
        const events = await app.agui(
          aguiPayload("first", "查询历史信号最强的两个位置"),
        );
        const state = stateFrom(events);
        const result = app.peer.results[0]!;
        expect(state.worldExplanation).toMatchObject({
          source: {
            sourceId: result.groundingId,
            resultHash: result.resultHash,
          },
        });
        expect(app.peer.requests).toHaveLength(1);
        const execution = [...app.grounding.rows.values()][0]!;
        expect(execution.groundingResult).toEqual(result);
        expect(execution.sourceJobId).toBe(
          asynchronous ? "wire-job-1" : undefined,
        );
        expect(app.analysis.publications).toHaveLength(asynchronous ? 3 : 1);
        const savedHash = publicCanonicalHash(state.worldExplanation);
        const reconnect = await app.agui(
          aguiPayload("reconnect", "", {
            mode: "RECONNECT",
            analysisId: state.analysis.session.analysisId,
          }),
        );
        expect(publicCanonicalHash(stateFrom(reconnect).worldExplanation)).toBe(
          savedHash,
        );
        expect(app.peer.requests).toHaveLength(1);
        app.assertNoExecution();
      } finally {
        await app.close();
      }
    },
  );
  it("AC-033 restores the normal composition from saved memory storage without POST or TTL refresh", async () => {
    const app = await setup();
    try {
      const first = stateFrom(
        await app.agui(aguiPayload("first", "查询历史最强位置")),
      );
      const before = JSON.stringify(first.worldExplanation);
      const count = app.peer.captured.length;
      await app.rebuild();
      const restored = stateFrom(
        await app.agui(
          aguiPayload("reconnect", "", {
            mode: "RECONNECT",
            analysisId: first.analysis.session.analysisId,
          }),
        ),
      );
      expect(JSON.stringify(restored.worldExplanation)).toBe(before);
      expect(app.peer.captured).toHaveLength(count);
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
  it("AC-019 AC-034 AC-039 normal Chat and AG-UI reconnect share one source before START sends a formally anchored second HTTP request", async () => {
    const app = await setup({ examples: ["ranking", "action"] });
    try {
      const text = await app.chat("first-chat", "查询历史信号最强的两个位置");
      expect(text).toContain("-40");
      expect(text).toContain("-42");
      const first = app.peer.results[0]!;
      const initial = [...app.analysis.bindings.values()][0]!;
      const capturedBeforeReconnect = app.peer.captured.length;
      const reconnectEvents = await app.agui(
        aguiPayload("same-source-reconnect", "", {
          mode: "RECONNECT",
          analysisId: initial.session.analysisId,
        }),
      );
      const reconnect = stateFrom(reconnectEvents);
      const view =
        reconnect.worldExplanation as unknown as WorldAnalysisViewModel;
      expect(view.source).toMatchObject({
        sourceId: first.groundingId,
        resultHash: first.resultHash,
        findingSetHash: first.worldAnalysisFindings.findingSetHash,
      });
      expect(reconnect.analysis.session.analysisId).toBe(
        initial.session.analysisId,
      );
      expect(view.summary.primaryText).toBe(text);
      expect(
        reconnectEvents
          .filter((event) => event["type"] === "TEXT_MESSAGE_CONTENT")
          .map((event) => event["delta"])
          .join(""),
      ).toBe(text);
      expect(Object.values(reconnect.map.layersById)).toEqual(view.map.layers);
      expect(view.map.layers.length).toBeGreaterThan(0);
      const findingIds = first.worldAnalysisFindings.findings.map(
        (finding) => finding.findingId,
      );
      for (const layer of view.map.layers) {
        expect(layer.analysisId).toBe(initial.session.analysisId);
        expect(layer.revisionId).toBe(reconnect.analysis.activeRevisionId);
        expect(layer.findingIds.length).toBeGreaterThan(0);
        expect(layer.findingIds.every((id) => findingIds.includes(id))).toBe(
          true,
        );
      }
      expect(reconnect.timeline.items).toEqual(view.timeline.items);
      expect(view.timeline.items.length).toBeGreaterThan(0);
      for (const item of view.timeline.items) {
        expect(item.resultHash).toBe(first.resultHash);
        expect(findingIds).toContain(item.findingId);
      }
      expect(view.choices.length).toBeGreaterThan(0);
      for (const choice of view.choices) {
        expect(choice).toHaveProperty("selector");
        if ("selector" in choice)
          expect(choice.selector).toMatchObject({
            priorGroundingId: first.groundingId,
            priorResultHash: first.resultHash,
            findingSetHash: first.worldAnalysisFindings.findingSetHash,
          });
      }
      expect(app.peer.captured).toHaveLength(capturedBeforeReconnect);
      const second = stateFrom(
        await app.agui(aguiPayload("second", "将第二个作为历史返回目标")),
      );
      expect(app.peer.requests).toHaveLength(2);
      expect(app.peer.requests[1]!.analysisSelections).toEqual([
        selector(first),
      ]);
      expect(app.peer.requests[1]!.contextCapsule.priorGroundings).toEqual([
        {
          groundingId: first.groundingId,
          resultHash: first.resultHash,
          selectedProductIds: [],
        },
      ]);
      new FrozenWorldAnalysisContract().parse("request", app.peer.requests[1]);
      expect(app.peer.results[1]!.groundingId).not.toBe(first.groundingId);
      expect(second.analysis.session.latestRevisionNumber).toBe(1);
      expect(app.analysis.history.size).toBe(2);
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
  it("AC-021 AC-039 AG-UI then Chat share the resolved internal principal when the JWT subject differs", async () => {
    const principalId = "principal-distinct";
    const app = await setup(
      { examples: ["ranking", "action"] },
      frozenNow,
      100,
      principalId,
    );
    try {
      const first = stateFrom(
        await app.agui(aguiPayload("first-distinct", "查询历史最强位置")),
      );
      expect(first.analysis.session.principalId).toBe(principalId);
      expect(principalId).not.toBe(userId);
      const raw = app.peer.results[0]!;
      const answer = await app.chat(
        "second-distinct",
        "将第二个作为历史返回目标",
      );
      expect(answer).toContain("executionAuthorized=false");
      expect(app.peer.requests).toHaveLength(2);
      expect(app.peer.requests[1]!.analysisSelections).toEqual([selector(raw)]);
      expect(app.peer.requests[1]!.contextCapsule.priorGroundings).toEqual([
        {
          groundingId: raw.groundingId,
          resultHash: raw.resultHash,
          selectedProductIds: [],
        },
      ]);
      new FrozenWorldAnalysisContract().parse("request", app.peer.requests[1]);
      expect(app.analysis.bindings.size).toBe(1);
      const bound = [...app.analysis.bindings.values()][0]!;
      expect(bound.session.analysisId).toBe(first.analysis.session.analysisId);
      expect(bound.session.principalId).toBe(principalId);
      expect(bound.revision.revisionNumber).toBe(1);
      expect(app.analysis.history.size).toBe(2);
      expect(
        [...app.grounding.rows.values()].every(
          (row) => row.principalId === principalId,
        ),
      ).toBe(true);
      expect(
        [...app.interactions.rows.values()].every(
          (row) => row.principalId === principalId,
        ),
      ).toBe(true);
      expect(
        await app.analysis.findSession({
          analysisId: first.analysis.session.analysisId,
          principalId: userId,
          threadId,
        }),
      ).toBeUndefined();
      const readable = await app.server.inject({
        method: "GET",
        url: `/api/v1/analyses/${bound.session.analysisId}/snapshot`,
        headers: headers(userId),
      });
      expect(readable.statusCode).toBe(200);
      expect(
        parseAndVerifyAgUiSharedStateV03(readable.json()).analysis
          .activeRevisionId,
      ).toBe(bound.revision.revisionId);
      const impersonated = await app.server.inject({
        method: "GET",
        url: `/api/v1/analyses/${bound.session.analysisId}/snapshot`,
        headers: headers(principalId),
      });
      expect(impersonated.statusCode).toBe(404);
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
  it("AC-020 AC-022 every published Choice kind goes through the normal saved-intervention Control route", async () => {
    const app = await setup({ examples: ["all-choices", "empty"] });
    try {
      const first = stateFrom(
        await app.agui(aguiPayload("first", "查询历史任务、系列和候选")),
      );
      const context = interactionContext(first);
      const choices = context.view.choices
        .filter((choice) => "selector" in choice)
        .filter(
          (choice, index, list) =>
            list.findIndex((item) => item.choiceId === choice.choiceId) ===
            index,
        );
      expect(new Set(choices.map((choice) => choice.choiceKind)).size).toBe(5);
      const command = createFrozenChoiceResolution({
        context,
        choices,
        commandId: "five-choices",
        idempotencyKey: "five-choices",
        originalText: "采用已选的公开候选",
      });
      expect(
        app.analysis.interventions.has(
          first.pendingIntervention!.interventionId,
        ),
      ).toBe(true);
      const send = () =>
        app.server.inject({
          method: "POST",
          url: interventionUrl(first),
          headers: headers(),
          payload: command,
        });
      const accepted = await send();
      expect(accepted.statusCode).toBe(200);
      expect(app.peer.requests).toHaveLength(2);
      expect(app.peer.requests[1]!.analysisSelections).toEqual(
        command.response["analysisSelections"],
      );
      const actual = app.peer.requests[1]!.contextCapsule.priorGroundings[0]!;
      const products =
        app.peer.results[0]!.worldAnalysisFindings.choices.flatMap((choice) => {
          const candidate = choice.candidates[0]!;
          return "referenceProductId" in candidate
            ? [candidate.referenceProductId]
            : [];
        });
      expect(actual.selectedProductIds).toEqual([...new Set(products)]);
      const replay = await send();
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(accepted.json());
      expect(app.peer.requests).toHaveLength(2);
      const next = stateFrom(
        await app.agui(
          aguiPayload("after-control", "", {
            mode: "RECONNECT",
            analysisId: first.analysis.session.analysisId,
          }),
        ),
      );
      expect(next.analysis.session.latestRevisionNumber).toBe(1);
      expect(next.pendingIntervention).toBeUndefined();
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
  it("AC-026 identical concurrent clicks claim one logical source and replay the durable command", async () => {
    const app = await setup({ examples: ["ranking", "action"] });
    try {
      const first = stateFrom(
        await app.agui(aguiPayload("first", "查询两个最强位置")),
      );
      const command = choiceCommand(first);
      const send = () =>
        app.server.inject({
          method: "POST",
          url: interventionUrl(first),
          headers: headers(),
          payload: command,
        });
      const responses = await Promise.all([send(), send()]);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([
        200, 409,
      ]);
      expect(app.peer.requests).toHaveLength(2);
      const replay = await send();
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(
        responses.find((response) => response.statusCode === 200)!.json(),
      );
      expect(app.peer.requests).toHaveLength(2);
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
  it("AC-027 AC-028 AC-029 real proposals create new revisions, local display reuses results, and old late sources cannot overwrite", async () => {
    const app = await setup({ examples: ["action", "ranking"] });
    try {
      const first = stateFrom(
        await app.agui(aguiPayload("first", "查询历史行动候选")),
      );
      const context = interactionContext(first);
      const oldExecution = [...app.grounding.rows.values()][0]!;
      const display = createFrozenSourceQuery({
        context,
        commandId: "display",
        idempotencyKey: "display",
        originalText: "展开卡片",
        contextMode: "CONTINUE",
      });
      const displayed = await app.server.inject({
        method: "POST",
        url: proposalUrl(first),
        headers: headers(),
        payload: display,
      });
      expect(displayed.statusCode).toBe(202);
      expect(displayed.json()).toMatchObject({
        kind: "PRESENTATION",
        action: "EXPAND_CARD",
      });
      expect(app.peer.requests).toHaveLength(1);
      const proposal = createFrozenSourceQuery({
        context,
        commandId: "change",
        idempotencyKey: "change",
        originalText: "改查第二次任务的丢包率并排除暂停",
        contextMode: "REPLACE",
      });
      const changed = await app.server.inject({
        method: "POST",
        url: proposalUrl(first),
        headers: headers(),
        payload: proposal,
      });
      expect(changed.statusCode).toBe(202);
      expect(app.peer.requests).toHaveLength(2);
      expect(app.peer.requests[1]!.source.originalText).toBe(
        proposal.originalText,
      );
      expect(app.peer.requests[1]!.contextCapsule.priorGroundings).toEqual([]);
      expect(app.peer.requests[1]!.analysisSelections).toBeUndefined();
      const scope = {
        analysisId: first.analysis.session.analysisId,
        principalId: userId,
        threadId,
      };
      const next = await app.composition.source!.getProjection(scope);
      const before = JSON.stringify(next);
      expect(
        (next!.state["worldExplanation"] as WorldAnalysisViewModel)
          .actionTargets,
      ).toEqual([]);
      await app.composition.source!.accept(
        oldExecution,
        oldExecution.leaseOwner!,
      );
      expect(app.analysis.historicalObservations).toHaveLength(1);
      expect(
        app.analysis.history.get(
          String(oldExecution.analysisIntent!["revisionId"]),
        )!.run.status,
      ).toBe("SUCCEEDED");
      expect(
        JSON.stringify(await app.composition.source!.getProjection(scope)),
      ).toBe(before);
      expect(app.analysis.history.size).toBe(2);
      expect(app.peer.requests).toHaveLength(2);
      const stale = await app.server.inject({
        method: "POST",
        url: proposalUrl(first),
        headers: headers(),
        payload: { ...proposal, commandId: "stale", idempotencyKey: "stale" },
      });
      expect(stale.statusCode).toBe(409);
      expect(app.peer.requests).toHaveLength(2);
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
  it("AC-021 AC-024 rejects foreign scopes, wrong source anchors and conflicting selector payloads before HTTP", async () => {
    const app = await setup();
    try {
      const first = stateFrom(
        await app.agui(aguiPayload("first", "查询两个最强位置")),
      );
      const command = choiceCommand(first);
      const unauthorized = await app.server.inject({
        method: "POST",
        url: interventionUrl(first),
        headers: headers("foreign-user"),
        payload: command,
      });
      expect(unauthorized.statusCode).toBe(404);
      const source = selector(app.peer.results[0]!);
      for (const [id, selection] of [
        [
          "wrong-grounding",
          [{ ...source, priorGroundingId: "foreign-grounding" }],
        ],
        [
          "wrong-hash",
          [{ ...source, priorResultHash: "sha256:" + "f".repeat(64) }],
        ],
        ["duplicates", [source, source]],
      ] as const) {
        const rejected = await app.server.inject({
          method: "POST",
          url: interventionUrl(first),
          headers: headers(),
          payload: {
            ...command,
            commandId: id,
            idempotencyKey: id,
            response: { ...command.response, analysisSelections: selection },
          },
        });
        expect([409, 422]).toContain(rejected.statusCode);
      }
      expect(app.peer.requests).toHaveLength(1);
      expect(app.analysis.history.size).toBe(1);
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
  it("AC-025 expired saved choices stay readable but cannot produce a second source", async () => {
    let timestamp = frozenNow().getTime();
    const app = await setup({}, () => new Date(timestamp));
    try {
      const first = stateFrom(
        await app.agui(aguiPayload("first", "查询两个最强位置")),
      );
      const command = choiceCommand(first);
      const source = JSON.stringify(app.peer.results[0]);
      timestamp = Date.parse(
        app.peer.results[0]!.worldAnalysisFindings.choices[0]!.validUntil,
      );
      await app.rebuild();
      const restored = stateFrom(
        await app.agui(
          aguiPayload("expired-reconnect", "", {
            mode: "RECONNECT",
            analysisId: first.analysis.session.analysisId,
          }),
        ),
      );
      expect(restored.worldExplanation).toEqual(first.worldExplanation);
      const rejected = await app.server.inject({
        method: "POST",
        url: interventionUrl(first),
        headers: headers(),
        payload: command,
      });
      expect(rejected.statusCode).toBe(410);
      expect(app.peer.requests).toHaveLength(1);
      expect(JSON.stringify(app.peer.results[0])).toBe(source);
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
  it("AC-038 historical target text is intercepted before an SDAR model route or execution", async () => {
    const app = await setup({ examples: ["ranking", "action"] });
    try {
      await app.agui(aguiPayload("first", "查询历史最强位置"));
      const answer = await app.chat("target", "让车返回第二个作为历史目标");
      expect(app.decideTurn).not.toHaveBeenCalled();
      expect(app.peer.requests).toHaveLength(2);
      expect(answer).toContain("executionAuthorized=false");
      expect(answer).toContain("本次不会发起设备或 SDAR 执行");
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
  it("AC-038 deictic vehicle commands with saved historical candidates cannot enter an SDAR model route", async () => {
    const executionPlan = parseTurnPlan({
      schemaVersion: "0.4",
      turnRoute: "SDAR_TASK",
      groundingRequirement: "NONE",
      answerMode: "DIRECT",
      taskDirective: { action: "CREATE" },
      worldFocusUsage: {
        knownWorldReferences: false,
        priorGrounding: false,
        mapSelections: false,
        externalCorrelationHints: false,
        externalPredicates: false,
      },
    });
    for (const [example, text] of [
      ["ranking", "让车返回"],
      ["action", "让车前往那里"],
    ] as const) {
      const app = await setup({ examples: [example] });
      try {
        await app.agui(aguiPayload("first", "查询已发布的历史候选"));
        app.decideTurn.mockImplementation(async () => executionPlan);
        const answer = await app.chat("deictic-target", text);
        expect(answer).toContain("候选");
        expect(app.decideTurn).not.toHaveBeenCalled();
        expect(app.peer.requests).toHaveLength(1);
        expect(app.analysis.history.size).toBe(1);
        app.assertNoExecution();
      } finally {
        await app.close();
      }
    }
  });
  it.each([400, 406, 503] as const)(
    "AC-009 AC-026 HTTP %i after durable prepare preserves old facts and classifies command recoverability",
    async (status) => {
      let timestamp = frozenNow().getTime();
      const app = await setup(
        { rejectSecondPost: status },
        () => new Date(timestamp),
      );
      try {
        const first = stateFrom(
          await app.agui(aguiPayload("first", "查询两个最强位置")),
        );
        const context = interactionContext(first);
        const command = createFrozenSourceQuery({
          context,
          commandId: "rejected",
          idempotencyKey: "rejected",
          originalText: "排除暂停重新查询",
          contextMode: "CONTINUE",
        });
        const send = () =>
          app.server.inject({
            method: "POST",
            url: proposalUrl(first),
            headers: headers(),
            payload: command,
          });
        const rejection = await send();
        expect(rejection.statusCode).toBe(status === 503 ? 503 : 422);
        expect(app.peer.requests).toHaveLength(2);
        const stored = [...app.controls.commands.values()][0]!;
        expect(stored.failure !== undefined).toBe(status !== 503);
        const prepared = app.grounding.rows.get(
          stored.prepared!.groundingExecutionId,
        )!;
        expect(prepared.lastSourceStatus).toBeUndefined();
        expect(prepared.wsgsGroundingId).toBeUndefined();
        expect(prepared.state).toBe("GROUNDING_PENDING");
        const snapshot = await app.server.inject({
          method: "GET",
          url: `/api/v1/analyses/${first.analysis.session.analysisId}/snapshot`,
          headers: headers(),
        });
        expect(snapshot.statusCode).toBe(200);
        expect(
          parseAndVerifyAgUiSharedStateV03(snapshot.json()).worldExplanation,
        ).toEqual(first.worldExplanation);
        const replay = await send();
        expect(replay.statusCode).toBe(status === 503 ? 409 : 422);
        expect(app.peer.requests).toHaveLength(2);
        if (status !== 503) {
          timestamp += 181000;
          const recoverable = await app.grounding.claimRecoverable({
            leaseOwner: "recovery-test",
            sourceOnly: true,
          });
          expect(recoverable).toEqual([]);
          const corrected = await app.server.inject({
            method: "POST",
            url: proposalUrl(first),
            headers: headers(),
            payload: {
              ...command,
              commandId: "corrected",
              idempotencyKey: "corrected",
              originalText: "改查可用的历史窗口",
            },
          });
          expect(corrected.statusCode).toBe(202);
          expect(app.peer.requests).toHaveLength(3);
        }
        app.assertNoExecution();
      } finally {
        await app.close();
      }
    },
  );
  it("AC-010 AC-026 command kind separates source-query and choice-resolution HTTP identities", async () => {
    const app = await setup({ examples: ["ranking", "ranking", "empty"] });
    try {
      const first = stateFrom(
        await app.agui(aguiPayload("first", "查询两个最强位置")),
      );
      const proposal = createFrozenSourceQuery({
        context: interactionContext(first),
        commandId: "same-command",
        idempotencyKey: "same-command",
        originalText: "排除暂停",
        contextMode: "CONTINUE",
      });
      expect(
        (
          await app.server.inject({
            method: "POST",
            url: proposalUrl(first),
            headers: headers(),
            payload: proposal,
          })
        ).statusCode,
      ).toBe(202);
      const second = stateFrom(
        await app.agui(
          aguiPayload("second", "", {
            mode: "RECONNECT",
            analysisId: first.analysis.session.analysisId,
          }),
        ),
      );
      const button = choiceCommand(second, "same-command");
      expect(
        (
          await app.server.inject({
            method: "POST",
            url: interventionUrl(second),
            headers: headers(),
            payload: button,
          })
        ).statusCode,
      ).toBe(200);
      expect(app.peer.requests).toHaveLength(3);
      expect(
        new Set(app.peer.requests.map((request) => request.requestId)).size,
      ).toBe(3);
      const keys = app.peer.captured
        .filter(
          (request) =>
            request.method === "POST" && request.path === "/v1/groundings",
        )
        .map((request) => request.headers["idempotency-key"]);
      expect(new Set(keys).size).toBe(3);
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
  it("AC-033 recovers terminal new-revision binding after a projection-write crash without reposting", async () => {
    let timestamp = frozenNow().getTime();
    const app = await setup(
      { examples: ["ranking", "empty"] },
      () => new Date(timestamp),
    );
    try {
      const first = stateFrom(
        await app.agui(aguiPayload("first", "查询两个最强位置")),
      );
      const write = app.analysis.projectGroundingSource.bind(app.analysis);
      const fail = jest
        .spyOn(app.analysis, "projectGroundingSource")
        .mockImplementation(async (input) => {
          if (input.revisionId !== first.analysis.activeRevisionId)
            throw Error("MEMORY_STORAGE_WRITE_CRASH");
          return write(input);
        });
      const command = createFrozenSourceQuery({
        context: interactionContext(first),
        commandId: "crash",
        idempotencyKey: "crash",
        originalText: "排除暂停",
        contextMode: "CONTINUE",
      });
      const response = await app.server.inject({
        method: "POST",
        url: proposalUrl(first),
        headers: headers(),
        payload: command,
      });
      expect(response.statusCode).toBe(503);
      expect(app.peer.requests).toHaveLength(2);
      const bound = [...app.analysis.bindings.values()][0]!;
      expect(bound.revision.revisionNumber).toBe(1);
      expect(
        [...app.analysis.projections.values()][0]!.state["worldExplanation"],
      ).toEqual(first.worldExplanation);
      expect(
        app.grounding.rows.get(bound.groundingExecutionId)!.lastSourceStatus,
      ).toBe("COMPLETED");
      fail.mockRestore();
      timestamp += 181000;
      await app.rebuild();
      expect(await app.composition.source!.recover()).toBe(1);
      const restored = stateFrom(
        await app.agui(
          aguiPayload("restored", "", {
            mode: "RECONNECT",
            analysisId: first.analysis.session.analysisId,
          }),
        ),
      );
      expect(restored.analysis.activeRevisionId).toBe(
        bound.revision.revisionId,
      );
      expect(restored.worldExplanation?.["groundingId"]).toBe(
        app.peer.results[1]!.groundingId,
      );
      expect(app.peer.requests).toHaveLength(2);
      expect(
        app.grounding.projectionReceipts.get(bound.groundingExecutionId),
      ).toBe(
        app.grounding.rows.get(bound.groundingExecutionId)!.lastObservationHash,
      );
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
  it("AC-036 normal control resolves a hidden candidate from saved complete authority after view clipping", async () => {
    const app = await setup({ examples: ["ranking", "empty"] }, frozenNow, 1);
    try {
      const first = stateFrom(
        await app.agui(aguiPayload("first", "查询两个最强位置")),
      );
      expect(interactionContext(first).view.choices).toHaveLength(1);
      const raw = app.peer.results[0]!;
      expect(raw.worldAnalysisFindings.choices[0]!.candidates).toHaveLength(2);
      await app.chat("hidden-second", "采用第二个");
      expect(app.peer.requests).toHaveLength(2);
      expect(app.peer.requests[1]!.analysisSelections).toEqual([selector(raw)]);
      expect(app.grounding.rows.values().next().value!.groundingResult).toEqual(
        raw,
      );
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
  it.each(["all-choices", "empty"])(
    "AC-023 ordinal with %s context clarifies without an additional HTTP request",
    async (example) => {
      const app = await setup({ examples: [example] });
      try {
        await app.agui(aguiPayload("first", "查询公开历史结果"));
        const answer = await app.chat("ambiguous-ordinal", "第二个");
        expect(answer).toContain(
          example === "empty" ? "没有可唯一确定" : "多个候选列表",
        );
        expect([...app.controls.commands.values()][0]!.result).toMatchObject({
          kind: "CLARIFICATION",
          reasonCode:
            example === "empty"
              ? "SELECTION_CONTEXT_REQUIRED"
              : "SELECTION_AMBIGUOUS",
        });
        expect(app.peer.requests).toHaveLength(1);
        expect(app.analysis.history.size).toBe(1);
        app.assertNoExecution();
      } finally {
        await app.close();
      }
    },
  );
  it.each(["provider-failure", "projection-pending"])(
    "AC-030 normal asynchronous %s stops at its published source terminal",
    async (example) => {
      const app = await setup({ examples: [example], async: true });
      try {
        const first = stateFrom(
          await app.agui(aguiPayload("first", "查询公开历史结果")),
        );
        const source = [...app.grounding.rows.values()][0]!;
        expect(source.lastSourceStatus).toBe(
          example === "provider-failure" ? "FAILED" : "PARTIAL",
        );
        expect(first.worldExplanation?.["status"]).toBe(
          source.lastSourceStatus,
        );
        const count = app.peer.captured.length;
        await app.agui(
          aguiPayload("read-terminal", "", {
            mode: "RECONNECT",
            analysisId: first.analysis.session.analysisId,
          }),
        );
        expect(app.peer.captured).toHaveLength(count);
        app.assertNoExecution();
      } finally {
        await app.close();
      }
    },
  );
  it("AC-031 AC-032 normal cancellation records intent, invokes HTTP cancel, and settles only from observed source status", async () => {
    const app = await setup({ async: true, repeatedRunning: 1000 });
    const detached = new AbortController();
    try {
      const iterator = app.composition.runAgUiV03!({
        input: aguiPayload("start-for-cancel", "查询公开历史结果"),
        principalId: userId,
        internalThreadId: threadId,
        signal: detached.signal,
        profile: SACS_AG_UI_V03_PROFILE_ID,
      })[Symbol.asyncIterator]();
      expect((await iterator.next()).value?.type).toBe("RUN_STARTED");
      detached.abort();
      await iterator.return?.();
      expect(
        app.peer.captured.filter((request) => request.path.endsWith(":cancel")),
      ).toHaveLength(0);
      const bound = [...app.analysis.bindings.values()][0]!;
      const command = {
        commandId: "cancel",
        idempotencyKey: "cancel",
        expectedRevisionId: bound.revision.revisionId,
        expectedRevisionNumber: bound.revision.revisionNumber,
        reason: "USER_REQUESTED",
      };
      const send = () =>
        app.server.inject({
          method: "POST",
          url: `/api/v1/analyses/${bound.session.analysisId}/cancel`,
          headers: headers(),
          payload: command,
        });
      const accepted = await send();
      expect(accepted.statusCode).toBe(202);
      expect(
        app.grounding.rows.get(bound.groundingExecutionId)!.cancelRequested,
      ).toBe(true);
      await app.composition.source!.pump.settle();
      expect(
        app.grounding.rows.get(bound.groundingExecutionId)!.lastSourceStatus,
      ).toBe("CANCELLED");
      const result = await app.composition.source!.getProjection({
        analysisId: bound.session.analysisId,
        principalId: userId,
        threadId,
      });
      expect(
        parseAndVerifyAgUiSharedStateV03(result!.state).analysis.runsById[
          bound.run.runId
        ]!.status,
      ).toBe("CANCELLED");
      expect(
        app.peer.captured.filter((request) => request.path.endsWith(":cancel")),
      ).toHaveLength(1);
      const replay = await send();
      expect(replay.statusCode).toBe(202);
      expect(replay.json()).toEqual(accepted.json());
      expect(
        app.peer.captured.filter((request) => request.path.endsWith(":cancel")),
      ).toHaveLength(1);
      app.assertNoExecution();
    } finally {
      await app.close();
    }
  });
});
