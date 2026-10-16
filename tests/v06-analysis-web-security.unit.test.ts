import { createHash as nodeHash } from "node:crypto";
import { describe, it, expect } from "@jest/globals";
import { createHash } from "../apps/analysis-web/src/browser-crypto.js";
import { Buffer as browserBuffer } from "../apps/analysis-web/src/browser-buffer.js";
import { buildServer } from "../apps/server/src/bootstrap.js";
import { frozenNow } from "./helpers/memory-frozen-analysis.js";
import { browserJwt } from "./helpers/browser-analysis.js";
import { parseServerConfig } from "../apps/server/src/config.js";
import { browserSecrets } from "./helpers/browser-analysis.js";
const env = {
  CHAT_SERVER_SERVICE_KEY: browserSecrets.serviceKey,
  AG_UI_SERVICE_KEY: browserSecrets.agUiKey,
  OPENWEBUI_USER_JWT_SECRET: browserSecrets.jwtSecret,
  SACS_ANALYSIS_WEB_ENABLED: "true",
};
describe("browser boundaries", () => {
  it("sets HTTPS cookies Secure and bounds their expiry to the signed identity", async () => {
    const config = parseServerConfig({
      ...env,
      SACS_ANALYSIS_WEB_ORIGIN: "https://world.example",
    });
    const server = buildServer({
      config,
      now: () => frozenNow().getTime(),
      resolveChatThread: async () => {
        throw Error("UNUSED_CHAT");
      },
    });
    try {
      const login = await server.inject({
        method: "POST",
        url: "/analysis/session",
        headers: { origin: "https://world.example" },
        payload: { jwt: browserJwt("browser-user", frozenNow().getTime(), 10) },
      });
      expect(login.statusCode).toBe(200);
      expect(login.headers["set-cookie"]).toContain("Max-Age=10");
      expect(login.headers["set-cookie"]).toContain("; Secure");
      const missing = await server.inject({
        method: "POST",
        url: "/analysis/session",
        payload: { jwt: browserJwt() },
      });
      expect(missing.statusCode).toBe(403);
      const disabled = buildServer({
        config: { ...config, analysisWebEnabled: false },
        resolveChatThread: async () => {
          throw Error("UNUSED_CHAT");
        },
      });
      try {
        expect(
          (await disabled.inject({ method: "GET", url: "/analysis" }))
            .statusCode,
        ).toBe(404);
      } finally {
        await disabled.close();
      }
    } finally {
      await server.close();
    }
  });
  it.each(["", "ordinary", "道路位置 🌏", "e\u0301", "\ud800"])(
    "keeps canonical hash and UTF-8 budget identical: %s",
    (text) => {
      expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(
        nodeHash("sha256").update(text, "utf8").digest("hex"),
      );
      expect(browserBuffer.byteLength(text, "utf8")).toBe(
        Buffer.byteLength(text, "utf8"),
      );
    },
  );
  it("requires a trusted identity mode and exact public origin", () => {
    expect(() =>
      parseServerConfig({
        ...env,
        SACS_ANALYSIS_WEB_ORIGIN: "https://world.example",
        SACS_AUTH_MODE: "development-anonymous",
        SACS_ALLOW_INSECURE_ANONYMOUS: "true",
      }),
    ).toThrow("TRUSTED_IDENTITY_REQUIRED");
    for (const origin of [
      "",
      "null",
      "https://world.example/path",
      "https://user:pass@world.example",
      "https://world.example?url=http://private",
      "file:///tmp/ui",
    ])
      expect(() =>
        parseServerConfig({ ...env, SACS_ANALYSIS_WEB_ORIGIN: origin }),
      ).toThrow();
    expect(
      parseServerConfig({
        ...env,
        SACS_ANALYSIS_WEB_ORIGIN: "https://world.example",
      }).analysisWebOrigin,
    ).toBe("https://world.example");
  });
});
