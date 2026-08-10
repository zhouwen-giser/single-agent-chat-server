import { createHmac } from "node:crypto";

import { buildServer } from "../dist/apps/server/src/bootstrap.js";

const nowMilliseconds = 1_700_000_000_000;
const nowSeconds = Math.floor(nowMilliseconds / 1_000);
const serviceKey = "phase-13-smoke-service-key-32-bytes";
const jwtSecret = "phase-13-smoke-jwt-secret-32-bytes";
const config = {
  serviceKey,
  agUiServiceKey: "phase-5-ag-ui-smoke-service-key-32-bytes",
  openWebUiUserJwtSecret: jwtSecret,
  host: "127.0.0.1",
  port: 3000,
  bodyLimitBytes: 16_384,
  requestTimeoutMs: 5_000,
  modelId: "sdar-single-agent",
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
const server = buildServer({
  config,
  now: () => nowMilliseconds,
  nextId: () => "smoke-id",
  resolveChatThread: async (input) => ({
    threadId: input.userId + ":" + input.openWebUiChatId,
    openWebUiChatId: input.openWebUiChatId,
    userId: input.userId,
    userRole: input.userRole,
  }),
  runChat: async () => "built server smoke response",
});

try {
  const health = await server.inject({ method: "GET", url: "/health" });
  assert(health.statusCode === 200, "built server liveness failed");

  const identity = signedIdentity("smoke-user");
  const models = await server.inject({
    method: "GET",
    url: "/v1/models",
    headers: identity,
  });
  assert(models.statusCode === 200, "built server model discovery failed");
  assert(
    models.json().data[0]?.id === "sdar-single-agent",
    "built server returned the wrong model",
  );

  const completion = await server.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...identity,
      "x-openwebui-chat-id": "smoke-chat",
      "x-openwebui-message-id": "smoke-assistant",
      "x-openwebui-user-message-id": "smoke-user-message",
    },
    payload: {
      model: "sdar-single-agent",
      messages: [{ role: "user", content: "smoke" }],
    },
  });
  assert(completion.statusCode === 200, "built server completion failed");
  assert(
    completion.json().choices[0]?.message?.content ===
      "built server smoke response",
    "built server returned the wrong completion",
  );
  process.stdout.write(
    "Built-server smoke passed: health, model discovery, and completion.\n",
  );
} finally {
  await server.close();
}

function signedIdentity(userId) {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "open-webui",
    sub: userId,
    role: "user",
    iat: nowSeconds - 1,
    exp: nowSeconds + 299,
  });
  const signature = createHmac("sha256", jwtSecret)
    .update(header + "." + payload, "ascii")
    .digest("base64url");
  return {
    authorization: "Bearer " + serviceKey,
    "x-openwebui-user-jwt": header + "." + payload + "." + signature,
  };
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
