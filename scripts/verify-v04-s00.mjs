import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceLock = readJson("reports/v0.4/S00-source-lock.json");
const wsgsContractLock = readJson(
  "dependencies/wsgs-northbound-contract-lock.json",
);
const sdarCompatibilityLock = readJson(
  "dependencies/sdar-grounding-extension-compatibility-lock.json",
);
const wsgsRepository = resolve(
  process.env.WSGS_REPOSITORY_PATH ??
    resolve(repositoryRoot, "..", "world-semantic-grounding-service"),
);
const sdarRepository = resolve(
  process.env.SDAR_REPOSITORY_PATH ??
    resolve(repositoryRoot, "..", "skill-driven-agent-runtime"),
);

assert.equal(readJson("package.json").version, "0.4.0");
assert.equal(
  gitText(repositoryRoot, ["branch", "--show-current"]),
  sourceLock.branch,
);
assert.equal(
  gitText(repositoryRoot, ["rev-parse", "origin/main"]),
  sourceLock.repositories.sacs.commit,
);
assert.equal(
  gitText(repositoryRoot, ["rev-parse", "origin/main^{tree}"]),
  sourceLock.repositories.sacs.tree,
);
git(repositoryRoot, [
  "merge-base",
  "--is-ancestor",
  sourceLock.repositories.sacs.commit,
  "HEAD",
]);

for (const [path, expected] of Object.entries(sourceLock.immutableMigrations)) {
  const actual = sha256(readFileSync(resolve(repositoryRoot, path)));
  assert.equal(`sha256:${actual}`, expected, `${path} changed after S00 lock`);
}

const wsgsRef = sourceLock.repositories.wsgs.ref;
assert.equal(
  gitText(wsgsRepository, ["rev-parse", wsgsRef]),
  sourceLock.repositories.wsgs.commit,
  "WSGS candidate ref moved; fetch and reconcile before continuing",
);
assert.equal(
  gitText(wsgsRepository, ["rev-parse", `${wsgsRef}^{tree}`]),
  sourceLock.repositories.wsgs.tree,
);
assert.equal(
  gitText(wsgsRepository, [
    "rev-parse",
    `${wsgsRef}:contracts/wsgs-v0.1/contract-lock.json`,
  ]),
  sourceLock.repositories.wsgs.contractLockBlob,
);
assert.equal(gitText(wsgsRepository, ["show", `${wsgsRef}:VERSION`]), "0.2.0");

const upstreamContractLock = JSON.parse(
  git(wsgsRepository, [
    "show",
    `${wsgsRef}:contracts/wsgs-v0.1/contract-lock.json`,
  ]).toString("utf8"),
);
assert.deepEqual(wsgsContractLock, upstreamContractLock);
assert.equal(wsgsContractLock.contractVersion, "sacs-wsgs-grounding/1.0");
assert.equal(Object.keys(wsgsContractLock.artifacts).length, 32);
for (const [path, expected] of Object.entries(wsgsContractLock.artifacts)) {
  const bytes = git(wsgsRepository, [
    "show",
    `${wsgsRef}:contracts/wsgs-v0.1/${path}`,
  ]);
  assert.equal(`sha256:${sha256(bytes)}`, expected, `WSGS hash drift: ${path}`);
}

const wsgsDecision = git(wsgsRepository, [
  "show",
  `${wsgsRef}:reports/wsgs-v0.2/final-stable-candidate.md`,
]).toString("utf8");
assert.match(wsgsDecision, /# WSGS v0\.2 Blocked Candidate Report/u);
assert.match(wsgsDecision, /195 PASS, 0 FAIL, 17 NOT_RUN, and 67 BLOCKED/u);
assert.match(wsgsDecision, /No readiness or completion marker is emitted\./u);
assert.equal(sourceLock.repositories.wsgs.candidateDecision, "BLOCKED");
assert.equal(
  sourceLock.repositories.wsgs.markers.GOWM_0_6_3_CONTRACT_LOCKED,
  true,
);
for (const [marker, ready] of Object.entries(
  sourceLock.repositories.wsgs.markers,
)) {
  if (marker !== "GOWM_0_6_3_CONTRACT_LOCKED") assert.equal(ready, false);
}

assert.equal(
  gitText(sdarRepository, ["rev-parse", sourceLock.repositories.sdar.ref]),
  sourceLock.repositories.sdar.commit,
  "SDAR main moved; fetch and regenerate the compatibility lock",
);
assert.equal(
  gitText(sdarRepository, [
    "rev-parse",
    `${sourceLock.repositories.sdar.ref}^{tree}`,
  ]),
  sourceLock.repositories.sdar.tree,
);
const extensionSearch = spawnSync(
  "git",
  [
    "grep",
    "-n",
    "-I",
    "--fixed-strings",
    sdarCompatibilityLock.profile,
    sourceLock.repositories.sdar.ref,
    "--",
    ".",
  ],
  { cwd: sdarRepository, encoding: "utf8", shell: false },
);
assert.equal(extensionSearch.status, 1, extensionSearch.stderr);
assert.equal(extensionSearch.stdout, "");
assert.equal(sdarCompatibilityLock.status, "UNAVAILABLE");
assert.equal(sdarCompatibilityLock.dataPartMediaType, null);
assert.equal(sdarCompatibilityLock.schemaSha256, null);
assert.equal(
  sdarCompatibilityLock.requiredRuntimeError,
  "SDAR_GROUNDING_EXTENSION_UNAVAILABLE",
);
assert.deepEqual(sdarCompatibilityLock.fallback, {
  dropDataPart: false,
  convertToText: false,
  modifySdar: false,
});

const result = {
  phase: "S00",
  status: "PASS_WITH_EXTERNAL_BLOCKERS",
  sacsBaseSha: sourceLock.repositories.sacs.commit,
  wsgsCandidateSha: sourceLock.repositories.wsgs.commit,
  wsgsContractArtifactsVerified: 32,
  wsgsCandidateDecision: "BLOCKED",
  sdarSha: sourceLock.repositories.sdar.commit,
  sdarGroundingExtension: "UNAVAILABLE",
  stableCandidateEligible: false,
  requiredDisposition: "SACS_V0_4_STABLE_CANDIDATE_BLOCKED",
};
process.stdout.write(`${JSON.stringify(result)}\n`);

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: null, shell: false });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString("utf8").trim()}`,
    );
  }
  return result.stdout;
}

function gitText(cwd, args) {
  return git(cwd, args).toString("utf8").trim();
}
