import { describe, expect, it } from "@jest/globals";

import { parseServerConfig } from "../apps/server/src/config.js";

const validKey = "phase-1-test-service-key-32-bytes-minimum";
const validJwtSecret = "phase-5-openwebui-jwt-secret-32-bytes-minimum";
const validEnvironment = {
  CHAT_SERVER_SERVICE_KEY: validKey,
  OPENWEBUI_USER_JWT_SECRET: validJwtSecret,
};

describe("server configuration", () => {
  it("applies safe loopback and resource defaults", () => {
    expect(parseServerConfig(validEnvironment)).toEqual({
      serviceKey: validKey,
      openWebUiUserJwtSecret: validJwtSecret,
      host: "127.0.0.1",
      port: 3000,
      bodyLimitBytes: 1_048_576,
      requestTimeoutMs: 30_000,
      modelId: "sdar-single-agent",
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
