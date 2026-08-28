import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const project =
  process.env.P13_COMPOSE_PROJECT_NAME ?? `sacs-p13-${process.pid}`;
if (!/^sacs-p13-[a-z0-9-]+$/u.test(project)) {
  throw new Error("P13_COMPOSE_PROJECT_NAME must use the sacs-p13- prefix");
}

const modelFixture = createModelReadinessFixture();
const modelFixturePort = await listen(modelFixture);

const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  CHAT_SERVER_IMAGE:
    process.env.CHAT_SERVER_IMAGE ?? "single-agent-chat-server:0.4.0",
  CHAT_SERVER_PUBLISHED_PORT: "0",
  CHAT_SERVER_FRONTEND_NETWORK: `${project}-frontend`,
  CHAT_SERVER_SDAR_NETWORK: `${project}-sdar`,
  CHAT_SERVER_SERVICE_KEY: credential("openai"),
  AG_UI_SERVICE_KEY: credential("agui"),
  OPENWEBUI_USER_JWT_SECRET: credential("principal"),
  POSTGRES_PASSWORD: credential("postgres"),
  CONVERSATION_MODEL_BASE_URL: `http://host.docker.internal:${modelFixturePort}/v1`,
  CONVERSATION_MODEL_NAME: "compose-readiness-fixture",
  CONVERSATION_MODEL_API_KEY: "",
  CONVERSATION_MODEL_MAX_OUTPUT_TOKENS: "2048",
};

let result;
try {
  dockerCompose(["up", "-d", "--no-build"]);
  const serverId = dockerCompose(["ps", "-q", "server"]).trim();
  assert.match(serverId, /^[a-f0-9]{12,64}$/u);

  let inspection;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    inspection = JSON.parse(docker(["inspect", serverId]))[0];
    if (inspection.State?.Health?.Status === "healthy") break;
    if (inspection.State?.Running === false) break;
    await delay(2_000);
  }
  if (inspection.State?.Health?.Status !== "healthy") {
    const logs = dockerCompose(
      ["logs", "--no-color", "--tail", "100", "server"],
      false,
    );
    throw new Error(
      `compose server health=${String(inspection.State?.Health?.Status)} running=${String(inspection.State?.Running)}\n${logs}`,
    );
  }
  assert.equal(inspection.Config?.User, "node");
  assert.equal(inspection.HostConfig?.ReadonlyRootfs, true);
  assert.ok(inspection.HostConfig?.CapDrop?.includes("ALL"));
  assert.ok(
    inspection.HostConfig?.SecurityOpt?.includes("no-new-privileges:true"),
  );

  const published = dockerCompose(["port", "server", "3000"]).trim();
  const match = /:(\d+)$/u.exec(published);
  assert.ok(match);
  const ready = await fetch(`http://127.0.0.1:${match[1]}/ready`, {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(ready.status, 200);

  const tableCount = Number(
    dockerCompose([
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "single_agent_chat",
      "-d",
      "single_agent_chat",
      "-At",
      "-c",
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'chat_service';",
    ]).trim(),
  );
  assert.ok(tableCount > 0);
  result = {
    status: "PASSED",
    project,
    health: "healthy",
    readyHttp: ready.status,
    user: inspection.Config.User,
    readOnlyRoot: true,
    capDropAll: true,
    noNewPrivileges: true,
    migratedTables: tableCount,
  };
} finally {
  dockerCompose(["down", "--volumes", "--remove-orphans"], false);
  await close(modelFixture);
}

for (const [kind, args] of [
  [
    "containers",
    ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`],
  ],
  [
    "volumes",
    [
      "volume",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${project}`,
    ],
  ],
  [
    "networks",
    [
      "network",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${project}`,
    ],
  ],
]) {
  assert.equal(docker(args).trim(), "", `${kind} cleanup`);
}

process.stdout.write(`${JSON.stringify({ ...result, cleanup: "PASSED" })}\n`);

function dockerCompose(args, required = true) {
  return run(["compose", "-p", project, ...args], required);
}

function docker(args, required = true) {
  return run(args, required);
}

function run(args, required) {
  const child = spawnSync("docker", args, {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
    shell: false,
  });
  if (required && child.status !== 0) {
    throw new Error(
      `docker ${args.join(" ")} failed: ${child.stderr || child.error?.message}`,
    );
  }
  return required
    ? (child.stdout ?? "")
    : `${child.stdout ?? ""}${child.stderr ?? ""}`;
}

function credential(purpose) {
  return createHash("sha256").update(`${project}:${purpose}`).digest("hex");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createModelReadinessFixture() {
  return createServer((request, response) => {
    request.resume();
    response.setHeader("content-type", "application/json");
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    response.end(
      JSON.stringify({
        id: "compose-readiness",
        choices: [{ message: { role: "assistant", content: "OK" } }],
      }),
    );
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Compose model fixture has no TCP address"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
