import { describe, expect, it } from "@jest/globals";

import { parseServerConfig } from "../apps/server/src/config.js";

const validKey = "phase-1-test-service-key-32-bytes-minimum";

describe("server configuration", () => {
  it("applies safe loopback and resource defaults", () => {
    expect(parseServerConfig({ CHAT_SERVER_SERVICE_KEY: validKey })).toEqual({
      serviceKey: validKey,
      host: "127.0.0.1",
      port: 3000,
      bodyLimitBytes: 1_048_576,
      requestTimeoutMs: 30_000,
      modelId: "sdar-single-agent",
    });
  });

  it("rejects a short service key", () => {
    expect(() =>
      parseServerConfig({ CHAT_SERVER_SERVICE_KEY: "too-short" }),
    ).toThrow();
  });

  it("rejects resource limits outside the bounded range", () => {
    expect(() =>
      parseServerConfig({
        CHAT_SERVER_SERVICE_KEY: validKey,
        CHAT_SERVER_BODY_LIMIT_BYTES: "100",
      }),
    ).toThrow();
    expect(() =>
      parseServerConfig({
        CHAT_SERVER_SERVICE_KEY: validKey,
        CHAT_SERVER_REQUEST_TIMEOUT_MS: "999999",
      }),
    ).toThrow();
  });
});
