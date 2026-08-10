import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Pool, PoolClient } from "pg";

const migrationFilePattern = /^\d{4}_[a-z0-9_]+\.sql$/u;
const migrationLockKey = 1_947_307_411;

export interface AppliedMigration {
  readonly version: string;
  readonly checksum: string;
}

export async function runMigrations(
  pool: Pool,
  directory = resolve(process.cwd(), "migrations"),
): Promise<readonly AppliedMigration[]> {
  const files = (await readdir(directory))
    .filter((file) => migrationFilePattern.test(file))
    .sort();
  if (files.length === 0) throw new Error("No persistence migrations found");

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [migrationLockKey]);
    await client.query("CREATE SCHEMA IF NOT EXISTS chat_service");
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_service.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied: AppliedMigration[] = [];
    for (const file of files) {
      const sql = await readFile(resolve(directory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      await applyMigration(client, file, checksum, sql);
      applied.push({ version: file, checksum });
    }
    return applied;
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [migrationLockKey])
      .catch(() => undefined);
    client.release();
  }
}

async function applyMigration(
  client: PoolClient,
  version: string,
  checksum: string,
  sql: string,
): Promise<void> {
  const existing = await client.query<{ checksum: string }>(
    "SELECT checksum FROM chat_service.schema_migrations WHERE version = $1",
    [version],
  );
  if (existing.rowCount === 1) {
    if (existing.rows[0]?.checksum !== checksum) {
      throw new Error(`Migration checksum mismatch: ${version}`);
    }
    return;
  }

  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO chat_service.schema_migrations(version, checksum) VALUES ($1, $2)",
      [version, checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
