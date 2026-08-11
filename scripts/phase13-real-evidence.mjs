import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const expectedSha = required("P13_EXPECTED_SACS_SHA");
const evidenceDirectory = temporaryPath(required("P13_REAL_EVIDENCE_DIR"));
const expectedSdarSha = required("P12_EXPECTED_SDAR_SHA");
const { stdout: localHead } = await execFileAsync("git", ["rev-parse", "HEAD"]);
assert.equal(localHead.trim(), expectedSha);
const { stdout: dirty } = await execFileAsync("git", [
  "status",
  "--porcelain",
  "--untracked-files=no",
]);
assert.equal(dirty.trim(), "", "candidate tracked tree must be clean");
const { stdout: remoteHead } = await execFileAsync("git", [
  "rev-parse",
  "origin/feature/single-sdar-chat-entry-v0.1",
]);
assert.equal(remoteHead.trim(), expectedSha);

const documents = {};
for (const [name, gate] of [
  ["sourceLock", "source-lock"],
  ["openWebUi", "openwebui"],
  ["officialAgUi", "official-ag-ui"],
  ["consistency", "same-task-consistency"],
  ["longObservation", "long-observation"],
]) {
  const document = JSON.parse(
    await readFile(resolve(evidenceDirectory, `${gate}.json`), "utf8"),
  );
  assert.equal(document.schemaVersion, 1, `${gate} schema`);
  assert.equal(document.gate, gate, `${gate} identity`);
  assert.equal(document.status, "PASSED_REAL", `${gate} status`);
  assert.equal(document.candidateSha, expectedSha, `${gate} candidate SHA`);
  documents[name] = document.result;
}

assert.equal(documents.sourceLock.sdarSha, expectedSdarSha);
assert.equal(documents.sourceLock.sdarClean, true);
assert.equal(documents.sourceLock.a2aSdk, "1.0.0-beta.0");
assert.equal(documents.sourceLock.protocolBinding, "HTTP+JSON");
assert.equal(documents.sourceLock.protocolVersion, "1.0");
assert.equal(documents.sourceLock.streaming, true);
assert.equal(documents.openWebUi.status, "PASSED");
assert.equal(documents.officialAgUi.status, "PASSED");
assert.equal(documents.officialAgUi.rawEvents, false);
assert.equal(documents.officialAgUi.toolCalls, false);
assert.equal(documents.consistency.status, "PASSED");
assert.equal(documents.consistency.normalizedState, "COMPLETED");
assert.equal(documents.consistency.rawEvents, false);
assert.equal(documents.consistency.toolCalls, false);
assert.equal(documents.longObservation.status, "PASSED");
assert.equal(documents.longObservation.initialObservationEnded, true);
assert.equal(documents.longObservation.taskContinuesAtBoundary, true);
assert.equal(documents.longObservation.recoveredWithGetTaskPolling, true);
assert.equal(documents.longObservation.eventCursor, false);
assert.equal(documents.longObservation.taskResubscription, false);

process.stdout.write(
  `${JSON.stringify({
    status: "PASSED",
    candidateSha: expectedSha,
    remoteHead: remoteHead.trim(),
    requiredRealGates: 5,
    requiredSkips: 0,
    sdarSha: documents.sourceLock.sdarSha,
    agentCardSha256: documents.sourceLock.agentCardSha256,
    openWebUiRunId: documents.openWebUi.runId,
    officialAgUiTaskId: documents.officialAgUi.taskId,
    consistencyTaskId: documents.consistency.taskId,
    longObservationTaskId: documents.longObservation.taskId,
  })}\n`,
);

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
  if (!value) throw new Error(`${name} is required for the P13 evidence gate`);
  return value;
}
