import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { FastifyInstance } from "fastify";

import { buildServer } from "../apps/server/src/bootstrap.js";
import type { ChatRunnerContext } from "../apps/server/src/api/openai-routes.js";
import type { ServerConfig } from "../apps/server/src/config.js";
import type { StructuredWorldSelection } from "../packages/world-explanation-contract/src/index.js";

const serviceKey = "closure-selection-service-key-32-bytes-minimum";
const jwtSecret = "closure-selection-jwt-secret-32-bytes-minimum";
const nowMilliseconds = 1_700_000_000_000;
const nowSeconds = Math.floor(nowMilliseconds / 1000);
const signedIdentity = signIdentity("user-a");
const identityHeaders = {
  authorization: "Bearer " + serviceKey,
  "x-openwebui-user-jwt": signedIdentity,
  "x-openwebui-chat-id": "chat-a",
};
const chatHeaders = {
  ...identityHeaders,
  "x-openwebui-message-id": "assistant-message-a",
  "x-openwebui-user-message-id": "user-message-a",
};
const config: ServerConfig = {
  serviceKey,
  agUiServiceKey: "closure-selection-agui-key-32-bytes-minimum",
  openWebUiUserJwtSecret: jwtSecret,
  host: "127.0.0.1",
  port: 3000,
  bodyLimitBytes: 16_384,
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
const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("C03 authenticated structured-selection ingress", () => {
  it("derives principal/thread scope and returns a token-free receipt", async () => {
    const saveSelection = jest.fn(
      async (selection: StructuredWorldSelection) => ({
        created: true,
        selection,
      }),
    );
    const server = createServer({ saveSelection });
    const selection = referenceSelection();
    const response = await server.inject({
      method: "POST",
      url: "/v1/world-selections",
      headers: identityHeaders,
      payload: selection,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      schemaVersion: "sacs-structured-world-selection-receipt/1.0",
      selectionId: selection.selectionId,
      selectionRevision: 1,
      sourceHash: selection.sourceHash,
      expiresAt: selection.expiresAt,
      created: true,
    });
    expect(JSON.stringify(response.json())).not.toContain(
      "upstreamSelectionToken",
    );
    expect(saveSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: "user-a",
        threadId: "user-a:chat-a",
      }),
      new Date(nowMilliseconds).toISOString(),
    );
  });

  it("does not disclose cross-principal or cross-thread selections", async () => {
    const saveSelection = jest.fn(
      async (selection: StructuredWorldSelection) => ({
        created: true,
        selection,
      }),
    );
    const server = createServer({ saveSelection });
    for (const selection of [
      { ...referenceSelection(), principalId: "user-b" },
      { ...referenceSelection(), threadId: "user-a:chat-b" },
    ]) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/world-selections",
        headers: identityHeaders,
        payload: selection,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: { code: "world_selection_not_found" },
      });
    }
    expect(saveSelection).not.toHaveBeenCalled();
  });

  it("rejects bare ordinals and dual stable identities before persistence", async () => {
    const saveSelection = jest.fn(
      async (selection: StructuredWorldSelection) => ({
        created: true,
        selection,
      }),
    );
    const server = createServer({ saveSelection });
    for (const selection of [
      {
        ...referenceSelection(),
        referenceKey: undefined,
        findingOrdinal: 1,
      },
      {
        ...referenceSelection(),
        upstreamSelectionToken: "must-not-coexist",
      },
    ]) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/world-selections",
        headers: identityHeaders,
        payload: selection,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "invalid_world_selection" },
      });
    }
    expect(saveSelection).not.toHaveBeenCalled();
  });

  it("passes only unique selection IDs into the chat runner", async () => {
    const contexts: ChatRunnerContext[] = [];
    const server = createServer({
      runChat: async (context) => {
        contexts.push(context);
        return "ok";
      },
    });
    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: chatHeaders,
      payload: {
        model: config.modelId,
        messages: [{ role: "user", content: "那里呢？" }],
        sacs_world_selection_ids: ["selection-a", "selection-b"],
      },
    });
    const duplicate = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...chatHeaders,
        "x-openwebui-message-id": "assistant-message-b",
        "x-openwebui-user-message-id": "user-message-b",
      },
      payload: {
        model: config.modelId,
        messages: [{ role: "user", content: "那里呢？" }],
        sacs_world_selection_ids: ["selection-a", "selection-a"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(contexts[0]?.worldSelectionIds).toEqual([
      "selection-a",
      "selection-b",
    ]);
    expect(duplicate.statusCode).toBe(400);
    expect(contexts).toHaveLength(1);
  });
});

function createServer(overrides: {
  readonly saveSelection?: (
    selection: StructuredWorldSelection,
    now: string,
  ) => Promise<{ created: boolean; selection: StructuredWorldSelection }>;
  readonly runChat?: (context: ChatRunnerContext) => Promise<string> | string;
}): FastifyInstance {
  const server = buildServer({
    config,
    now: () => nowMilliseconds,
    nextId: () => "fixed-id",
    resolveChatThread: async (input) => ({
      threadId: input.userId + ":" + input.openWebUiChatId,
      openWebUiChatId: input.openWebUiChatId,
      userId: input.userId,
      userRole: input.userRole,
    }),
    runChat: overrides.runChat ?? (async () => "ok"),
    ...(overrides.saveSelection === undefined
      ? {}
      : { saveSelection: overrides.saveSelection }),
  });
  servers.push(server);
  return server;
}

function referenceSelection(): StructuredWorldSelection {
  return {
    schemaVersion: "sacs-structured-world-selection/1.0",
    selectionId: "selection-reference-1",
    principalId: "user-a",
    threadId: "user-a:chat-a",
    groundingId: "grounding-1",
    explanationId: "explanation-1",
    selectionKind: "REFERENCE_SET_MEMBER",
    referenceKey: {
      namespace: "gowm",
      kind: "DEVICE",
      id: "wrf_" + "a".repeat(32),
      version: "7",
    },
    selectionRevision: 1,
    sourceHash: "sha256:" + "b".repeat(64),
    selectedAt: "2023-11-14T22:13:20.000Z",
    expiresAt: "2023-11-14T22:14:20.000Z",
  };
}

function signIdentity(subject: string): string {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "open-webui",
    sub: subject,
    role: "user",
    iat: nowSeconds - 1,
    exp: nowSeconds + 299,
    email: subject + "@example.test",
    name: subject,
  });
  const signature = createHmac("sha256", jwtSecret)
    .update(header + "." + payload, "ascii")
    .digest("base64url");
  return header + "." + payload + "." + signature;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
