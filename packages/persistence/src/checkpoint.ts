import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

export const CHECKPOINT_SCHEMA = "langgraph_checkpoint";

export async function createPostgresCheckpointer(
  connectionString: string,
  options?: { readonly poolMax: number; readonly operationTimeoutMs: number },
): Promise<PostgresSaver> {
  const pool = new pg.Pool({
    connectionString,
    max: options?.poolMax ?? 10,
    connectionTimeoutMillis: options?.operationTimeoutMs ?? 10000,
    query_timeout: options?.operationTimeoutMs ?? 10000,
  });
  // pg discards a dead idle client. Active operations still reject normally;
  // the next checkpoint operation reconnects instead of crashing the process.
  pool.on("error", () => undefined);
  const checkpointer = new PostgresSaver(pool, undefined, {
    schema: CHECKPOINT_SCHEMA,
  });
  try {
    await checkpointer.setup();
    return checkpointer;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
