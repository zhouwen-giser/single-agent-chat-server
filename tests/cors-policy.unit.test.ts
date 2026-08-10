import { afterEach, describe, expect, it } from "@jest/globals";
import type { FastifyInstance } from "fastify";

import { buildServer } from "../apps/server/src/bootstrap.js";
import type { ServerConfig } from "../apps/server/src/config.js";

const allowedOrigin = "https://openwebui.example";
const servers: FastifyInstance[] = [];

describe("deny-by-default CORS policy", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("allows only an exact configured Origin on actual requests", async () => {
    const server = createServer([allowedOrigin]);
    const allowed = await server.inject({
      method: "GET",
      url: "/health",
      headers: { origin: allowedOrigin },
    });
    const denied = await server.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://attacker.example" },
    });
    const nonBrowser = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(allowed.headers.vary).toBe("Origin");
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("cors_origin_denied");
    expect(nonBrowser.statusCode).toBe(200);
    expect(nonBrowser.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("validates preflight method and headers without exposing credentials", async () => {
    const server = createServer([allowedOrigin]);
    const allowed = await server.inject({
      method: "OPTIONS",
      url: "/ag-ui",
      headers: {
        origin: allowedOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "authorization, content-type, x-openwebui-user-jwt",
      },
    });
    const deniedHeader = await server.inject({
      method: "OPTIONS",
      url: "/ag-ui",
      headers: {
        origin: allowedOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, x-attacker-header",
      },
    });
    const deniedMethod = await server.inject({
      method: "OPTIONS",
      url: "/ag-ui",
      headers: {
        origin: allowedOrigin,
        "access-control-request-method": "DELETE",
      },
    });

    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(allowed.headers["access-control-allow-methods"]).toBe("GET, POST");
    expect(allowed.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(deniedHeader.statusCode).toBe(403);
    expect(deniedHeader.json().error.code).toBe("cors_headers_denied");
    expect(deniedMethod.statusCode).toBe(403);
    expect(deniedMethod.json().error.code).toBe("cors_method_denied");
  });

  it("denies every browser Origin when the allowlist is empty", async () => {
    const server = createServer([]);
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "null" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

function createServer(corsAllowedOrigins: readonly string[]): FastifyInstance {
  const config: ServerConfig = {
    serviceKey: "cors-openai-service-key-at-least-32-characters",
    agUiServiceKey: "cors-ag-ui-service-key-at-least-32-characters",
    openWebUiUserJwtSecret: "cors-user-jwt-secret-at-least-32-characters",
    host: "127.0.0.1",
    port: 3000,
    bodyLimitBytes: 8_192,
    requestTimeoutMs: 5_000,
    modelId: "sdar-single-agent",
    corsAllowedOrigins,
    rateLimitMax: 60,
    rateLimitWindowMs: 60_000,
    maxMessages: 64,
    maxMessageChars: 32_768,
    maxResponseChars: 1_024,
    logLevel: "silent",
    streamBudgetMs: 30_000,
    pollingBudgetMs: 5_000,
    pollingIntervalMs: 1_000,
  };
  const server = buildServer({
    config,
    resolveChatThread: async () => {
      throw new Error("not used");
    },
  });
  servers.push(server);
  return server;
}
