import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

import { createPostgresCheckpointer } from "./checkpoint.js";
import { AnalysisRepository } from "./analysis-repository.js";
import { AuthorityFusionRepository } from "./authority-fusion-repository.js";
import type { PersistenceConfig } from "./config.js";
import { ConversationPersistenceRepository } from "./conversation-repository.js";
import { InteractionPersistenceRepository } from "./interaction-repository.js";
import { GroundingPersistenceRepository } from "./grounding-repository.js";
import { PostgresWorldFocusRepository } from "./world-focus-repository.js";
import { WorldExplanationRepository } from "./world-explanation-repository.js";
import { StructuredWorldSelectionRepository } from "./structured-world-selection-repository.js";
import { runMigrations } from "./migrations.js";
import type { PersistenceObservationSink } from "./observation.js";
import { ChatPersistenceRepository } from "./repository.js";

const { Pool } = pg;

export interface PersistenceRuntime {
  readonly analysisRepository: AnalysisRepository;
  readonly repository: ChatPersistenceRepository;
  readonly interactionRepository: InteractionPersistenceRepository;
  readonly groundingRepository: GroundingPersistenceRepository;
  readonly worldFocusRepository: PostgresWorldFocusRepository;
  readonly worldExplanationRepository: WorldExplanationRepository;
  readonly structuredWorldSelectionRepository: StructuredWorldSelectionRepository;
  readonly authorityFusionRepository: AuthorityFusionRepository;
  readonly conversationRepository: ConversationPersistenceRepository;
  readonly checkpointer: PostgresSaver;
  readiness(): Promise<boolean>;
  close(): Promise<void>;
}

export async function setupPersistence(
  config: PersistenceConfig,
  observation?: PersistenceObservationSink,
): Promise<PersistenceRuntime> {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.operationTimeoutMs,
    query_timeout: config.operationTimeoutMs,
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
      analysisRepository: new AnalysisRepository(pool),
      repository: new ChatPersistenceRepository(
        pool,
        config.idempotencyLeaseMs,
        config.maxActiveTasksPerChat,
      ),
      interactionRepository: new InteractionPersistenceRepository(
        pool,
        config.idempotencyLeaseMs,
        config.maxActiveTasksPerChat,
        observation,
      ),
      groundingRepository: new GroundingPersistenceRepository(
        pool,
        config.idempotencyLeaseMs,
      ),
      worldFocusRepository: new PostgresWorldFocusRepository(pool),
      worldExplanationRepository: new WorldExplanationRepository(pool),
      structuredWorldSelectionRepository:
        new StructuredWorldSelectionRepository(pool),
      authorityFusionRepository: new AuthorityFusionRepository(pool),
      conversationRepository: new ConversationPersistenceRepository(
        pool,
        observation,
      ),
      checkpointer: activeCheckpointer,
      async readiness() {
        try {
          await pool.query("SELECT 1");
          return true;
        } catch {
          return false;
        }
      },
      async close() {
        await Promise.all([pool.end(), activeCheckpointer.end()]);
      },
    };
  } catch (error) {
    await Promise.all([pool.end(), checkpointer?.end()]);
    throw error;
  }
}
