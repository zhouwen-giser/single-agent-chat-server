import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import {
  createDevelopmentGateReport,
  DEVELOPMENT_VERIFICATION_COMMANDS,
  gitDevelopmentSource,
  hashCanonicalValue,
  loadDevelopmentAcceptance,
  paths,
  validateDocument,
  verifyDevelopmentGateReport,
  writeJsonAtomic,
} from "./v05-progressive-lib.mjs";

const root = process.cwd();
const layout = paths(root);
const startedAt = new Date().toISOString();
const testedSource = await gitDevelopmentSource(root);
const commands = [];
let failedStatus;

for (const specification of DEVELOPMENT_VERIFICATION_COMMANDS) {
  const sourceBefore = await gitDevelopmentSource(root);
  assertSameRunSource(testedSource, sourceBefore, specification.id, "before");
  const commandStartedAt = new Date().toISOString();
  const status = await run(specification);
  const sourceAfter = await gitDevelopmentSource(root);
  const commandFinishedAt = new Date().toISOString();
  commands.push({
    id: specification.id,
    executable: specification.executable,
    arguments: [...specification.arguments],
    exitCode: status,
    status: status === 0 ? "PASS" : "FAIL",
    startedAt: commandStartedAt,
    finishedAt: commandFinishedAt,
    sourceBefore,
    sourceAfter,
  });
  if (status !== 0) {
    failedStatus = status;
    break;
  }
  assertSameRunSource(testedSource, sourceAfter, specification.id, "after");
}

if (failedStatus !== undefined) {
  process.exitCode = failedStatus;
} else {
  const finishedAt = new Date().toISOString();
  const evidenceCore = {
    schemaVersion: "sacs-v05-development-run-evidence/1.0",
    runId: `development-${randomUUID()}`,
    startedAt,
    finishedAt,
    source: testedSource,
    commands,
  };
  const evidence = {
    ...evidenceCore,
    evidenceDigest: hashCanonicalValue(evidenceCore),
  };
  const { rows, evidenceGroups } = await loadDevelopmentAcceptance(root);
  const currentSource = await gitDevelopmentSource(root);
  const report = createDevelopmentGateReport({
    evidence,
    rows,
    evidenceGroups,
    currentSource,
  });
  await validateDocument({
    schemaPath: resolve(layout.contracts, "gate-result.schema.json"),
    document: report,
    label: "development verification",
  });

  const handoffDirectory = await mkdtemp(
    join(tmpdir(), "sacs-v05-development-evidence-"),
  );
  try {
    const candidatePath = join(
      handoffDirectory,
      "DEVELOPMENT_VERIFICATION.json",
    );
    await writeJsonAtomic(candidatePath, report);
    const gateStatus = await run({
      id: "development-evidence-gate",
      executable: "node",
      arguments: [
        "scripts/v05-progressive-development-gate.mjs",
        "--check",
        "--report-root",
        handoffDirectory,
        "--require-pass",
      ],
    });
    if (gateStatus !== 0) {
      throw new Error("DEVELOPMENT_EVIDENCE_GATE_REJECTED");
    }
    const sourceBeforePromotion = await gitDevelopmentSource(root);
    verifyDevelopmentGateReport(
      report,
      rows,
      sourceBeforePromotion,
      evidenceGroups,
    );
    await writeJsonAtomic(
      resolve(layout.reports, "DEVELOPMENT_VERIFICATION.json"),
      report,
    );
  } finally {
    await rm(handoffDirectory, { recursive: true, force: true });
  }
}

function assertSameRunSource(expected, actual, commandId, point) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `DEVELOPMENT_WORKTREE_CHANGED_${point.toUpperCase()}:${commandId}`,
    );
  }
}

function run(specification) {
  const command =
    specification.executable === "node"
      ? process.execPath
      : specification.executable;
  process.stdout.write(
    `${JSON.stringify({
      event: "v05.development.check",
      id: specification.id,
      command: specification.executable,
      arguments: specification.arguments,
    })}\n`,
  );
  return new Promise((resolveStatus, reject) => {
    const child = spawn(command, specification.arguments, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Development check terminated by ${signal}`));
      } else {
        resolveStatus(code ?? 1);
      }
    });
  });
}
