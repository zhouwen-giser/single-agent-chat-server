import { randomUUID } from "node:crypto";
import process from "node:process";

import {
  parsePersistenceConfig,
  setupPersistence,
  type PersistenceRuntime,
} from "../../../packages/persistence/src/index.js";
import { buildServer } from "./bootstrap.js";
import { loadServerConfig } from "./config.js";

let persistence: PersistenceRuntime | undefined;
try {
  const config = loadServerConfig();
  persistence = await setupPersistence(parsePersistenceConfig(process.env));
  const reconciliation = await persistence.repository.reconcileStartup({
    leaseOwner: randomUUID(),
  });
  const server = buildServer({ config, logger: true });
  server.addHook("onClose", async () => persistence?.close());
  server.log.info(
    {
      activeTaskBindings: reconciliation.activeBindings.length,
      recoveredIdempotencyClaims: reconciliation.recoveredClaimCount,
    },
    "persistence startup reconciliation complete",
  );
  await server.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  await persistence?.close().catch(() => undefined);
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(
    JSON.stringify({ event: "server.start.failed", message }) +
      String.fromCharCode(10),
  );
  process.exitCode = 1;
}
