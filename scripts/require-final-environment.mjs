import { spawnSync } from "node:child_process";

for (const name of [
  "TEST_DATABASE_URL",
  "OPENWEBUI_VERIFY_BASE_URL",
  "OPENWEBUI_VERIFY_BEARER_TOKEN",
  "OPENWEBUI_VERIFY_TASK_PROMPT",
  "SDAR_A2A_BASE_URL",
  "PHASE13_E2E_EVIDENCE_FILE",
]) {
  if (!process.env[name]?.trim()) {
    throw new Error(`${name} is required for the final real-environment gate`);
  }
}
const docker = spawnSync(
  "docker",
  ["version", "--format", "{{.Server.Version}}"],
  {
    encoding: "utf8",
    shell: false,
  },
);
if (docker.status !== 0) {
  throw new Error(
    "A reachable Docker daemon is required for final verification",
  );
}
process.stdout.write(
  "Required PostgreSQL, Open WebUI, SDAR, evidence, and Docker configuration is present.\n",
);
