import { describe, expect, it } from "@jest/globals";
import {
  createAcceptanceServerConfig,
  createAcceptanceHeaders,
} from "../scripts/lib/agui-grounding-observation.js";
import { parseServerConfig } from "../apps/server/src/config.js";
import { buildServer } from "../apps/server/src/bootstrap.js";

describe("live acceptance harness configuration", () => {
  const secret = "private-test-only-agui-service-key-32-characters";
  it("uses independent Chat/AG-UI keys and supported 120-second budgets", () => {
    const config = createAcceptanceServerConfig(secret);
    expect(config.serviceKey).not.toBe(secret);
    expect(config.agUiServiceKey).toBe(secret);
    expect(config.serviceKey).not.toBe(
      createAcceptanceServerConfig(secret).serviceKey,
    );
    expect(config).toMatchObject({
      authMode: "authenticated",
      requestTimeoutMs: 120000,
      streamBudgetMs: 120000,
      logLevel: "silent",
      corsAllowedOrigins: [],
    });
  });
  it("does not relax production secret validation for the runner", () => {
    expect(() => createAcceptanceServerConfig("short")).toThrow();
    expect(() =>
      parseServerConfig({
        CHAT_SERVER_SERVICE_KEY: secret,
        AG_UI_SERVICE_KEY: secret,
        OPENWEBUI_USER_JWT_SECRET: secret,
      }),
    ).toThrow("AG_UI_SERVICE_KEY must differ from CHAT_SERVER_SERVICE_KEY");
  });
  it("authenticates through the actual AG-UI route and retains expiry checks", async () => {
    const server = buildServer({
      config: createAcceptanceServerConfig(secret),
      resolveChatThread: async () => {
        throw Error("BUSINESS_REQUEST_FORBIDDEN");
      },
    });
    try {
      const response = await server.inject({
        method: "GET",
        url: "/ag-ui/capabilities",
        headers: createAcceptanceHeaders(secret),
      });
      expect(response.statusCode).toBe(200);
      const expired = await server.inject({
        method: "GET",
        url: "/ag-ui/capabilities",
        headers: createAcceptanceHeaders(secret, Date.now() - 600000),
      });
      expect(expired.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
