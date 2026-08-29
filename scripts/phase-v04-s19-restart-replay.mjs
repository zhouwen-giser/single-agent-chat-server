import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import pg from "pg";

import {
  hashWorldExplanation,
  parseWorldExplanationV1,
} from "../dist/packages/world-explanation-contract/src/index.js";
import {
  runMigrations,
  WorldExplanationRepository,
} from "../dist/packages/persistence/src/index.js";

const { Pool } = pg;
const EXPECTED_CONTAINER_NAME = "sacs-v04-geospatial-s19-restart";
const EXPECTED_IMAGE_REFERENCE = "postgres:16-alpine";
const POSTGRES_CONTAINER_PORT = "5432/tcp";
const databaseUrl = required("TEST_DATABASE_URL");
const container = required("S19_POSTGRES_CONTAINER");
const databaseEndpoint = parseDatabaseEndpoint(databaseUrl);
const databaseName = databaseEndpoint.databaseName;
assert.equal(
  databaseName,
  "sacs_v04_geospatial_s19_restart",
  "S19 restart gate is restricted to its isolated database",
);
assert.equal(
  container,
  EXPECTED_CONTAINER_NAME,
  "S19 restart gate is restricted to the exact dedicated container",
);
const initialContainerRuntime = inspectIsolatedContainer(
  container,
  databaseEndpoint.port,
);

const reportPath = resolve(
  process.cwd(),
  process.env.S19_RESTART_REPORT_PATH ??
    "reports/v0.4/geospatial/S19-restart-replay.json",
);
const suffix = randomUUID().replaceAll("-", "");
const principalId = `s19-principal-${suffix}`;
const threadId = `s19-thread-${suffix}`;
const interactionRequestId = `s19-request-${suffix}`;
const executionId = `s19-execution-${suffix}`;
const wsgsGroundingId = `s19-wsgs-grounding-${suffix}`;
const resultHash = sha("a");
const contractHash = sha("b");
const rendererPolicyHash = sha("c");
const identity = {
  principalId,
  threadId,
  groundingResultHash: resultHash,
  locale: "zh-CN",
  contractHash,
  rendererPolicyHash,
};
let pool = new Pool({ connectionString: databaseUrl, max: 4 });

