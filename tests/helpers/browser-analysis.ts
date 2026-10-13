import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { buildServer } from "../../apps/server/src/bootstrap.js";
import { createV06GroundingAnalysis } from "../../apps/server/src/v06-grounding-analysis.js";
import { parseServerConfig } from "../../apps/server/src/config.js";
import { parseGroundingAnalysisConfig } from "../../packages/wsgs-analysis-adapter/src/config.js";
import { MemoryGrounding } from "./memory-grounding.js";
import {
  MemoryFrozenAnalysis,
  MemoryFrozenControl,
  MemoryFrozenInteraction,
  startFrozenScenarioPeer,
  frozenNow,
} from "./memory-frozen-analysis.js";
export const browserSecrets = {
  serviceKey: "synthetic-chat-service-secret-at-least-32",
  agUiKey: "synthetic-agui-service-secret-at-least-32",
  jwtSecret: "synthetic-signed-user-secret-at-least-32",
};
export function browserJwt(
  user = "browser-user",
  at = frozenNow().getTime(),
  lifetime = 299,
) {
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const h = encode({ alg: "HS256", typ: "JWT" }),
    p = encode({
      iss: "open-webui",
      sub: user,
      role: "user",
      iat: Math.floor(at / 1000) - 1,
      exp: Math.floor(at / 1000) + lifetime,
    });
  return (
    h +
    "." +
    p +
    "." +
    createHmac("sha256", browserSecrets.jwtSecret)
      .update(h + "." + p)
      .digest("base64url")
  );
}
async function availablePort(): Promise<number> {
  const peer = createServer();
  await new Promise<void>((resolve) => peer.listen(0, "127.0.0.1", resolve));
  const address = peer.address();
  if (!address || typeof address === "string")
    throw Error("TEST_PORT_UNAVAILABLE");
  await new Promise<void>((resolve, reject) =>
    peer.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
export async function createBrowserAnalysisFixture(
  options: Parameters<typeof startFrozenScenarioPeer>[0] = {},
  beforeListen?: (server: ReturnType<typeof buildServer>) => Promise<void>,
) {
  let clock = frozenNow().getTime();
  const now = () => new Date(clock);
  const peer = await startFrozenScenarioPeer(options);
  const grounding = new MemoryGrounding(now),
    analysis = new MemoryFrozenAnalysis(grounding, now);
  const control = new MemoryFrozenControl(analysis, now),
    interaction = new MemoryFrozenInteraction(now);
  const composition = createV06GroundingAnalysis({
    persistence: {
      interactionRepository: interaction,
      groundingRepository: grounding,
      analysisRepository: analysis,
      analysisDevelopmentRepository: control,
    },
    config: parseGroundingAnalysisConfig({
      SACS_WSGS_ANALYSIS_ENABLED: "true",
      SACS_WSGS_ANALYSIS_POLL_INTERVAL_MS: "10",
      SACS_WSGS_ANALYSIS_MAX_WAIT_MS: "2000",
    }),
    wsgsConfig: { baseUrl: peer.baseUrl },
    sdarCompatibilityLock: JSON.parse(
      readFileSync(
        "dependencies/sdar-grounding-extension-compatibility-lock.json",
        "utf8",
      ),
    ),
    now,
  });
  const port = await availablePort(),
    baseUrl = "http://127.0.0.1:" + port;
  const config = parseServerConfig({
    CHAT_SERVER_SERVICE_KEY: browserSecrets.serviceKey,
    AG_UI_SERVICE_KEY: browserSecrets.agUiKey,
    OPENWEBUI_USER_JWT_SECRET: browserSecrets.jwtSecret,
    SACS_ANALYSIS_WEB_ENABLED: "true",
    SACS_ANALYSIS_WEB_ORIGIN: baseUrl,
    CHAT_RATE_LIMIT_MAX: "1000",
  });
  const threads = new Map<string, { userId: string; external: string }>();
  const server = buildServer({
    config,
    now: () => clock,
    resolveChatThread: async () => {
      throw Error("UNUSED_CHAT");
    },
    resolveAgUiThread: async (input) => {
      const internal =
        "internal-" + input.userId + "-" + input.externalThreadId;
      threads.set(internal, {
        userId: input.userId,
        external: input.externalThreadId,
      });
      return {
        bindingId: "binding-" + internal,
        clientType: "ag_ui",
        externalThreadId: input.externalThreadId,
        principalId: input.userId,
        threadId: internal,
      };
    },
    runAgUiV03: composition.runAgUiV03,
    analysisControl: composition.analysisControl,
    analysisCapabilities: composition.capabilities,
    listBrowserAnalyses: async (identity) =>
      [...analysis.bindings.values()]
        .filter((b) => b.session.principalId === identity.userId)
        .map((b) => ({
          analysisId: b.session.analysisId,
          title: b.session.title,
          status: b.session.status,
          revisionId: b.session.activeRevisionId,
          revisionNumber: b.session.latestRevisionNumber,
          threadId: threads.get(b.session.threadId)!.external,
        })),
  });
  await beforeListen?.(server);
  await server.listen({ host: "127.0.0.1", port });
  return {
    baseUrl,
    server,
    peer,
    composition,
    analysis,
    grounding,
    setClock: (value: number) => {
      clock = value;
    },
    close: async () => {
      await server.close();
      await composition.source?.close();
      await peer.close();
    },
  };
}
