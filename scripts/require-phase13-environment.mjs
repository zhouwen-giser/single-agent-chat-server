import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";

for (const name of [
  "P13_EXPECTED_SACS_SHA",
  "P13_EXPECTED_SDAR_SHA",
  "P13_EXPECTED_SMPP_SHA",
  "P13_REAL_EVIDENCE_DIR",
  "P13_SBOM_OUTPUT_FILE",
  "P13_REAL_MODEL_BASE_URL",
  "P13_REAL_MODEL_NAME",
  "P13_REAL_SDAR_BASE_URL",
  "P13_SAFE_TASK_A_TEXT",
  "P13_SAFE_TASK_B_TEXT",
  "P13_SAFE_DOMAIN_KIND",
  "P13_POSTGRES_CONTAINER",
  "P13_CI_RUN_URL",
]) {
  required(name);
}
if (!process.env.P13_DATABASE_URL?.trim()) required("TEST_DATABASE_URL");

for (const name of ["P13_REAL_EVIDENCE_DIR", "P13_SBOM_OUTPUT_FILE"]) {
  const configured = required(name);
  const temporaryRoot = resolve(process.cwd(), ".tmp");
  const candidate = resolve(process.cwd(), configured);
  const relativePath = relative(temporaryRoot, candidate);
  assert.ok(
    relativePath !== "" && !relativePath.startsWith(".."),
    `${name} must resolve below .tmp`,
  );
}

for (const name of [
  "P13_EXPECTED_SACS_SHA",
  "P13_EXPECTED_SDAR_SHA",
  "P13_EXPECTED_SMPP_SHA",
]) {
  assert.match(required(name), /^[0-9a-f]{40}$/u, `${name} must be a SHA`);
}
assert.match(
  required("P13_POSTGRES_CONTAINER"),
  /^sacs-v03-[a-z0-9-]+$/u,
  "P13_POSTGRES_CONTAINER must identify an isolated v0.3 test container",
);
assert.match(
  required("P13_SAFE_DOMAIN_KIND"),
  /^(provider|resource|action|diagnostic)$/u,
);

for (const name of ["P13_REAL_MODEL_BASE_URL", "P13_REAL_SDAR_BASE_URL"]) {
  const url = new URL(required(name));
  assert.ok(["http:", "https:"].includes(url.protocol));
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
  "P13 exact-head PostgreSQL, real model, real SDAR, source-lock, evidence, SBOM, and Docker configuration is present.\n",
);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the P13 candidate gate`);
  return value;
}
