import { readFileSync } from "node:fs";
import { describe, expect, it, jest } from "@jest/globals";
import { createV06GroundingAnalysis } from "../apps/server/src/v06-grounding-analysis.js";
import { buildServer } from "../apps/server/src/bootstrap.js";
import { parseServerConfig } from "../apps/server/src/config.js";
import { parseGroundingAnalysisConfig } from "../packages/wsgs-analysis-adapter/src/config.js";
import { parseWsgsHttpConfig } from "../packages/wsgs-http-adapter/src/index.js";
import { WSGS_V12_HEADERS } from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import {
  MemoryFrozenAnalysis,
  MemoryFrozenControl,
  MemoryFrozenInteraction,
  frozenNow,
} from "./helpers/memory-frozen-analysis.js";
import { MemoryGrounding } from "./helpers/memory-grounding.js";
import {
  publicExample,
  startFrozenWsgsPeer,
} from "./helpers/frozen-wsgs-http.js";

const serverConfig = parseServerConfig({
  CHAT_SERVER_SERVICE_KEY: "readiness-test-service-key-at-least-32",
  AG_UI_SERVICE_KEY: "readiness-test-agui-key-at-least-32",
  OPENWEBUI_USER_JWT_SECRET: "readiness-test-jwt-key-at-least-32",
});
function composition(options: {
  enabled?: boolean;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}) {
  const grounding = new MemoryGrounding();
  const analysis = new MemoryFrozenAnalysis(grounding);
  const controls = new MemoryFrozenControl(analysis);
  const interactions = new MemoryFrozenInteraction();
  return createV06GroundingAnalysis({
    persistence: {
      groundingRepository: grounding,
      analysisRepository: analysis,
      analysisDevelopmentRepository: controls,
      interactionRepository: interactions,
    },
    config: parseGroundingAnalysisConfig({
      SACS_WSGS_ANALYSIS_ENABLED: options.enabled === false ? "false" : "true",
      SACS_WSGS_ANALYSIS_READINESS_TIMEOUT_MS: "100",
      SACS_WSGS_ANALYSIS_READINESS_CACHE_MS: "100",
    }),
    wsgsConfig: {
      baseUrl: options.baseUrl ?? "http://readiness.invalid",
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    },
    sdarCompatibilityLock: JSON.parse(
      readFileSync(
        "dependencies/sdar-grounding-extension-compatibility-lock.json",
        "utf8",
      ),
    ),
    now: options.now ?? frozenNow,
  });
}
describe("R02 bounded public-capabilities readiness", () => {
  it("allows the disabled .env template without contacting WSGS", async () => {
    expect(parseWsgsHttpConfig({ WSGS_BASE_URL: "" }).baseUrl).toBe(
      "http://127.0.0.1:8080",
    );
    const fetchImpl = jest.fn<typeof fetch>();
    const c = composition({ enabled: false, fetchImpl });
    expect(await c.readiness()).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("deduplicates concurrent probes, caches then retries, without business submissions", async () => {
    let timestamp = frozenNow().getTime();
    let ready = true;
    const peer = await startFrozenWsgsPeer(() => ({
      value: {
        ...publicExample<object>("capabilities"),
        requiredCapabilitiesReady: ready,
      },
    }));
    const c = composition({
      baseUrl: peer.baseUrl,
      now: () => new Date(timestamp),
    });
    try {
      expect(
        await Promise.all([c.readiness(), c.readiness(), c.readiness()]),
      ).toEqual(["ready", "ready", "ready"]);
      expect(peer.captured).toHaveLength(1);
      expect(await c.readiness()).toBe("ready");
      ready = false;
      timestamp += 101;
      expect(await c.readiness()).toBe("unavailable");
      expect(peer.captured).toHaveLength(2);
      ready = true;
      timestamp += 101;
      expect(await c.readiness()).toBe("ready");
      expect(
        peer.captured.every(
          (call) => call.method === "GET" && call.path === "/v1/capabilities",
        ),
      ).toBe(true);
      expect(await c.capabilities()).toMatchObject({
        nativeReady: false,
        optionalAvailable: [],
      });
    } finally {
      await c.source?.close();
      await peer.close();
    }
  });
  it("rejects negotiation drift without treating an HTTP success as ready", async () => {
    const peer = await startFrozenWsgsPeer(() => ({
      value: publicExample("capabilities"),
      headers: {
        ...WSGS_V12_HEADERS,
        "wsgs-result-profile": "incorrect-profile",
      },
    }));
    const c = composition({ baseUrl: peer.baseUrl });
    try {
      expect(await c.readiness()).toBe("unavailable");
    } finally {
      await c.source?.close();
      await peer.close();
    }
  });
  it("uses the short readiness signal rather than the long operation timeout", async () => {
    let aborted = false;
    const fetchImpl: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(init.signal?.reason);
          },
          { once: true },
        );
      });
    const c = composition({ fetchImpl });
    try {
      expect(await c.readiness()).toBe("unavailable");
      expect(aborted).toBe(true);
    } finally {
      await c.source?.close();
    }
  });
  it.each(["disabled", "ready", "unavailable"] as const)(
    "reports %s separately from liveness",
    async (status) => {
      const server = buildServer({
        config: serverConfig,
        resolveChatThread: async (input) => ({
          ...input,
          threadId: "readiness-thread",
          principalId: "readiness-principal",
        }),
        readinessCheck: async () => true,
        conversationModelReadinessCheck: async () => true,
        analysisReadinessCheck: async () => status,
      });
      try {
        expect(
          (await server.inject({ method: "GET", url: "/health" })).statusCode,
        ).toBe(200);
        const response = await server.inject({ method: "GET", url: "/ready" });
        expect(response.statusCode).toBe(status === "unavailable" ? 503 : 200);
        expect(response.json()).toMatchObject({
          checks: {
            wsgsGrounding: status,
            postgres: "ok",
            conversationModel: "ok",
          },
        });
      } finally {
        await server.close();
      }
    },
  );
});
