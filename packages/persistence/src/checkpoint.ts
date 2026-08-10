import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

export const CHECKPOINT_SCHEMA = "langgraph_checkpoint";

export async function createPostgresCheckpointer(
  connectionString: string,
): Promise<PostgresSaver> {
  const checkpointer = PostgresSaver.fromConnString(connectionString, {
    schema: CHECKPOINT_SCHEMA,
  });
  await checkpointer.setup();
  return checkpointer;
}
