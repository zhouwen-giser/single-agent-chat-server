import { spawn } from "node:child_process";

const shared = process.env;
const evidenceDirectory = shared.P13_REAL_EVIDENCE_DIR?.trim();
const steps = [
  [
    "source-lock",
    "scripts/phase12-source-lock.mjs",
    evidenceDirectory
      ? {
          P12_SOURCE_LOCK_EVIDENCE_FILE: `${evidenceDirectory}/source-lock.json`,
        }
      : {},
  ],
  [
    "openwebui",
    "scripts/phase12-current-sdar-e2e.mjs",
    evidenceDirectory
      ? { P12_OPENWEBUI_EVIDENCE_FILE: `${evidenceDirectory}/openwebui.json` }
      : {},
  ],
  [
    "official-ag-ui",
    "scripts/phase11-official-client-e2e.mjs",
    {
      P11_SACS_URL: shared.P12_SACS_URL,
      P11_AG_UI_SERVICE_KEY: shared.P12_AG_UI_SERVICE_KEY,
      P11_PRINCIPAL_JWT_SECRET: shared.P12_PRINCIPAL_JWT_SECRET,
      P11_DATABASE_URL: shared.P12_DATABASE_URL,
      P11_RUN_STAMP: `${shared.P12_RUN_STAMP ?? `p12-${Date.now()}`}-official`,
      ...(evidenceDirectory
        ? {
            P11_OFFICIAL_AGUI_EVIDENCE_FILE: `${evidenceDirectory}/official-ag-ui.json`,
          }
        : {}),
    },
  ],
];

for (const [index, [name, script, overrides]] of steps.entries()) {
  process.stdout.write(`P12 real gate: ${name}\n`);
  await run(script, overrides);
  if (index < steps.length - 1) await delay(5_000);
}
process.stdout.write(
  "P12 current-SDAR northbound matrix passed with zero skips.\n",
);

function run(script, overrides) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: compactEnvironment({ ...process.env, ...overrides }),
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`${script} failed with code ${code} signal ${signal}`),
        );
    });
  });
}

function compactEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined),
  );
}
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
