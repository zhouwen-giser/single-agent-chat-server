import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { FastifyInstance } from "fastify";

import { buildServer } from "../apps/server/src/bootstrap.js";
import type { ServerConfig } from "../apps/server/src/config.js";
import {
  AnalysisServiceError,
  type AnalysisControlService,
} from "../packages/analysis-control-runtime/src/index.js";

const openAiServiceKey = "analysis-openai-service-key-at-least-32-characters";
const agUiServiceKey = "analysis-agui-service-key-at-least-32-characters";
const jwtSecret = "analysis-principal-jwt-secret-at-least-32-characters";
const nowMilliseconds = 1_700_000_000_000;
const nowSeconds = Math.floor(nowMilliseconds / 1_000);
const hash = `sha256:${"0".repeat(64)}`;
const config: ServerConfig = {
  serviceKey: openAiServiceKey,
  agUiServiceKey,
  openWebUiUserJwtSecret: jwtSecret,
  host: "127.0.0.1",
  port: 3000,
  bodyLimitBytes: 262_144,
  requestTimeoutMs: 5_000,
  modelId: "sdar-single-agent",
  corsAllowedOrigins: [],
  rateLimitMax: 60,
  rateLimitWindowMs: 60_000,
  maxMessages: 64,
  maxMessageChars: 32_768,
  maxResponseChars: 65_536,
  logLevel: "silent",
  streamBudgetMs: 30_000,
  pollingBudgetMs: 5_000,
  pollingIntervalMs: 1_000,
};
const headers = {
  authorization: `Bearer ${agUiServiceKey}`,
  "x-openwebui-user-jwt": signPrincipal("principal-1"),
};
const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("v0.5 analysis control API", () => {
  it("requires both the independent service key and signed principal", async () => {
    const server = createServer(service());
    const wrongService = await server.inject({
      method: "GET",
      url: "/api/v1/analyses/analysis-1",
      headers: {
        authorization: `Bearer ${openAiServiceKey}`,
        "x-openwebui-user-jwt": headers["x-openwebui-user-jwt"],
      },
    });
    const missingPrincipal = await server.inject({
      method: "GET",
      url: "/api/v1/analyses/analysis-1",
      headers: { authorization: `Bearer ${agUiServiceKey}` },
    });
    expect(wrongService.statusCode).toBe(401);
    expect(missingPrincipal.statusCode).toBe(401);
  });

  it("exposes all five ownership-scoped routes", async () => {
    const implementation = service();
    const server = createServer(implementation);
    const get = await server.inject({
      method: "GET",
      url: "/api/v1/analyses/analysis-1",
      headers,
    });
    const snapshot = await server.inject({
      method: "GET",
      url: "/api/v1/analyses/analysis-1/snapshot",
      headers,
    });
    const proposal = await server.inject({
      method: "POST",
      url: "/api/v1/analyses/analysis-1/proposals",
      headers,
      payload: proposalCommand(),
    });
    const cancel = await server.inject({
      method: "POST",
      url: "/api/v1/analyses/analysis-1/cancel",
      headers,
      payload: {
        commandId: "command-cancel",
        expectedRevisionId: "revision-1",
        expectedRevisionNumber: 1,
        idempotencyKey: "cancel-key",
        reason: "USER_REQUESTED",
      },
    });
    const resolve = await server.inject({
      method: "POST",
      url: "/api/v1/analyses/analysis-1/interventions/intervention-1:resolve",
      headers,
      payload: {
        commandId: "command-resolve",
        idempotencyKey: "resolve-key",
        response: { candidateId: "candidate-1" },
      },
    });
    expect([
      get.statusCode,
      snapshot.statusCode,
      proposal.statusCode,
      cancel.statusCode,
      resolve.statusCode,
    ]).toEqual([200, 200, 202, 202, 200]);
    expect(implementation.getAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: "analysis-1",
        userId: "principal-1",
      }),
    );
    expect(implementation.resolveIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ interventionId: "intervention-1" }),
      expect.objectContaining({ idempotencyKey: "resolve-key" }),
    );
  });

  it("preserves exact conflict and validation status codes", async () => {
    const conflict = service({
      submitProposal: async () => {
        throw new AnalysisServiceError(
          409,
          "ANALYSIS_REVISION_CONFLICT",
          "Revision changed.",
        );
      },
    });
    const server = createServer(conflict);
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/analyses/analysis-1/proposals",
      headers,
      payload: proposalCommand(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ANALYSIS_REVISION_CONFLICT");

    const invalid = await server.inject({
      method: "POST",
      url: "/api/v1/analyses/analysis-1/proposals",
      headers,
      payload: { ...proposalCommand(), mode: "APPLY_AFTER_CURRENT_NODE" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("INVALID_ANALYSIS_COMMAND");
  });

  it("returns non-disclosing 404 and fail-closed 503", async () => {
    const missing = createServer(
      service({ getAnalysis: async () => undefined }),
    );
    const notFound = await missing.inject({
      method: "GET",
      url: "/api/v1/analyses/analysis-foreign",
      headers,
    });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json().error.code).toBe("ANALYSIS_NOT_FOUND");

    const unavailable = createServer();
    const blocked = await unavailable.inject({
      method: "GET",
      url: "/api/v1/analyses/analysis-1",
      headers,
    });
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json().error.code).toBe(
      "SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY",
    );
  });
});

function createServer(
  analysisControl?: AnalysisControlService,
): FastifyInstance {
  const server = buildServer({
    config,
    now: () => nowMilliseconds,
    resolveChatThread: async (input) => ({
      threadId: `${input.userId}:${input.openWebUiChatId}`,
      openWebUiChatId: input.openWebUiChatId,
      userId: input.userId,
      userRole: input.userRole,
    }),
    runChat: async () => "isolated",
    ...(analysisControl === undefined ? {} : { analysisControl }),
  });
  servers.push(server);
  return server;
}

function service(
  override: Partial<AnalysisControlService> = {},
): AnalysisControlService & Record<string, jest.Mock> {
  return {
    getAnalysis: jest.fn(async () => ({ analysisId: "analysis-1" })),
    getSnapshot: jest.fn(async () => ({ stateRevision: 1 })),
    submitProposal: jest.fn(async () => ({ status: "SUBMITTED" })),
    requestCancel: jest.fn(async () => ({ status: "CANCEL_REQUESTED" })),
    resolveIntervention: jest.fn(async () => ({ status: "RESOLVED" })),
    ...override,
  } as AnalysisControlService & Record<string, jest.Mock>;
}

function proposalCommand() {
  return {
    commandId: "command-proposal",
    proposalId: "proposal-1",
    expectedRevisionId: "revision-1",
    expectedRevisionNumber: 1,
    targetNodeId: "node-1",
    publicArgsHash: hash,
    editSchemaHash: hash,
    patch: [{ op: "replace", path: "/radiusMeters", value: 600 }],
    mode: "SUGGEST_NEXT_REVISION",
    idempotencyKey: "proposal-key",
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
