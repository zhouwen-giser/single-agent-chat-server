import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2] ?? "");
const task = resolve(process.argv[3] ?? "");
const reports = "reports/v0.6/frozen-wsgs-consumer";
if (!process.argv[2] || !process.argv[3])
  throw Error("Provide the extracted authoritative handoff and task roots.");
if (existsSync("dependencies/wsgs-world-analysis-v1/public"))
  throw Error(
    "Frozen public import already exists; verify it instead of overwriting.",
  );
const { verifyHandoff } = await import(
  pathToFileURL(resolve(root, "verify.mjs")).href
);
const verified = await verifyHandoff(root);
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json")));
mkdirSync(reports, { recursive: true });
cpSync(resolve(root, "public"), "dependencies/wsgs-world-analysis-v1/public", {
  recursive: true,
  errorOnExist: true,
  force: false,
});
cpSync(task, "config/v0.6/frozen-consumer-task", {
  recursive: true,
  errorOnExist: true,
  force: false,
});
const publicFiles = Object.fromEntries(
  Object.entries(manifest.files).filter(([path]) => path.startsWith("public/")),
);
const hash = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
for (const [path, expected] of Object.entries(publicFiles))
  if (
    hash(readFileSync("dependencies/wsgs-world-analysis-v1/" + path)) !==
    expected
  )
    throw Error("Imported public byte mismatch: " + path);
const write = (name, value) =>
  writeFileSync(`${reports}/${name}`, JSON.stringify(value, null, 2) + "\n");
write("handoff-verification.json", verified);
write("SOURCE_IMPORT.json", {
  taskId: "SACS-V06-FROZEN-WSGS-CONSUMER",
  capturedAt: new Date().toISOString(),
  sacsBaseline: "7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2",
  wsgsRepository: "zhouwen-giser/world-semantic-grounding-service",
  handoffCommit: "75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5",
  freezeCommit: "e05e6d4d5ac8de617857edc8e81b935e5efc7daf",
  contractVersion: manifest.contractVersion,
  resultProfile: manifest.resultProfile,
  releaseLockHash: hash(
    readFileSync(resolve(root, "public/contract-release-lock.json")),
  ),
  publicFiles,
});
if (!existsSync(`${reports}/ACCEPTANCE_LEDGER.json`))
  cpSync(
    resolve(task, "acceptance/ledger.template.json"),
    `${reports}/ACCEPTANCE_LEDGER.json`,
    { errorOnExist: true, force: false },
  );
console.log(
  JSON.stringify({
    status: "PASS",
    scope: verified.scope,
    importedPublicFiles: Object.keys(publicFiles).length,
    positiveExamples: verified.positiveExamples,
    negativeExamples: verified.negativeExamples,
  }),
);
