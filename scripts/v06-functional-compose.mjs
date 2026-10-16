import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// An isolated Compose verification. Endpoints/keys are generated fixtures;
// no developer .env, real model, WSGS, SDAR, or shared project is used.
const project = "sacs-functional-r02-" + randomBytes(6).toString("hex");
const image = "single-agent-chat-server:" + project;
const folder = await mkdtemp(join(tmpdir(), project + "-"));
const evidenceDir = join(
  "reports/v0.6/functional-closure/R02-compose",
  randomUUID(),
);
await mkdir(evidenceDir, { recursive: true });
const evidence = {
  mode: "ISOLATED_COMPOSE",
  project,
  cases: [],
  status: "RUNNING",
};
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(?:CHAT_|AG_UI_|OPENWEBUI_|SDAR_|WSGS_|SACS_|DATABASE_|POSTGRES_|CONVERSATION_|COMPOSE_)/u.test(
        key,
      ),
  ),
);
let stage = "fixtures";
let started = false;
let capabilityReady = true;
let correctProfile = true;
let capGet = 0;
let businessPosts = 0;
const publicCapabilities = JSON.parse(
  await readFile(
    "dependencies/wsgs-world-analysis-v1/public/examples/capabilities.json",
    "utf8",
  ),
);
const model = createServer(async (request, response) => {
  for await (const _part of request) {
    /* consume the bounded synthetic readiness prompt */
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
});
const wsgs = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/v1/capabilities") {
    businessPosts++;
    response.writeHead(405);
    response.end();
    return;
  }
  capGet++;
  response.writeHead(200, {
    "content-type": "application/json",
    "wsgs-contract-version": "sacs-wsgs-grounding/1.2",
    "wsgs-result-profile": correctProfile
      ? "wsgs-world-analysis-findings/1.0"
      : "wrong-profile",
  });
  response.end(
    JSON.stringify({
      ...publicCapabilities,
      requiredCapabilitiesReady: capabilityReady,
    }),
  );
});
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => resolve(server.address().port));
  });
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    env: environment,
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"],
  });
