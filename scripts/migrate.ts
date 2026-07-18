import { parsePersistenceConfig } from "../packages/persistence/src/config.js";
import { setupPersistence } from "../packages/persistence/src/runtime.js";

const runtime = await setupPersistence(parsePersistenceConfig(process.env));
await runtime.close();
process.stdout.write(
  "PostgreSQL migrations and checkpointer setup complete.\n",
);
