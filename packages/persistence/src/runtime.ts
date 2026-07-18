import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

import { createPostgresCheckpointer } from "./checkpoint.js";
import type { PersistenceConfig } from "./config.js";
import { runMigrations } from "./migrations.js";
import { ChatPersistenceRepository } from "./repository.js";

const { Pool } = pg;

export interface PersistenceRuntime {
  readonly repository: ChatPersistenceRepository;
  readonly checkpointer: PostgresSaver;
  close(): Promise<void>;
}

export async function setupPersistence(
  config: PersistenceConfig,
): Promise<PersistenceRuntime> {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
  });
  pool.on("error", () => {
    // An idle connection may die during a PostgreSQL restart. pg removes it;
    // the next repository query obtains a fresh connection from the pool.
  });
  let checkpointer: PostgresSaver | undefined;
  try {
    await runMigrations(pool);
    checkpointer = await createPostgresCheckpointer(config.connectionString);
    const activeCheckpointer = checkpointer;
    return {
      repository: new ChatPersistenceRepository(
        pool,
        config.idempotencyLeaseMs,
      ),
      checkpointer: activeCheckpointer,
      async close() {
        await Promise.all([pool.end(), activeCheckpointer.end()]);
      },
    };
  } catch (error) {
    await Promise.all([pool.end(), checkpointer?.end()]);
    throw error;
  }
}
