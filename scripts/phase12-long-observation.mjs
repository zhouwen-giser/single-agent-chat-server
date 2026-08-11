import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { writeRealGateEvidence } from "./real-gate-evidence.mjs";

import { HttpAgent } from "@ag-ui/client";
import { EventSchemas, EventType } from "@ag-ui/core";

import { createSdarA2aClient } from "../dist/packages/sdar-a2a-adapter/src/index.js";

const boundedBaseUrl = required("P12_LONG_SACS_URL");
const controlBaseUrl = required("P12_SACS_URL");
const sdarBaseUrl = required("P12_SDAR_A2A_BASE_URL");
const endpointOverride = process.env.P12_SDAR_A2A_ENDPOINT_OVERRIDE?.trim();
const serviceKey = required("P12_AG_UI_SERVICE_KEY");
const jwtSecret = required("P12_PRINCIPAL_JWT_SECRET");
const stamp = process.env.P12_RUN_STAMP ?? `p12-long-${Date.now()}`;
const threadId = `${stamp}-long-observation`;
const headers = {
  authorization: `Bearer ${serviceKey}`,
  "x-openwebui-user-jwt": signPrincipal(`p12-long-${stamp}`),
};

const created = await run(
  boundedBaseUrl,
  `${stamp}-create`,
  "Execute phase11 delay scenario",
);
const task = requiredTask(created);
const boundary = requiredObservationBoundary(created);

assert.equal(boundary.value?.taskContinues, true);

const client = await createSdarA2aClient({
  baseUrl: sdarBaseUrl,
  ...(endpointOverride ? { endpointOverride } : {}),
  discoveryTimeoutMs: 10_000,
  operationTimeoutMs: 30_000,
});
let recoveredTask;
for (let attempt = 0; attempt < 60; attempt += 1) {
  recoveredTask = await client.getTask(task.taskId, { historyLength: 100 });
  if (recoveredTask.state === "INPUT_REQUIRED") break;
  await delay(250);
}
assert.equal(recoveredTask?.taskId, task.taskId);
assert.equal(recoveredTask?.contextId, task.contextId);
assert.equal(recoveredTask?.state, "INPUT_REQUIRED");
assert.equal(recoveredTask?.internalPhase, "awaiting_plan_confirmation");

await run(controlBaseUrl, `${stamp}-cancel`, "cancel the task");
const canceledTask = await client.getTask(task.taskId);
assert.equal(canceledTask.state, "CANCELED");

const result = {
  status: "PASSED",
  officialClient: "@ag-ui/client@0.0.57",
  a2aSdk: "@a2a-js/sdk@1.0.0-beta.0",
  taskId: task.taskId,
  initialObservationEnded: true,
  taskContinuesAtBoundary: true,
  recoveredWithGetTaskPolling: true,
  recoveredState: recoveredTask.state,
  recoveredInternalPhase: recoveredTask.internalPhase,
  cleanupState: canceledTask.state,
  eventCursor: false,
  taskResubscription: false,
};
await writeRealGateEvidence(
  "P12_LONG_EVIDENCE_FILE",
  "long-observation",
  result,
);
process.stdout.write(`${JSON.stringify(result)}\n`);

async function run(baseUrl, runId, message) {
  const events = [];
  const agent = new HttpAgent({
    url: `${baseUrl}/ag-ui`,
    headers,
    threadId,
    initialMessages: [{ id: `${runId}:user`, role: "user", content: message }],
  });
  await agent.runAgent(
    { runId },
    { onEvent: ({ event }) => events.push(event) },
  );
  assert.ok(events.length > 0);
  for (const event of events) EventSchemas.parse(event);
  const runError = events.find((event) => event.type === EventType.RUN_ERROR);
  if (runError !== undefined) {
    throw new Error(`AG-UI run failed: ${runError.code} ${runError.message}`);
  }
  return events;
}

function requiredObservationBoundary(events) {
  const boundary = events.find(
    (event) =>
      event.type === EventType.CUSTOM &&
      event.name === "sdar.observation_ended",
  );
  assert.ok(boundary);
  assert.equal(
    events.some(
      (event) =>
        event.type === EventType.RUN_FINISHED &&
        event.outcome?.type === "success",
    ),
    true,
  );
  return boundary;
}

function requiredTask(events) {
  const task = events.find(
    (event) =>
      event.type === EventType.CUSTOM && event.name === "sdar.task.bound",
  )?.value;
  assert.ok(task?.taskId);
  assert.ok(task?.contextId);
  return task;
}

function signPrincipal(subject) {
  const now = Math.floor(Date.now() / 1_000);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "open-webui",
    sub: subject,
    role: "user",
    iat: now,
    exp: now + 600,
  })}`;
  const signature = createHmac("sha256", jwtSecret)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for P12 long observation`);
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
