import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { assertExactRealSdarEvidence } from "../scripts/phase13-exact-real-sdar-evidence.mjs";

const temporaryRoot = resolve(process.cwd(), ".tmp");
const environmentNames = [
  "P13_EXPECTED_SACS_SHA",
  "P13_EXPECTED_SDAR_SHA",
  "P13_EXPECTED_SMPP_SHA",
  "P13_REAL_EVIDENCE_DIR",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentNames.map((name) => [name, process.env[name]]),
);
let directory = "";
const candidateSha = "c".repeat(40);

beforeEach(async () => {
  await mkdir(temporaryRoot, { recursive: true });
  directory = await mkdtemp(resolve(temporaryRoot, "phase13-reuse-unit-"));
  process.env.P13_EXPECTED_SACS_SHA = candidateSha;
  process.env.P13_EXPECTED_SDAR_SHA = "a".repeat(40);
  process.env.P13_EXPECTED_SMPP_SHA = "b".repeat(40);
  process.env.P13_REAL_EVIDENCE_DIR = relative(process.cwd(), directory);
});

afterEach(async () => {
  for (const name of environmentNames) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (directory !== "") await rm(directory, { recursive: true, force: true });
});

it("accepts only complete real SDAR evidence for the exact clean candidate", async () => {
  await writeEvidence();
  await expect(
    assertExactRealSdarEvidence({ headSha: candidateSha }),
  ).resolves.toMatchObject({
    status: "PASSED",
    activeTasksCreated: 2,
    requiredSkips: 0,
  });
});

it("rejects evidence that did not prove both active Tasks", async () => {
  await writeEvidence({ activeTasksCreated: 1 });
  await expect(
    assertExactRealSdarEvidence({ headSha: candidateSha }),
  ).rejects.toThrow();
});

async function writeEvidence(overrides: Record<string, unknown> = {}) {
  const result = {
    status: "PASSED",
    candidateSha,
    sdarSourceSha: process.env.P13_EXPECTED_SDAR_SHA,
    smppSourceSha: process.env.P13_EXPECTED_SMPP_SHA,
    activeTasksCreated: 2,
    listContainedBoth: true,
    taskAUnchangedByTaskBOperation: true,
    ambiguousMutationClarifiedWithoutBindingMutation: true,
    domainRequestRoutedThroughSdar: true,
    clientDisconnectCanceledTask: false,
    directSmppOrMcpAccess: false,
    promptRecorded: false,
    startedAt: "2026-08-25T00:00:00.000Z",
    endedAt: "2026-08-25T00:01:00.000Z",
    exitCode: 0,
    requiredSkips: 0,
    ...overrides,
  };
  await writeFile(
    resolve(directory, "real-sdar.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      gate: "real-sdar",
      status: "PASSED_REAL",
      candidateSha,
      generatedAt: "2026-08-25T00:01:00.000Z",
      result,
    })}\n`,
  );
}
