import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const { parseRealCaseFile, realCaseIds } =
  await import("../dist/scripts/lib/v06-real-cases.js");
const { createWsgsHttpClient } =
  await import("../dist/packages/wsgs-http-adapter/src/index.js");
const input = process.env.SACS_FUNCTIONAL_REAL_CASES;
const evidence = {
  schemaVersion: "sacs-functional-real-preflight/1.0",
  sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  status: "BLOCKED_EXTERNAL",
  businessSubmissions: 0,
  cases: realCaseIds.map((id) => ({
    id,
    status: "BLOCKED_EXTERNAL",
    reason: "AUTHORIZED_CURRENT_CASE_FILE_REQUIRED",
  })),
};
try {
  if (input) {
    if ((await stat(input)).mode & 0o077)
      throw Error("PRIVATE_FILE_PERMISSIONS_REQUIRED");
    const bytes = await readFile(input);
    evidence.inputFileSha256 =
      "sha256:" + createHash("sha256").update(bytes).digest("hex");
    const config = parseRealCaseFile(JSON.parse(bytes.toString("utf8")));
    const client = createWsgsHttpClient({
      baseUrl: config.wsgsBaseUrl,
      bearerToken: config.wsgsBearerToken,
      contractVersion: "sacs-wsgs-grounding/1.2",
      operationTimeoutMs: 1500,
    });
    const caps = await client.capabilities(AbortSignal.timeout(1500));
    evidence.negotiation =
      "sacs-wsgs-grounding/1.2; wsgs-world-analysis-findings/1.0";
    evidence.requiredCapabilitiesReady = caps.requiredCapabilitiesReady;
    evidence.cases = evidence.cases.map((row) =>
      config.cases.some((c) => c.id === row.id)
        ? {
            ...row,
            status: caps.requiredCapabilitiesReady
              ? "READY_FOR_EXECUTION"
              : "BLOCKED_EXTERNAL",
            reason: caps.requiredCapabilitiesReady
              ? "EXECUTED_CASE_EVIDENCE_STILL_REQUIRED"
              : "REQUIRED_CAPABILITY_UNAVAILABLE",
          }
        : row,
    );
    evidence.status = caps.requiredCapabilitiesReady
      ? "INPUTS_READY"
      : "BLOCKED_EXTERNAL";
  }
} catch (error) {
  evidence.status = "FAILED";
  evidence.errorType = error.name;
  evidence.reason = "PRIVATE_CONTEXT_OR_PUBLIC_NEGOTIATION_INVALID";
}
const folder =
  process.env.SACS_FUNCTIONAL_REAL_OUTPUT ?? ".tmp/v06-real-preflight";
await mkdir(folder, { recursive: true });
await writeFile(
  folder + "/PREFLIGHT.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
process.stdout.write(
  JSON.stringify({
    status: evidence.status,
    businessSubmissions: 0,
    cases: evidence.cases.map((c) => ({ id: c.id, status: c.status })),
  }) + "\n",
);
process.exitCode =
  evidence.status === "INPUTS_READY"
    ? 0
    : evidence.status === "BLOCKED_EXTERNAL"
      ? 2
      : 1;
