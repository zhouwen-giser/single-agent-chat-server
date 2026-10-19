import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
const exec = promisify(execFile);
const name = "sacs-r05-postgres-" + randomBytes(8).toString("hex");
const user = "sacs_process_test",
  password = randomBytes(24).toString("hex");
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(?:CHAT_|AG_UI_|OPENWEBUI_|SDAR_|WSGS_|SACS_|DATABASE_|POSTGRES_|CONVERSATION_|TEST_DATABASE_URL)/u.test(
        key,
      ),
  ),
);
Object.assign(environment, {
  NODE_ENV: "test",
  DOTENV_CONFIG_PATH: "/dev/null",
  DOTENV_CONFIG_QUIET: "true",
});
let started = false;
const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const binding = socket.address();
if (!binding || typeof binding === "string")
  throw Error("ISOLATED_POSTGRES_PORT_MISSING");
const stablePort = binding.port;
await new Promise((resolve) => socket.close(resolve));
try {
  const image = (
    await exec("docker", [
      "image",
      "inspect",
      "postgres:17-alpine",
      "--format",
      "{{.Id}}",
    ])
  ).stdout.trim();
  await exec("docker", [
    "run",
    "--detach",
    "--name",
    name,
    "--env",
    "POSTGRES_USER=" + user,
    "--env",
    "POSTGRES_PASSWORD=" + password,
    "--env",
    "POSTGRES_DB=sacs_process_admin",
    "--publish",
    "127.0.0.1:" + stablePort + ":5432",
    image,
  ]);
  started = true;
  const port = /127\.0\.0\.1:(\d+)/u.exec(
    (await exec("docker", ["port", name, "5432/tcp"])).stdout,
  )?.[1];
  if (!port) throw Error("ISOLATED_POSTGRES_PORT_MISSING");
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      await exec("docker", [
        "exec",
        name,
        "pg_isready",
        "-U",
        user,
        "-d",
        "sacs_process_admin",
      ]);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  Object.assign(environment, {
    TEST_DATABASE_URL: `postgresql://${user}:${password}@127.0.0.1:${port}/sacs_process_admin`,
    SACS_TEST_POSTGRES_CONTAINER: name,
    SACS_PROCESS_EVIDENCE_DIR:
      process.env.SACS_PROCESS_EVIDENCE_DIR ?? ".tmp/v06-process",
  });
  process.stdout.write(
    JSON.stringify({
      event: "process.postgres.ready",
      container: name,
      imageId: image,
    }) + "\n",
  );
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-vm-modules",
        "node_modules/jest/bin/jest.js",
        "--runInBand",
        process.argv.includes("--checkpoint")
          ? "tests/v06-checkpoint-recovery.postgres.int.test.ts"
          : "tests/v06-source-process.postgres.int.test.ts",
      ],
      { env: environment, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (status, signal) => resolve(signal ? 1 : (status ?? 1)));
  });
  process.exitCode = code;
} finally {
  if (started) {
    await exec("docker", ["rm", "--force", "--volumes", name]);
    process.stdout.write(
      JSON.stringify({
        event: "process.postgres.cleanup",
        container: name,
        status: "PASS",
      }) + "\n",
    );
  }
}
