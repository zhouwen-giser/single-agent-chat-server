import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

export function currentHeadSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  }).trim();
}

export async function writeRealGateEvidence(environmentName, gate, result) {
  const evidenceDirectory = process.env.P13_REAL_EVIDENCE_DIR?.trim();
  const configuredPath =
    process.env[environmentName]?.trim() ||
    (evidenceDirectory ? `${evidenceDirectory}/${gate}.json` : undefined);
  if (!configuredPath) return;

  const root = resolve(process.cwd());
  const temporaryRoot = resolve(root, ".tmp");
  const outputPath = resolve(root, configuredPath);
  const relativePath = relative(temporaryRoot, outputPath);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    resolve(temporaryRoot, relativePath) !== outputPath
  ) {
    throw new Error(`${environmentName} must resolve below .tmp`);
  }

  const dirty = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { cwd: process.cwd(), encoding: "utf8", shell: false },
  ).trim();
  if (dirty) throw new Error(`${gate} evidence requires a clean tracked tree`);

  const candidateSha = currentHeadSha();
  const expectedSha =
    process.env.P13_EXPECTED_SACS_SHA?.trim() ??
    process.env.P12_EXPECTED_SACS_SHA?.trim();
  if (expectedSha && expectedSha !== candidateSha) {
    throw new Error(
      `${gate} evidence HEAD ${candidateSha} does not match ${expectedSha}`,
    );
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        gate,
        status: "PASSED_REAL",
        candidateSha,
        generatedAt: new Date().toISOString(),
        result,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}
