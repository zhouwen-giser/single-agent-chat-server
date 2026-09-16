// Runs inside the candidate server image with its private environment loaded.
// No business POST, model generation or SDAR task is performed.
import { parseServerConfig } from "/app/dist/apps/server/src/config.js";
import { parseConversationModelConfig } from "/app/dist/packages/conversation-model/src/config.js";
import { parseGroundingAnalysisConfig } from "/app/dist/packages/wsgs-analysis-adapter/src/config.js";
import { parseWsgsHttpConfig } from "/app/dist/packages/wsgs-http-adapter/src/index.js";
import {
  FrozenWorldAnalysisContract,
  verifyFrozenWorldAnalysis,
} from "/app/dist/packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import {
  createSdarA2aClient,
  parseSdarA2aConfig,
} from "/app/dist/packages/sdar-a2a-adapter/src/index.js";
let stage = "configuration";
try {
  parseServerConfig(process.env);
  if (!parseConversationModelConfig(process.env))
    throw Error("MODEL_CONFIG_MISSING");
  parseGroundingAnalysisConfig(process.env);
  parseWsgsHttpConfig(process.env);
  stage = "frozen-contract";
  verifyFrozenWorldAnalysis();
  stage = "wsgs-capabilities";
  const response = await fetch(
    new URL("/v1/capabilities", process.env.WSGS_BASE_URL),
    {
      headers: {
        "wsgs-contract-version": "sacs-wsgs-grounding/1.2",
        "wsgs-result-profile": "wsgs-world-analysis-findings/1.0",
      },
      signal: AbortSignal.timeout(120000),
      redirect: "error",
    },
  );
  if (
    !response.ok ||
    response.headers.get("wsgs-contract-version") !==
      "sacs-wsgs-grounding/1.2" ||
    response.headers.get("wsgs-result-profile") !==
      "wsgs-world-analysis-findings/1.0"
  )
    throw Error("WSGS_NEGOTIATION_FAILED");
  const caps = new FrozenWorldAnalysisContract().parse(
    "capabilities",
    await response.json(),
  );
  if (!caps.requiredCapabilitiesReady) throw Error("WSGS_NOT_READY");
  stage = "sdar-agent-card";
  await createSdarA2aClient(parseSdarA2aConfig(process.env));
  console.log(
    JSON.stringify({
      configuration: "PASS",
      frozenContract: "PASS",
      wsgs12: "PASS",
      sdarDiscovery: "PASS",
    }),
  );
} catch {
  // Configuration/transport exceptions can embed URLs or secret values.
  console.error(JSON.stringify({ status: "FAIL", stage }));
  process.exitCode = 1;
}
