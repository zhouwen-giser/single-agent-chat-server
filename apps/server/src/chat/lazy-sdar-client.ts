import type { SdarA2aClient } from "../../../../packages/sdar-a2a-adapter/src/index.js";

export function createLazySdarClient(
  factory: () => Promise<SdarA2aClient>,
): () => Promise<SdarA2aClient> {
  let pending: Promise<SdarA2aClient> | undefined;
  return () => {
    if (pending === undefined) {
      pending = factory().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}
