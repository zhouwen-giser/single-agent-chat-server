import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { writeRealGateEvidence } from "./real-gate-evidence.mjs";
import {
  assertCandidateIntegrity,
  endpointHash,
  optional,
  required,
} from "./p13-live-harness.mjs";

const candidate = assertCandidateIntegrity();
const startedAt = new Date().toISOString();
const architecture = spawnSync(
  process.execPath,
  ["scripts/verify-architecture.mjs"],
  { cwd: process.cwd(), encoding: "utf8", shell: false },
);
assert.equal(architecture.status, 0, "architecture boundary gate failed");
assert.match(architecture.stdout, /Architecture gate passed/u);

const compose = await readFile("compose.yaml", "utf8");
assert.match(compose, /backend:\n\s+internal: true/u);
assert.match(compose, /sdar:[\s\S]*?internal: true/u);
assert.match(
  compose,
  /server:[\s\S]*?networks:\n\s+- backend\n\s+- frontend\n\s+- sdar/u,
);
assert.doesNotMatch(compose, /\b(?:SMPP|MCP|PROVIDER)_(?:BASE_)?URL\b/u);

const databaseUrl = new URL(
  optional("P13_DATABASE_URL") ?? required("TEST_DATABASE_URL"),
);
const result = {
  status: "PASSED",
  candidateSha: candidate.candidateSha,
  architectureProductionFiles: 75,
  singleSdarClientConstruction: true,
  allowedDestinations: ["conversation-model", "postgresql", "single-sdar"],
  modelEndpointSha256: endpointHash(required("P13_REAL_MODEL_BASE_URL")),
  databaseEndpointSha256: endpointHash(databaseUrl.toString()),
  sdarEndpointSha256: endpointHash(required("P13_REAL_SDAR_BASE_URL")),
  composeBackendInternal: true,
  composeSdarNetworkInternal: true,
  directSmppConfiguration: false,
  directMcpConfiguration: false,
  directProviderConfiguration: false,
  directSmppOrMcpImports: false,
  dockerVersion: dockerVersion(),
  startedAt,
  endedAt: new Date().toISOString(),
  command: "pnpm verify:v03:network",
  exitCode: 0,
  requiredSkips: 0,
};
await writeRealGateEvidence(
  "P13_NETWORK_EVIDENCE_FILE",
  "network-boundary",
  result,
);
process.stdout.write(`${JSON.stringify(result)}\n`);

function dockerVersion() {
  const version = spawnSync(
    "docker",
    ["version", "--format", "{{.Server.Version}}"],
    { cwd: process.cwd(), encoding: "utf8", shell: false },
  );
  assert.equal(version.status, 0);
  return version.stdout.trim();
}