const override = join(folder, "override.json");
const compose = (args) =>
  docker([
    "compose",
    "--env-file",
    "/dev/null",
    "--project-name",
    project,
    "-f",
    "compose.yaml",
    "-f",
    override,
    ...args,
  ]);
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
const save = () =>
  writeFile(
    join(evidenceDir, "EVIDENCE.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
let serverUrl;
const probe = async (path) => {
  const response = await fetch(serverUrl + path, {
    signal: AbortSignal.timeout(3000),
  });
  return { httpStatus: response.status, body: await response.json() };
};
const waitFor = async (status, expectedSource) => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const result = await probe("/ready");
      if (
        result.httpStatus === status &&
        result.body.checks?.wsgsGrounding === expectedSource
      )
        return result;
    } catch {
      /* wait for this invocation's isolated database/process startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("ISOLATED_READY_DEADLINE");
};
const resolveServer = () => {
  const id = compose(["ps", "-q", "server"]).trim();
  assert.match(id, /^[a-f0-9]{12,64}$/u);
  const port = docker(["port", id, "3000/tcp"]).trim();
  const match = /^127\.0\.0\.1:(\d+)$/u.exec(port);
  assert.ok(match);
  serverUrl = "http://127.0.0.1:" + match[1];
  return id;
};
try {
  const modelPort = await listen(model);
  const wsgsPort = await listen(wsgs);
  Object.assign(environment, {
    CHAT_SERVER_IMAGE: image,
    CHAT_SERVER_PUBLISHED_PORT: "0",
    CHAT_SERVER_FRONTEND_NETWORK: project + "-frontend",
    CHAT_SERVER_SDAR_NETWORK: project + "-sdar",
    POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
    CHAT_SERVER_SERVICE_KEY: randomBytes(24).toString("hex"),
    AG_UI_SERVICE_KEY: randomBytes(24).toString("hex"),
    OPENWEBUI_USER_JWT_SECRET: randomBytes(24).toString("hex"),
    CONVERSATION_MODEL_BASE_URL:
      "http://host.docker.internal:" + modelPort + "/v1",
    CONVERSATION_MODEL_NAME: "isolated-readiness-fixture",
    WSGS_BASE_URL: "http://host.docker.internal:" + wsgsPort,
    WSGS_BEARER_TOKEN: randomBytes(24).toString("hex"),
    SACS_WSGS_ANALYSIS_ENABLED: "false",
    SACS_WSGS_ANALYSIS_MAX_ACTIVE_PUMPS: "19",
    SACS_WSGS_ANALYSIS_READINESS_CACHE_MS: "100",
    SACS_WSGS_ANALYSIS_READINESS_TIMEOUT_MS: "1000",
  });
  stage = "build";
  docker(["build", "--target", "runtime", "--tag", image, "."]);
  evidence.imageId = docker([
    "image",
    "inspect",
    image,
    "--format",
    "{{.Id}}",
  ]).trim();
  // Select the cached test PostgreSQL image by immutable ID; retain the pinned
  // root Compose default for real deployments and state the test override.
  evidence.postgresImageId = docker([
    "image",
    "inspect",
    "postgres:17-alpine",
    "--format",
    "{{.Id}}",
  ]).trim();
  await writeFile(
    override,
    JSON.stringify({
      services: { postgres: { image: evidence.postgresImageId } },
    }),
  );
  assert.equal(
    docker([
      "ps",
      "-aq",
      "--filter",
      "label=com.docker.compose.project=" + project,
    ]).trim(),
    "",
  );
  stage = "disabled-startup";
  started = true;
  compose(["up", "-d", "--no-build"]);
  const disabledId = resolveServer();
  await waitFor(200, "disabled");
  assert.equal(capGet, 0);
  assert.equal(businessPosts, 0);
  evidence.cases.push({
    name: "disabled",
    httpStatus: 200,
    wsgsGrounding: "disabled",
    capabilityGets: 0,
    businessPosts: 0,
  });
  const inspectEnvironment = (id) => {
    const actual = JSON.parse(docker(["inspect", id]))[0];
    const env = Object.fromEntries(
      actual.Config.Env.map((value) => [
        value.slice(0, value.indexOf("=")),
        value.slice(value.indexOf("=") + 1),
      ]),
    );
    for (const name of [
      "WSGS_BASE_URL",
      "WSGS_BEARER_TOKEN",
      "SACS_WSGS_ANALYSIS_ENABLED",
      "SACS_WSGS_ANALYSIS_MAX_ACTIVE_PUMPS",
      "SACS_WSGS_ANALYSIS_READINESS_TIMEOUT_MS",
      "SACS_WSGS_ANALYSIS_READINESS_CACHE_MS",
    ])
      assert.equal(env[name], environment[name]);
    assert.equal(actual.HostConfig.ReadonlyRootfs, true);
    evidence.forwardedSettingNames = Object.keys(env)
      .filter((name) => /^(WSGS_|SACS_WSGS_)/u.test(name))
      .sort();
  };
  inspectEnvironment(disabledId);
  stage = "enabled-startup";
  environment.SACS_WSGS_ANALYSIS_ENABLED = "true";
  compose([
    "up",
    "-d",
    "--no-build",
    "--no-deps",
    "--force-recreate",
    "server",
  ]);
  inspectEnvironment(resolveServer());
  await waitFor(200, "ready");
  evidence.cases.push({
    name: "enabled",
    httpStatus: 200,
    wsgsGrounding: "ready",
  });
  stage = "required-unavailable";
  capabilityReady = false;
  await waitFor(503, "unavailable");
  assert.equal((await probe("/health")).httpStatus, 200);
  evidence.cases.push({
    name: "required_unavailable",
    httpStatus: 503,
    healthStatus: 200,
  });
  stage = "negotiation-drift";
  capabilityReady = true;
  correctProfile = false;
  await waitFor(503, "unavailable");
  evidence.cases.push({ name: "negotiation_drift", httpStatus: 503 });
  stage = "recovery";
  correctProfile = true;
  await waitFor(200, "ready");
  evidence.cases.push({ name: "dependency_recovered", httpStatus: 200 });
  assert.equal(businessPosts, 0);
  evidence.capabilityGets = capGet;
  evidence.businessPosts = businessPosts;
  evidence.status = "PASS";
} catch (error) {
  evidence.status = "FAILED";
  evidence.failure = { stage, type: error.name };
  process.exitCode = 1;
} finally {
  try {
    if (started)
      compose(["down", "--timeout", "5", "--volumes", "--remove-orphans"]);
    evidence.cleanup = "PASS";
  } catch {
    evidence.cleanup = "FAILED";
    evidence.status = "FAILED";
    process.exitCode = 1;
  }
  await close(model);
  await close(wsgs);
  await rm(folder, { recursive: true, force: true });
  await save();
}
console.log(
  JSON.stringify({
    status: evidence.status,
    stage,
    evidence: join(evidenceDir, "EVIDENCE.json"),
    cleanup: evidence.cleanup,
  }),
);
