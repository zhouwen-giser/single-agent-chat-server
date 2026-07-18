import process from "node:process";

import { buildServer } from "./bootstrap.js";
import { loadServerConfig } from "./config.js";

try {
  const config = loadServerConfig();
  const server = buildServer({ config, logger: true });
  await server.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(
    `${JSON.stringify({ event: "server.start.failed", message })}\n`,
  );
  process.exitCode = 1;
}
