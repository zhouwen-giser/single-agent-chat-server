import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";

export async function assertExactRealSdarEvidence(options = {}) {
  const expectedCandidate = required("P13_EXPECTED_SACS_SHA");
  const evidenceDirectory = temporaryPath(required("P13_REAL_EVIDENCE_DIR"));
  const document = JSON.parse(
    await readFile(resolve(evidenceDirectory, "real-sdar.json"), "utf8"),
  );
  const localHead =
    options.headSha ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
    }).trim();

  assert.equal(localHead, expectedCandidate, "real SDAR evidence local SHA");
  assert.equal(document.schemaVersion, 1, "real SDAR evidence schema");
  assert.equal(document.gate, "real-sdar", "real SDAR evidence identity");
  assert.equal(document.status, "PASSED_REAL", "real SDAR evidence status");
  assert.equal(
    document.candidateSha,
    expectedCandidate,
    "real SDAR evidence candidate SHA",
  );
  assert.equal(document.result?.status, "PASSED");
  assert.equal(document.result?.candidateSha, expectedCandidate);
  assert.equal(
    document.result?.sdarSourceSha,
    required("P13_EXPECTED_SDAR_SHA"),
  );
  assert.equal(
    document.result?.smppSourceSha,
    required("P13_EXPECTED_SMPP_SHA"),
  );
  assert.equal(document.result?.activeTasksCreated, 2);
  assert.equal(document.result?.listContainedBoth, true);
  assert.equal(document.result?.taskAUnchangedByTaskBOperation, true);
  assert.equal(
    document.result?.ambiguousMutationClarifiedWithoutBindingMutation,
    true,
  );
  assert.equal(document.result?.domainRequestRoutedThroughSdar, true);
  assert.equal(document.result?.clientDisconnectCanceledTask, false);
  assert.equal(document.result?.directSmppOrMcpAccess, false);
  assert.equal(document.result?.promptRecorded, false);
  assert.equal(document.result?.exitCode, 0);
  assert.equal(document.result?.requiredSkips, 0);
  assert.match(document.result?.startedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
  assert.match(document.result?.endedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);

  return document.result;
}

function temporaryPath(configuredPath) {
  const root = resolve(process.cwd());
  const temporaryRoot = resolve(root, ".tmp");
  const candidate = resolve(root, configuredPath);
  const relativePath = relative(temporaryRoot, candidate);
  if (relativePath === "" || relativePath.startsWith("..")) {
    throw new Error("P13_REAL_EVIDENCE_DIR must resolve below .tmp");
  }
  return candidate;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for exact evidence reuse`);
  return value;
}
