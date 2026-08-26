import { spawnSync } from "node:child_process";

import { assertExactRealSdarEvidence } from "./phase13-exact-real-sdar-evidence.mjs";

for (const script of [
  "scripts/phase13-source-lock.mjs",
  "scripts/phase13-real-model.mjs",
  "scripts/phase13-real-sdar.mjs",
  "scripts/phase13-migration-restart.mjs",
  "scripts/phase13-network-boundary.mjs",
]) {
  if (
    script === "scripts/phase13-real-sdar.mjs" &&
    process.env.P13_REUSE_EXACT_REAL_SDAR_EVIDENCE?.trim() === "true"
  ) {
    const result = await assertExactRealSdarEvidence();
    process.stdout.write(
      `${JSON.stringify({
        status: "PASSED",
        gate: "real-sdar",
        evidenceMode: "EXACT_CANDIDATE_REUSE",
        candidateSha: result.candidateSha,
        requiredSkips: 0,
      })}\n`,
    );
    continue;
  }
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
