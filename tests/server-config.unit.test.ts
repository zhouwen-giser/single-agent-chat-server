import { describe, expect, it } from "@jest/globals";

import { parseServerConfig } from "../apps/server/src/config.js";

const validKey = "phase-1-test-service-key-32-bytes-minimum";
const validJwtSecret = "phase-5-openwebui-jwt-secret-32-bytes-minimum";
const validAgUiKey = "phase-5-ag-ui-service-key-32-bytes-minimum";
const validEnvironment = {
  CHAT_SERVER_SERVICE_KEY: validKey,
  AG_UI_SERVICE_KEY: validAgUiKey,
  OPENWEBUI_USER_JWT_SECRET: validJwtSecret,
};

describe("server configuration", () => {
  it("applies safe loopback and resource defaults", () => {
    expect(parseServerConfig(validEnvironment)).toEqual({
      serviceKey: validKey,
      agUiServiceKey: validAgUiKey,
      openWebUiUserJwtSecret: validJwtSecret,
      host: "127.0.0.1",
      port: 3000,
      bodyLimitBytes: 1_048_576,
      requestTimeoutMs: 30_000,
      modelId: "sdar-single-agent",
      rateLimitMax: 60,
      rateLimitWindowMs: 60_000,
      maxMessages: 64,
      maxMessageChars: 32_768,
      maxResponseChars: 65_536,
      logLevel: "info",
      streamBudgetMs: 30_000,
      pollingBudgetMs: 5_000,
      pollingIntervalMs: 1_000,
    });
  });

  it("rejects a short or missing authentication secret", () => {
    expect(() =>
      parseServerConfig({
        ...validEnvironment,
        CHAT_SERVER_SERVICE_KEY: "too-short",
      }),
    ).toThrow();
    expect(() =>
      parseServerConfig({ CHAT_SERVER_SERVICE_KEY: validKey }),
    ).toThrow();
  });

  it("requires an independent AG-UI service key", () => {
    expect(() =>
      parseServerConfig({
        ...validEnvironment,
        AG_UI_SERVICE_KEY: validKey,
      }),
    ).toThrow("must differ");
  });
  it("rejects resource limits outside the bounded range", () => {
    expect(() =>
      parseServerConfig({
        ...validEnvironment,
        CHAT_SERVER_BODY_LIMIT_BYTES: "100",
      }),
    ).toThrow();
    expect(() =>
      parseServerConfig({
        ...validEnvironment,
        CHAT_SERVER_REQUEST_TIMEOUT_MS: "999999",
      }),
    ).toThrow();
  });
});
