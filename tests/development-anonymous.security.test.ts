import { afterEach, describe, expect, it } from "@jest/globals";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { buildServer } from "../apps/server/src/bootstrap.js";
import { parseServerConfig } from "../apps/server/src/config.js";
import { createOpenWebUiUserAuthenticator } from "../apps/server/src/auth/openwebui-user.js";

const environment = {
  CHAT_SERVER_SERVICE_KEY: "test-service-key-32-characters-long-enough",
  AG_UI_SERVICE_KEY: "test-ag-ui-key-32-characters-long-enough",
  OPENWEBUI_USER_JWT_SECRET: "test-jwt-key-32-characters-long-enough",
};
const servers: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("explicit shared anonymous development access", () => {
  it("requires two explicit switches and keeps authenticated default", () => {
    expect(parseServerConfig(environment).authMode).toBe("authenticated");
    expect(() =>
      parseServerConfig({
        ...environment,
        SACS_AUTH_MODE: "development-anonymous",
      }),
    ).toThrow("SACS_ALLOW_INSECURE_ANONYMOUS");
    expect(
      parseServerConfig({
        ...environment,
        SACS_ALLOW_INSECURE_ANONYMOUS: "true",
      }).authMode,
    ).toBe("authenticated");
  });
  it("ignores forged identity, JWT and admin role", async () => {
    const server = Fastify();
    servers.push(server);
    server.addHook(
      "preHandler",
      createOpenWebUiUserAuthenticator({
        secret: environment.OPENWEBUI_USER_JWT_SECRET,
        authMode: "development-anonymous",
      }),
    );
    server.get("/", async (request) => request.openWebUiIdentity);
    const response = await server.inject({
      url: "/",
      headers: {
        "x-openwebui-user-jwt": "forged",
        "x-openwebui-user-id": "victim",
        "x-openwebui-user-role": "admin",
        authorization: "Bearer forged",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      userId: "sacs-development-shared",
      role: "user",
    });
  });
  it.each([false, true])(
    "applies the same admission policy to all route groups, anonymous=%s",
    async (anonymous) => {
      const config = parseServerConfig({
        ...environment,
        ...(anonymous
          ? {
              SACS_AUTH_MODE: "development-anonymous",
              SACS_ALLOW_INSECURE_ANONYMOUS: "true",
            }
          : {}),
      });
      const server = buildServer({
        config,
        resolveChatThread: async () => {
          throw Error("Not reached by invalid body");
        },
      });
      servers.push(server);
      for (const [method, url] of [
        ["GET", "/v1/models"],
        ["POST", "/v1/chat/completions"],
        ["POST", "/ag-ui"],
        ["GET", "/api/v1/analysis-capabilities"],
        ["POST", "/v1/world-selections"],
      ] as const) {
        const response = await server.inject({
          method,
          url,
          ...(method === "POST" ? { payload: {} } : {}),
        });
        expect(response.statusCode).not.toBe(404);
        if (anonymous) expect(response.statusCode).not.toBe(401);
        else expect(response.statusCode).toBe(401);
      }
    },
  );
});
