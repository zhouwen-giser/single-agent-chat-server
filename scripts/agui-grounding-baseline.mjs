import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

// Read-only baseline gates: never promote the historical v0.5/v0.6 ledgers.
const phase = process.argv[2] ?? "S00";
if (!/^S0[0-7]$/u.test(phase))
  throw Error("Unknown Grounding presentation phase");
const sourceStatus = () =>
  execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--",
      "apps",
      "packages",
      "src",
      "tests",
      "scripts",
      "contracts",
      "package.json",
      "pnpm-lock.yaml",
    ],
    { encoding: "utf8" },
  ).trim();
if (sourceStatus() !== "")
  throw Error("Commit source and tests before recording phase evidence");
const scripts = [
  "typecheck",
  "test:v06:frozen-wsgs",
  "test:v06:postgres",
  "test:v06:local-e2e",
  "verify:migrations",
  "verify:architecture",
  "lint",
  "build",
];
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const commands = [];
const env = {
  ...process.env,
  NODE_ENV: "test",
  DOTENV_CONFIG_PATH: "/dev/null",
};
for (const key of Object.keys(env)) {
  if (/WSGS|GOWM|SDAR|DATABASE_URL|API_KEY|AUTH_TOKEN|JWT_SECRET/u.test(key))
    delete env[key];
}
for (const script of scripts) {
  const startedAt = new Date().toISOString();
  const outputHash = createHash("sha256");
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn("pnpm", [script], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        outputHash.update(chunk);
        process.stdout.write(chunk);
      });
    }
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  commands.push({
    command: `pnpm ${script}`,
    sourceSha,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    outputSha256: outputHash.digest("hex"),
  });
  if (exitCode !== 0) break;
}
const sourceUnchanged =
  sourceStatus() === "" &&
  sourceSha ===
    execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
const passed =
  sourceUnchanged &&
  commands.length === scripts.length &&
  commands.every((c) => c.exitCode === 0);
const directory = "reports/v0.6/agui-v03-grounding-presentation/receipts";
await mkdir(directory, { recursive: true });
const path = `${directory}/${phase}-${randomUUID()}.json`;
await writeFile(
  path,
  JSON.stringify(
    {
      kind:
        phase === "S00"
          ? "pre-change-development-baseline"
          : "phase-development-regression",
      phase,
      sourceSha,
      sourceUnchanged,
      postgresImage: env.SACS_V05_POSTGRES_IMAGE ?? "postgres:17-alpine",
      requiredCommands: scripts.map((script) => `pnpm ${script}`),
      status: passed ? "PASS" : "FAILED",
      commands,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
process.stdout.write(`${path}\n`);
if (!passed) process.exitCode = 1;
