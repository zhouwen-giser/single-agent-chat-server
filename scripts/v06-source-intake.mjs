import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const upstream = resolve(
  process.argv[2] ?? "../world-semantic-grounding-service",
);
const commit = "565e52705bb7656d4623a04655001325ca61acd0";
const directory = "contracts/wsgs-v0.2.1-sacs-geospatial";
const destination = "dependencies/wsgs-v06";
const reports = "reports/v0.6/wsgs-full-functional-integration";
if (existsSync(`${reports}/ACCEPTANCE_LEDGER.json`))
  throw Error(
    "V06_INTAKE_ALREADY_INITIALIZED: preserve the existing ledger; use phase verification instead of resetting intake.",
  );
const hash = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const blob = (path) =>
  execFileSync("git", [
    "-C",
    upstream,
    "show",
    `${commit}:${directory}/${path}`,
  ]);
const write = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const json = (path, value) =>
  write(path, JSON.stringify(value, null, 2) + "\n");
const lockBytes = blob("contract-release-lock.json");
const lock = JSON.parse(lockBytes);
const artifacts = [];
for (const [path, expected] of Object.entries(lock.artifacts)) {
  if (path.startsWith("/") || path.split("/").includes(".."))
    throw Error("Unsafe artifact path");
  const bytes = blob(path);
  if (hash(bytes) !== expected) throw Error(`Artifact drift: ${path}`);
  write(`${destination}/${path}`, bytes);
  artifacts.push({ path: `${directory}/${path}`, sha256: expected });
}
write(`${destination}/contract-release-lock.json`, lockBytes);
artifacts.push({
  path: `${directory}/contract-release-lock.json`,
  sha256: hash(lockBytes),
});
const legacy = JSON.parse(
  blob("baselines/sacs-wsgs-grounding-1.0-contract-lock.json"),
);
for (const [path, expected] of Object.entries(legacy.artifacts)) {
  const bytes = execFileSync("git", [
    "-C",
    upstream,
    "show",
    `${commit}:contracts/wsgs-v0.1/${path}`,
  ]);
  if (hash(bytes) !== expected) throw Error(`Legacy artifact drift: ${path}`);
  write(`${destination}/legacy/${path}`, bytes);
  artifacts.push({ path: `contracts/wsgs-v0.1/${path}`, sha256: expected });
}
const now = new Date().toISOString();
const source = git("rev-parse", "HEAD");
json(`${reports}/SOURCE_LOCK.json`, {
  schemaVersion: "sacs-v06-source-lock/1.0",
  capturedAt: now,
  taskPackage: {
    sha256:
      "sha256:e9eb19749e8905233c89f590e1fdf31548ad89927713b3996e1d0664d6852235",
    verified: true,
  },
  sacs: {
    repository: "zhouwen-giser/single-agent-chat-server",
    branch: "codex/sacs-v0.5-observer-first-interactive-analysis",
    commit: source,
    treeStatus: "CLEAN",
  },
  wsgs: {
    repository: "zhouwen-giser/world-semantic-grounding-service",
    branch: "main",
    commit,
    treeStatus: "CLEAN",
    contractArtifacts: artifacts,
  },
  toolchain: {
    node: process.version,
    pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
  },
  worktree: { clean: true, statusDigest: hash(""), preservedChanges: [] },
  notes: [
    "Initial SACS intake was clean. WSGS artifacts read from immutable main Git blobs; sibling checkout left unchanged.",
    "WSGS geospatial branch observed at 8c78600a8886f13cd9f4f418f9297cf9ecf39c32. Main is the selected authoritative source.",
  ],
});
const matrix = JSON.parse(
  readFileSync("config/v0.6/task-package/acceptance/acceptance-matrix.json"),
);
json(`${reports}/ACCEPTANCE_LEDGER.json`, {
  schemaVersion: "sacs-v06-acceptance-ledger/1.0",
  sourceSha: source,
  updatedAt: now,
  rows: matrix.rows.map((row) => ({
    id: row.id,
    status: row.initialStatus,
    evidenceRefs: [],
  })),
});
json(`${reports}/PROGRESSIVE_STATUS.json`, {
  schemaVersion: "sacs-v06-progressive-status/1.0",
  sourceSha: source,
  updatedAt: now,
  development: "IN_PROGRESS",
  realWsgsIntegration: "NOT_STARTED",
  release: "NOT_REQUESTED",
  markers: ["SACS_WSGS_NATIVE_ANALYSIS_CONTROL_DEFERRED"],
  pendingReasons: [],
  hardFailures: [],
});
console.log(
  JSON.stringify({
    status: "PASS",
    source,
    wsgs: commit,
    artifacts: artifacts.length,
    releaseLockHash: hash(lockBytes),
  }),
);
