import { z } from "zod";

const persistenceEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_OPERATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30_000)
    .default(5_000),
  IDEMPOTENCY_LEASE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(30 * 60_000)
    .default(60_000),
});

export interface PersistenceConfig {
  readonly connectionString: string;
  readonly poolMax: number;
  readonly operationTimeoutMs: number;
  readonly idempotencyLeaseMs: number;
}

export function parsePersistenceConfig(
  environment: NodeJS.ProcessEnv,
): PersistenceConfig {
  const parsed = persistenceEnvironmentSchema.parse(environment);
  return {
    connectionString: parsed.DATABASE_URL,
    poolMax: parsed.DATABASE_POOL_MAX,
    operationTimeoutMs: parsed.DATABASE_OPERATION_TIMEOUT_MS,
    idempotencyLeaseMs: parsed.IDEMPOTENCY_LEASE_MS,
  };
}
