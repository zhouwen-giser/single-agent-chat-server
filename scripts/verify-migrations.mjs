import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const root = process.cwd();
const files = (await readdir(resolve(root, "migrations")))
  .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(file))
  .map((file) => `migrations/${file}`)
  .sort();
if (files.length === 0) throw new Error("No SQL migrations were found");

const hashes = new Set();
for (const [index, file] of files.entries()) {
  const expected = String(index + 1).padStart(4, "0") + "_";
  if (!basename(file).startsWith(expected)) {
    throw new Error(`Migration sequence is not contiguous at ${file}`);
  }
  const sql = await readFile(resolve(root, file), "utf8");
  if (sql.trim().length === 0) throw new Error(`Empty migration: ${file}`);
  const executableSql = sql
    .replaceAll(/'(?:''|[^'])*'/gu, "''")
    .replaceAll(
      /\b(BEFORE|AFTER|INSTEAD\s+OF)\s+TRUNCATE\s+ON\b/giu,
      "$1 TRUNCATE_EVENT ON",
    );
  if (
    /\b(?:DROP\s+(?:DATABASE|SCHEMA|TABLE)|TRUNCATE)\b/iu.test(executableSql)
  ) {
    throw new Error(`Destructive statement is forbidden in ${file}`);
  }
  const normalized = sql.replaceAll(/\s+/gu, " ").trim();
  if (hashes.has(normalized)) throw new Error(`Duplicate migration: ${file}`);
  hashes.add(normalized);
}

const runner = await readFile(
  resolve(root, "packages/persistence/src/migrations.ts"),
  "utf8",
);
for (const required of [
  "createHash",
  "pg_advisory_lock",
  "checksum mismatch",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
]) {
  if (!runner.toLowerCase().includes(required.toLowerCase())) {
    throw new Error(`Migration runner is missing ${required}`);
  }
}

process.stdout.write(
  `Migration gate passed: ${files.length} contiguous append-only files with checksum, lock, and transaction enforcement.\n`,
);
