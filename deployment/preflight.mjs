// Runs inside the candidate server image with its private environment loaded.
// No business POST, model generation or SDAR task is performed.
import { parseServerConfig } from "/app/dist/apps/server/src/config.js";
import { parseConversationModelConfig } from "/app/dist/packages/conversation-model/src/config.js";
import { parseGroundingAnalysisConfig } from "/app/dist/packages/wsgs-analysis-adapter/src/config.js";
import {
  createWsgsHttpClient,
  parseWsgsHttpConfig,
} from "/app/dist/packages/wsgs-http-adapter/src/index.js";
import { verifyFrozenWorldAnalysis } from "/app/dist/packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import {
  createSdarA2aClient,
  parseSdarA2aConfig,
} from "/app/dist/packages/sdar-a2a-adapter/src/index.js";
let stage = "configuration";
try {
  parseServerConfig(process.env);
  if (!parseConversationModelConfig(process.env))
    throw Error("MODEL_CONFIG_MISSING");
  const analysis = parseGroundingAnalysisConfig(process.env);
  const wsgs = parseWsgsHttpConfig(process.env);
  stage = "frozen-contract";
  verifyFrozenWorldAnalysis();
  stage = "wsgs-capabilities";
  if (analysis.enabled) {
    const caps = await createWsgsHttpClient({
      ...wsgs,
      contractVersion: analysis.contractVersion,
    }).capabilities(AbortSignal.timeout(analysis.readinessTimeoutMs));
    if (!caps.requiredCapabilitiesReady) throw Error("WSGS_NOT_READY");
  }
  stage = "sdar-agent-card";
  await createSdarA2aClient(parseSdarA2aConfig(process.env));
  console.log(
    JSON.stringify({
      configuration: "PASS",
      frozenContract: "PASS",
      wsgs12:
        analysis.enabled &&
        analysis.contractVersion === "sacs-wsgs-grounding/1.2"
          ? "PASS"
          : "NOT_SELECTED",
      wsgsGrounding: analysis.enabled ? "PASS" : "DISABLED",
      sdarDiscovery: "PASS",
    }),
  );
} catch {
  // Configuration/transport exceptions can embed URLs or secret values.
  console.error(JSON.stringify({ status: "FAIL", stage }));
  process.exitCode = 1;
}
