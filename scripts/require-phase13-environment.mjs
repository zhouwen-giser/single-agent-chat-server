import { spawnSync } from "node:child_process";

for (const name of [
  "TEST_DATABASE_URL",
  "P13_EXPECTED_SACS_SHA",
  "P13_REAL_EVIDENCE_DIR",
  "P13_SBOM_OUTPUT_FILE",
  "P12_EXPECTED_SDAR_SHA",
]) {
  if (!process.env[name]?.trim()) {
    throw new Error(`${name} is required for the P13 candidate gate`);
  }
}

const docker = spawnSync(
  "docker",
  ["version", "--format", "{{.Server.Version}}"],
  { encoding: "utf8", shell: false },
);
if (docker.status !== 0) {
  throw new Error("A reachable Docker daemon is required for P13 verification");
}
process.stdout.write(
  "Required PostgreSQL, exact-head real evidence, SBOM output, and Docker configuration is present.\n",
);