try {
  const migrations = await runMigrations(pool);
  assert.equal(migrations.at(-1)?.version, "0013_world_explanation.sql");
  await seedAuthorizedGrounding(pool);
  const repository = new WorldExplanationRepository(pool);
  const explanation = explanationFixture();
  const saved = await repository.saveOrReplay({
    ...identity,
    explanation,
    findingLinks: [],
  });
  assert.equal(saved.created, true);
  const before = await repository.findExact(identity);
  assert.ok(before);
  assert.deepEqual(before.explanation, explanation);
  const durableJsonHash = digest(JSON.stringify(before.explanation));

  await pool.end();
  pool = undefined;
  const preRestartRuntime = inspectIsolatedContainer(
    container,
    databaseEndpoint.port,
  );
  assert.equal(
    preRestartRuntime.id,
    initialContainerRuntime.id,
    "Dedicated container identity changed before restart",
  );
  assert.equal(
    preRestartRuntime.imageId,
    initialContainerRuntime.imageId,
    "Dedicated container image changed before restart",
  );
  restartIsolatedContainer(preRestartRuntime.id);
  const recoveredContainerRuntime = inspectIsolatedContainer(
    container,
    databaseEndpoint.port,
  );
  assert.equal(
    recoveredContainerRuntime.id,
    preRestartRuntime.id,
    "Dedicated container identity changed during restart",
  );
  assert.equal(
    recoveredContainerRuntime.imageId,
    preRestartRuntime.imageId,
    "Dedicated container image changed during restart",
  );
  await waitForPostgres();

  pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const recovered = await new WorldExplanationRepository(pool).findExact(
    identity,
  );
  assert.ok(recovered);
  assert.deepEqual(recovered.explanation, explanation);
  assert.equal(recovered.explanationHash, explanation.explanationHash);
  assert.equal(digest(JSON.stringify(recovered.explanation)), durableJsonHash);

  const report = {
    schemaVersion: "sacs-geospatial-s19-restart-replay/1.0",
    status: "PASS",
    databaseName,
    containerIdentityHash: digest(recoveredContainerRuntime.id),
    containerImageHash: recoveredContainerRuntime.imageId,
    latestMigration: 13,
    databaseRestartPerformed: true,
    exactReplayRecovered: true,
    explanationHash: explanation.explanationHash,
    groundingResultHash: resultHash,
    durableJsonHash,
    credentialsPrintedOrPersisted: false,
    sharedServicesModified: false,
    completedAt: new Date().toISOString(),
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify(report, undefined, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    `SACS_GEOSPATIAL_EXPLANATION_RESTART_REPLAY_PASS ${explanation.explanationHash}\n`,
  );
} finally {
  if (pool !== undefined) await pool.end().catch(() => undefined);
}

async function seedAuthorizedGrounding(databasePool) {
  await databasePool.query(
    "INSERT INTO chat_service.principal(principal_id, issuer, subject, role) VALUES ($1, 's19-restart', $1, 'user')",
    [principalId],
  );
  await databasePool.query(
    "INSERT INTO chat_service.conversation_thread(thread_id, principal_id) VALUES ($1, $2)",
    [threadId, principalId],
  );
  await databasePool.query(
    `
      INSERT INTO chat_service.interaction_request(
        request_id, protocol, external_request_id, principal_id, thread_id,
        request_hash, status, lease_owner, lease_until
      ) VALUES (
        $1, 'openai', $1, $2, $3, $4, 'CLAIMED', 's19-restart',
        now() + interval '1 hour'
      )
    `,
    [interactionRequestId, principalId, threadId, "9".repeat(64)],
  );
  await databasePool.query(
    `
      INSERT INTO chat_service.grounding_execution(
        grounding_id, principal_id, thread_id, interaction_request_id,
        wsgs_request_id, idempotency_key, request_hash, wsgs_operation,
        requested_products_json, context_usage_json, state,
        wsgs_grounding_id, grounding_result_hash, grounding_result_json
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'EXECUTE_WORLD_QUERY',
        '["WORLD_EVIDENCE"]'::jsonb, '{}'::jsonb, 'GROUNDING_READY',
        $8, $9, '{"status":"COMPLETED"}'::jsonb
      )
    `,
    [
      executionId,
      principalId,
      threadId,
      interactionRequestId,
      `s19-wsgs-request-${suffix}`,
      `s19-idempotency-${suffix}`,
      "8".repeat(64),
      wsgsGroundingId,
      resultHash,
    ],
  );
}

function explanationFixture() {
  const draft = {
    schemaVersion: "sacs-world-explanation/1.0",
    explanationId: `s19-explanation-${suffix}`,
    explanationHash: sha("0"),
    locale: "zh-CN",
    grounding: {
      groundingId: wsgsGroundingId,
      resultHash,
      status: "COMPLETED",
    },
    explanationStatus: "COMPLETE",
    questionKind: "FEATURES_NEARBY",
    renderedText: "隔离重启后应精确回放同一解释。",
    findings: [
      {
        findingId: "finding-restart-1",
        findingKind: "SPATIAL_FEATURE_COLLECTION",
        semanticConcept: "restart_replay",
        headline: "持久化解释",
        details: [],
        returnedCount: 0,
        truncated: false,
        evidenceItemIds: ["evidence-restart-1"],
        sourceProductIds: [],
      },
    ],
    references: [],
    sourceProducts: [],
    gaps: [],
    provenance: {
      evidenceItemIds: ["evidence-restart-1"],
      receiptIds: [],
      operationKeys: ["restart-replay.test@1.0"],
      consumerLockHash: sha("d"),
      findingProfileHash: sha("e"),
      rendererPolicyHash,
    },
    createdAt: "2026-08-29T12:00:00.000Z",
  };
  return parseWorldExplanationV1({
    ...draft,
    explanationHash: hashWorldExplanation(draft),
  });
}

function restartIsolatedContainer(containerId) {
  const output = docker(["restart", containerId], 60_000);
  if (output !== containerId) {
    throw new Error("Unable to restart the isolated S19 PostgreSQL container");
  }
}

function inspectIsolatedContainer(containerName, expectedHostPort) {
  const output = docker([
    "inspect",
    "--type",
    "container",
    "--format",
    [
      "{{json .Id}}",
      "{{json .Name}}",
      "{{json .Config.Image}}",
      "{{json .Image}}",
      "{{json .State.Running}}",
      "{{json .HostConfig.PortBindings}}",
      "{{json .NetworkSettings.Ports}}",
    ].join("\n"),
    containerName,
  ]);
  const lines = output.split(/\r?\n/u);
  if (lines.length !== 7) {
    throw new Error("Unexpected dedicated container inspection result");
  }
  let id;
  let name;
  let configuredImage;
  let imageId;
  let running;
  let configuredPortBindings;
  let activePorts;
  try {
    [
      id,
      name,
      configuredImage,
      imageId,
      running,
      configuredPortBindings,
      activePorts,
    ] = lines.map((line) => JSON.parse(line));
  } catch {
    throw new Error("Unable to parse dedicated container inspection result");
  }
  assert.match(id, /^[a-f0-9]{64}$/u, "Invalid dedicated container ID");
  assert.equal(
    name,
    `/${EXPECTED_CONTAINER_NAME}`,
    "Docker resolved a different container name",
  );
  assert.equal(
    configuredImage,
    EXPECTED_IMAGE_REFERENCE,
    "Dedicated container uses an unexpected image reference",
  );
  assert.match(
    imageId,
    /^sha256:[a-f0-9]{64}$/u,
    "Invalid dedicated container image ID",
  );
  assert.equal(running, true, "Dedicated container is not running");
  const expectedImageId = docker([
    "image",
    "inspect",
    "--format",
    "{{json .Id}}",
    EXPECTED_IMAGE_REFERENCE,
  ]);
  let parsedExpectedImageId;
  try {
    parsedExpectedImageId = JSON.parse(expectedImageId);
  } catch {
    throw new Error("Unable to parse expected PostgreSQL image identity");
  }
  assert.equal(
    imageId,
    parsedExpectedImageId,
    "Dedicated container does not use the expected local image identity",
  );
  assertExactLoopbackBinding(configuredPortBindings, expectedHostPort);
  assertExactLoopbackBinding(activePorts, expectedHostPort);
  return { id, imageId };
}

function assertExactLoopbackBinding(bindings, expectedHostPort) {
  assert.ok(
    bindings !== null &&
      typeof bindings === "object" &&
      !Array.isArray(bindings),
    "Dedicated container port bindings are unavailable",
  );
  const publishedPorts = Object.entries(bindings).filter(
    ([, value]) => value !== null,
  );
  assert.equal(
    publishedPorts.length,
    1,
    "Dedicated container must publish exactly one port",
  );
  assert.equal(
    publishedPorts[0]?.[0],
    POSTGRES_CONTAINER_PORT,
    "Dedicated container publishes an unexpected container port",
  );
  const binding = publishedPorts[0]?.[1];
  assert.ok(
    Array.isArray(binding) && binding.length === 1,
    "Dedicated PostgreSQL port must have one published binding",
  );
  assert.ok(
    binding[0] !== null &&
      typeof binding[0] === "object" &&
      !Array.isArray(binding[0]),
    "Dedicated PostgreSQL binding is malformed",
  );
  assert.ok(
    isLoopbackHost(binding[0].HostIp),
    "Dedicated PostgreSQL port is not bound to loopback",
  );
  assert.equal(
    binding[0].HostPort,
    expectedHostPort,
    "Dedicated PostgreSQL published port does not match TEST_DATABASE_URL",
  );
}

function parseDatabaseEndpoint(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL");
  }
  assert.ok(
    parsed.protocol === "postgres:" || parsed.protocol === "postgresql:",
    "TEST_DATABASE_URL must use PostgreSQL",
  );
  assert.ok(
    isLoopbackHost(parsed.hostname),
    "S19 restart gate requires a loopback database host",
  );
  assert.match(
    parsed.port,
    /^(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/u,
    "S19 restart gate requires an explicit valid published port",
  );
  const databaseName = parsed.pathname.slice(1);
  assert.ok(
    !databaseName.includes("/"),
    "TEST_DATABASE_URL must identify exactly one database",
  );
  return { databaseName, port: parsed.port };
}

function isLoopbackHost(value) {
  const normalized = String(value)
    .toLowerCase()
    .replace(/^\[|\]$/gu, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function docker(args, timeout = 30_000) {
  const result = spawnSync("docker", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    timeout,
  });
  if (
    result.status !== 0 ||
    result.error !== undefined ||
    result.signal !== null
  ) {
    throw new Error("Docker command failed for the dedicated S19 container");
  }
  return result.stdout.trim();
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const candidate = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await candidate.query("SELECT 1");
      await candidate.end();
      return;
    } catch {
      await candidate.end().catch(() => undefined);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
  }
  throw new Error("PostgreSQL did not recover after the isolated S19 restart");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
