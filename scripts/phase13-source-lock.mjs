import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { writeRealGateEvidence } from "./real-gate-evidence.mjs";
import {
  assertCandidateIntegrity,
  endpointHash,
  required,
} from "./p13-live-harness.mjs";

const candidate = assertCandidateIntegrity();
const startedAt = new Date().toISOString();
const sourceLock = JSON.parse(
  await readFile("reports/v0.3/P00-source-lock.json", "utf8"),
);
const expectedSdar = required("P13_EXPECTED_SDAR_SHA");
const expectedSmpp = required("P13_EXPECTED_SMPP_SHA");
assert.equal(sourceLock.repositories.sdar.commit, expectedSdar);
assert.equal(sourceLock.repositories.smpp.commit, expectedSmpp);
assert.equal(
  remoteMain(sourceLock.repositories.sdar.repository),
  expectedSdar,
  "SDAR origin/main moved after the candidate source lock",
);
assert.equal(
  remoteMain(sourceLock.repositories.smpp.repository),
  expectedSmpp,
  "SMPP origin/main moved after the candidate source lock",
);

const baseUrl = new URL(required("P13_REAL_SDAR_BASE_URL"));
assert.ok(["http:", "https:"].includes(baseUrl.protocol));
const cardResponse = await fetch(
  new URL("/.well-known/agent-card.json", baseUrl),
  { signal: AbortSignal.timeout(10_000) },
);
assert.equal(cardResponse.status, 200);
const cardBytes = Buffer.from(await cardResponse.arrayBuffer());
const card = JSON.parse(cardBytes.toString("utf8"));
assert.equal(card.capabilities?.streaming, true);
assert.deepEqual(card.securityRequirements ?? [], []);
const selected = card.supportedInterfaces?.find(
  (candidateInterface) =>
    candidateInterface.protocolBinding === "HTTP+JSON" &&
    candidateInterface.protocolVersion === "1.0",
);
assert.ok(selected);

const result = {
  status: "PASSED",
  candidateSha: candidate.candidateSha,
  sdarSha: expectedSdar,
  smppSha: expectedSmpp,
  sourceMainVerified: true,
  a2aSdk: sourceLock.a2aBaseline.sdk.replace("@a2a-js/sdk@", ""),
  agentCardSha256: createHash("sha256").update(cardBytes).digest("hex"),
  sdarBaseUrlSha256: endpointHash(baseUrl.toString()),
  protocolBinding: selected.protocolBinding,
  protocolVersion: selected.protocolVersion,
  streaming: true,
  securityRequirements: 0,
  startedAt,
  endedAt: new Date().toISOString(),
  command: "node scripts/phase13-source-lock.mjs",
  exitCode: 0,
  requiredSkips: 0,
};
await writeRealGateEvidence(
  "P13_SOURCE_LOCK_EVIDENCE_FILE",
  "source-lock-v03",
  result,
);
process.stdout.write(`${JSON.stringify(result)}\n`);

function remoteMain(repository) {
  const result = spawnSync(
    "git",
    ["ls-remote", repository, "refs/heads/main"],
    {
      encoding: "utf8",
      shell: false,
    },
  );
  if (result.status !== 0) throw new Error("Unable to verify upstream main");
  const sha = result.stdout.trim().split(/\s+/u)[0];
  assert.match(sha ?? "", /^[0-9a-f]{40}$/u);
  return sha;
}
