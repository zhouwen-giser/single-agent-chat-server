import { describe, expect, it } from "@jest/globals";

import {
  parseAnalysisAdapterEnvironment,
  parseServerConfig,
} from "../apps/server/src/config.js";

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
      corsAllowedOrigins: [],
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
  it("parses only exact HTTP(S) CORS origins", () => {
    expect(
      parseServerConfig({
        ...validEnvironment,
        CHAT_CORS_ALLOW_ORIGINS:
          "https://openwebui.example,http://127.0.0.1:8080",
      }).corsAllowedOrigins,
    ).toEqual(["https://openwebui.example", "http://127.0.0.1:8080"]);
    for (const value of [
      "https://openwebui.example/path",
      "https://user@openwebui.example",
      "file:///tmp/ui",
      "https://openwebui.example,https://openwebui.example",
      "null",
    ]) {
      expect(() =>
        parseServerConfig({
          ...validEnvironment,
          CHAT_CORS_ALLOW_ORIGINS: value,
        }),
      ).toThrow();
    }
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

  it("keeps analysis disabled by default and gates fixture mode to local environments", () => {
    expect(parseAnalysisAdapterEnvironment({})).toEqual({
      nodeEnv: "production",
      adapterMode: "disabled",
    });
    expect(
      parseAnalysisAdapterEnvironment({
        NODE_ENV: "development",
        SACS_ANALYSIS_ADAPTER_MODE: "fixture",
      }),
    ).toEqual({ nodeEnv: "development", adapterMode: "fixture" });
    expect(() =>
      parseAnalysisAdapterEnvironment({
        NODE_ENV: "production",
        SACS_ANALYSIS_ADAPTER_MODE: "fixture",
      }),
    ).toThrow("SACS_ANALYSIS_FIXTURE_FORBIDDEN_IN_PRODUCTION");
  });
});
