import process from "node:process";

import type { FastifyInstance } from "fastify";

import {
  parsePersistenceConfig,
  setupPersistence,
  type PersistenceRuntime,
} from "../../../packages/persistence/src/index.js";
import { loadServerConfig, parseAnalysisAdapterEnvironment } from "./config.js";
import { createSecureLoggerOptions } from "./observability/logging.js";
import { installGracefulShutdown } from "./shutdown.js";
import { createV05AnalysisDevelopmentServer } from "./v05-analysis-development.js";

let persistence: PersistenceRuntime | undefined;
let server: FastifyInstance | undefined;

try {
  const config = loadServerConfig();
  const parsedEnvironment = parseAnalysisAdapterEnvironment(process.env);
  if (
    !["test", "development"].includes(parsedEnvironment.nodeEnv) ||
    parsedEnvironment.adapterMode !== "fixture"
  ) {
    throw new Error("SACS_ANALYSIS_DEVELOPMENT_COMPOSITION_FORBIDDEN");
  }
  const environment = {
    nodeEnv: parsedEnvironment.nodeEnv as "test" | "development",
    adapterMode: parsedEnvironment.adapterMode,
  } as const;
  persistence = await setupPersistence(parsePersistenceConfig(process.env));
  const composition = createV05AnalysisDevelopmentServer({
    config,
    persistence,
    environment,
    logger: createSecureLoggerOptions(config.logLevel),
  });
  server = composition.server;
  installGracefulShutdown(server);
  await server.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  if (server !== undefined) {
    await server.close().catch(() => undefined);
  } else {
    await persistence?.close().catch(() => undefined);
  }
  process.stderr.write(
    JSON.stringify({
      event: "analysis-development-server.start.failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
      errorCode: safeErrorCode(error),
    }) + String.fromCharCode(10),
  );
  process.exitCode = 1;
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN";
  return /^[A-Z][A-Z0-9_:-]{0,127}$/u.test(error.message)
    ? error.message
    : error.name;
}
