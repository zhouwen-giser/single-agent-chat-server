import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const testFiles = process.argv.slice(2);
if (testFiles.length === 0) {
  throw new Error("At least one PostgreSQL-backed Jest test file is required");
}

let containerName;
let stopping = false;
const stopContainer = async () => {
  if (containerName === undefined || stopping) return;
  stopping = true;
  await execFileAsync("docker", ["stop", "--time", "5", containerName], {
    timeout: 15_000,
  }).catch(() => undefined);
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stopContainer().finally(() => {
      process.kill(process.pid, signal);
    });
  });
}

try {
  let databaseUrl = process.env.TEST_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    const suffix = randomBytes(8).toString("hex");
    containerName = `sacs-v05-postgres-${suffix}`;
    const user = "sacs_v05_test";
    const password = randomBytes(24).toString("base64url");
    const image = process.env.SACS_V05_POSTGRES_IMAGE ?? "postgres:17-alpine";
    await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "--detach",
        "--name",
        containerName,
        "--env",
        `POSTGRES_USER=${user}`,
        "--env",
        `POSTGRES_PASSWORD=${password}`,
        "--env",
        "POSTGRES_DB=postgres",
        "--publish",
        "127.0.0.1::5432",
        image,
      ],
      { timeout: 30_000 },
    );
    const { stdout } = await execFileAsync(
      "docker",
      ["port", containerName, "5432/tcp"],
      { timeout: 10_000 },
    );
    const port = parsePublishedPort(stdout);
    databaseUrl = `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`;
    await waitForPostgres(containerName, user);
    process.stdout.write(
      `${JSON.stringify({ event: "v05.postgres.ready", source: "ephemeral-container", image })}\n`,
    );
  } else {
    process.stdout.write(
      `${JSON.stringify({ event: "v05.postgres.ready", source: "TEST_DATABASE_URL" })}\n`,
    );
  }

  const status = await runJest(testFiles, databaseUrl);
  if (status !== 0) process.exitCode = status;
} finally {
  await stopContainer();
}

function parsePublishedPort(output) {
  const line = output
    .trim()
    .split(/\r?\n/u)
    .find((candidate) => /^127\.0\.0\.1:\d+$/u.test(candidate.trim()));
  const match = line === undefined ? undefined : /:(\d+)$/u.exec(line.trim());
  if (match?.[1] === undefined) {
    throw new Error("Could not resolve the ephemeral PostgreSQL host port");
  }
  return Number(match[1]);
}

async function waitForPostgres(name, user) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await execFileAsync(
        "docker",
        [
          "exec",
          name,
          "pg_isready",
          "--username",
          user,
          "--dbname",
          "postgres",
        ],
        { timeout: 5_000 },
      );
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(
    "Ephemeral PostgreSQL did not become ready within 30 seconds",
  );
}

function runJest(files, databaseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-vm-modules",
        "node_modules/jest/bin/jest.js",
        "--runInBand",
        ...files,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Jest terminated by ${signal}`));
      } else {
        resolve(code ?? 1);
      }
    });
  });
}
