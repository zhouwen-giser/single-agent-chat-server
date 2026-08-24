import { spawnSync } from "node:child_process";

for (const script of [
  "scripts/phase13-source-lock.mjs",
  "scripts/phase13-real-model.mjs",
  "scripts/phase13-real-sdar.mjs",
  "scripts/phase13-migration-restart.mjs",
  "scripts/phase13-network-boundary.mjs",
]) {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: false,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(
      `${script} failed with exit status ${String(result.status)}`,
    );
  }
}
