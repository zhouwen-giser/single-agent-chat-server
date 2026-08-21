import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const expectedSha = required("P13_EXPECTED_SACS_SHA");
const evidenceDirectory = temporaryPath(required("P13_REAL_EVIDENCE_DIR"));
const branch =
  process.env.P13_REMOTE_BRANCH?.trim() ??
  "feature/sacs-v0.3-general-conversation-multitask";
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
  `origin/${branch}`,
]);
assert.equal(remoteHead.trim(), expectedSha);

const documents = {};
for (const [name, gate] of [
  ["sourceLock", "source-lock-v03"],
  ["model", "real-model"],
  ["sdar", "real-sdar"],
  ["migration", "migration-restart"],
  ["network", "network-boundary"],
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

assert.equal(documents.sourceLock.status, "PASSED");
assert.equal(documents.sourceLock.sdarSha, required("P13_EXPECTED_SDAR_SHA"));
assert.equal(documents.sourceLock.smppSha, required("P13_EXPECTED_SMPP_SHA"));
assert.equal(documents.sourceLock.protocolBinding, "HTTP+JSON");
assert.equal(documents.sourceLock.protocolVersion, "1.0");
assert.equal(documents.sourceLock.streaming, true);
assert.equal(documents.model.status, "PASSED");
assert.equal(documents.model.protocol, "OpenAI-compatible Chat Completions");
assert.equal(documents.model.durableTwoTurnReference, true);
assert.equal(documents.model.strictTurnDecision, true);
assert.equal(documents.model.apiKeyRecorded, false);
assert.equal(documents.model.promptRecorded, false);
assert.equal(documents.sdar.status, "PASSED");
assert.equal(documents.sdar.activeTasksCreated, 2);
assert.equal(documents.sdar.listContainedBoth, true);
assert.equal(documents.sdar.taskAUnchangedByTaskBOperation, true);
assert.equal(
  documents.sdar.ambiguousMutationClarifiedWithoutBindingMutation,
  true,
);
assert.equal(documents.sdar.domainRequestRoutedThroughSdar, true);
assert.equal(documents.sdar.clientDisconnectCanceledTask, false);
assert.equal(documents.migration.status, "PASSED");
assert.equal(documents.migration.restartPerformed, true);
assert.equal(documents.migration.contextRecovered, true);
assert.equal(documents.migration.taskDirectoryRecovered, true);
assert.equal(documents.migration.focusedTaskRecovered, true);
assert.equal(documents.migration.legacyTaskResultRecovered, true);
assert.equal(documents.migration.messageResultReplayRecovered, true);
assert.equal(documents.network.status, "PASSED");
assert.equal(documents.network.singleSdarClientConstruction, true);
assert.equal(documents.network.directSmppConfiguration, false);
assert.equal(documents.network.directMcpConfiguration, false);
assert.equal(documents.network.directProviderConfiguration, false);
for (const result of Object.values(documents)) {
  assert.match(result.startedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.match(result.endedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(result.exitCode, 0);
  assert.equal(result.requiredSkips, 0);
}

process.stdout.write(
  `${JSON.stringify({
    status: "PASSED",
    candidateSha: expectedSha,
    remoteHead: remoteHead.trim(),
    remoteBranch: branch,
    requiredRealGates: 5,
    requiredSkips: 0,
    sdarSha: documents.sourceLock.sdarSha,
    smppSha: documents.sourceLock.smppSha,
    agentCardSha256: documents.sourceLock.agentCardSha256,
    modelName: documents.model.modelName,
    safeSdarOperationMode: documents.sdar.safeOperationMode,
    migrationVersions: documents.migration.schemaVersions,
    ciRunUrl: required("P13_CI_RUN_URL"),
    dockerVersion: documents.network.dockerVersion,
    postgresVersion: documents.migration.postgresVersion,
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
