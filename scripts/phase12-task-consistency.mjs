import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { HttpAgent } from "@ag-ui/client";
import { EventSchemas, EventType } from "@ag-ui/core";

import { AgUiEventProjection } from "../dist/packages/ag-ui-interaction-adapter/src/index.js";
import { InteractionEventFactory } from "../dist/packages/interaction-contract/src/index.js";
import { A2aInteractionMapper } from "../dist/packages/interaction-runtime/src/index.js";
import { renderInteractionEventForOpenAi } from "../dist/packages/openai-interaction-adapter/src/index.js";
import { createSdarA2aClient } from "../dist/packages/sdar-a2a-adapter/src/index.js";

const sacsBaseUrl = process.env.P12_SACS_URL ?? "http://127.0.0.1:3000";
const agUiServiceKey = required("P12_AG_UI_SERVICE_KEY");
const jwtSecret = required("P12_PRINCIPAL_JWT_SECRET");
const sdarBaseUrl = required("P12_SDAR_A2A_BASE_URL");
const endpointOverride = process.env.P12_SDAR_A2A_ENDPOINT_OVERRIDE?.trim();
const stamp = process.env.P12_RUN_STAMP ?? `p12-consistency-${Date.now()}`;
const threadId = `${stamp}-same-task`;
const subject = `p12-official-${stamp}`;
const headers = {
  authorization: `Bearer ${agUiServiceKey}`,
  "x-openwebui-user-jwt": signPrincipal(subject),
};

const initial = await officialRun({
  runId: `${stamp}-create`,
  message: "Execute P12 same Task consistency scenario",
});
assertOfficialEvents(initial);
const taskIdentity = requiredTaskIdentity(initial);
const interrupt = requiredInterrupt(initial);
assert.equal(interrupt.reason, "sdar.plan_confirmation");

const resumed = await officialRun({
  runId: `${stamp}-confirm`,
  resume: [
    {
      interruptId: interrupt.id,
      status: "resolved",
      payload: { action: "confirm_plan" },
    },
  ],
});
assertOfficialEvents(resumed);
assertNoRunError(resumed);

let terminalEvents;
for (let attempt = 0; attempt < 40; attempt += 1) {
  terminalEvents = await officialRun({
    runId: `${stamp}-status-${attempt}`,
    message: "task status",
  });
  assertOfficialEvents(terminalEvents);
  assertNoRunError(terminalEvents);
  const identity = optionalTaskIdentity(terminalEvents);
  if (identity !== undefined)
    assert.equal(identity.taskId, taskIdentity.taskId);
  if (
    (latestTaskState(terminalEvents) ?? publishedTaskState(terminalEvents)) ===
    "COMPLETED"
  ) {
    break;
  }
  await delay(250);
}
assert.equal(
  latestTaskState(terminalEvents) ?? publishedTaskState(terminalEvents),
  "COMPLETED",
);

const client = await createSdarA2aClient({
  baseUrl: sdarBaseUrl,
  ...(endpointOverride ? { endpointOverride } : {}),
  discoveryTimeoutMs: 10_000,
  operationTimeoutMs: 30_000,
});
const normalizedTask = await client.getTask(taskIdentity.taskId, {
  historyLength: 100,
});
assert.equal(normalizedTask.taskId, taskIdentity.taskId);
assert.equal(normalizedTask.contextId, taskIdentity.contextId);
assert.equal(normalizedTask.state, "COMPLETED");
assert.ok((normalizedTask.history?.length ?? 0) > 0);
assert.ok(normalizedTask.artifacts.length > 0);

const factory = new InteractionEventFactory({
  runId: `${stamp}-projection`,
  threadId,
});
const mapper = new A2aInteractionMapper(factory);
const interactionEvents = [
  ...mapper.mapTask(normalizedTask),
  ...mapper.mapTask(normalizedTask),
];
const projection = new AgUiEventProjection();
const agUiEvents = interactionEvents.flatMap((event) =>
  projection.project(event),
);
for (const event of agUiEvents) EventSchemas.parse(event);
const openAiText = interactionEvents
  .map((event) => renderInteractionEventForOpenAi(event))
  .filter(Boolean)
  .join("\n");

const stateSnapshot = agUiEvents.find(
  (event) => event.type === EventType.STATE_SNAPSHOT,
);
const stateDelta = [...agUiEvents]
  .reverse()
  .find((event) => event.type === EventType.STATE_DELTA);
assert.equal(stateSnapshot?.snapshot?.task?.taskId, normalizedTask.taskId);
assert.equal(stateSnapshot?.snapshot?.task?.state, normalizedTask.state);
const taskDelta = stateDelta?.delta?.find(
  (operation) => operation.path === "/task",
);
assert.equal(taskDelta?.value?.taskId, normalizedTask.taskId);
assert.equal(taskDelta?.value?.state, normalizedTask.state);
assert.equal(
  interactionEvents
    .filter((event) => event.taskId !== undefined)
    .every((event) => event.taskId === normalizedTask.taskId),
  true,
);
assert.match(openAiText, /COMPLETED/u);
assert.equal(
  agUiEvents.some((event) => event.type === EventType.RAW),
  false,
);
assert.equal(
  agUiEvents.some((event) => String(event.type).startsWith("TOOL_CALL")),
  false,
);

process.stdout.write(
  `${JSON.stringify({
    status: "PASSED",
    officialClient: "@ag-ui/client@0.0.57",
    a2aSdk: "@a2a-js/sdk@1.0.0-beta.0",
    taskId: normalizedTask.taskId,
    contextId: normalizedTask.contextId,
    normalizedState: normalizedTask.state,
    historyMessages: normalizedTask.history?.length ?? 0,
    artifacts: normalizedTask.artifacts.length,
    openAiInterpretation: "PASSED_SAME_INTERACTION_EVENTS",
    agUiPublicState: "PASSED_SAME_INTERACTION_EVENTS",
    normalizedA2aSource: "PASSED_AUTHORIZED_GET_TASK",
    rawEvents: false,
    toolCalls: false,
  })}\n`,
);

async function officialRun({ runId, message, resume }) {
  const events = [];
  const agent = new HttpAgent({
    url: `${sacsBaseUrl}/ag-ui`,
    headers,
    threadId,
    initialMessages:
      message === undefined
        ? []
        : [
            {
              id: `${threadId}:${Buffer.from(message).toString("base64url")}`,
              role: "user",
              content: message,
            },
          ],
  });
  await agent.runAgent(
    { runId, ...(resume === undefined ? {} : { resume }) },
    { onEvent: ({ event }) => events.push(event) },
  );
  return events;
}

function assertOfficialEvents(events) {
  assert.ok(events.length > 0);
  for (const event of events) EventSchemas.parse(event);
}

function assertNoRunError(events) {
  assert.equal(
    events.some((event) => event.type === EventType.RUN_ERROR),
    false,
  );
}

function requiredInterrupt(events) {
  const finished = events.find(
    (event) =>
      event.type === EventType.RUN_FINISHED &&
      event.outcome?.type === "interrupt",
  );
  const interrupt = finished?.outcome?.interrupts?.[0];
  assert.ok(interrupt?.id);
  return interrupt;
}

function requiredTaskIdentity(events) {
  const identity = optionalTaskIdentity(events);
  assert.ok(identity?.taskId);
  assert.ok(identity?.contextId);
  return identity;
}

function optionalTaskIdentity(events) {
  return events.find(
    (event) =>
      event.type === EventType.CUSTOM && event.name === "sdar.task.bound",
  )?.value;
}

function latestTaskState(events) {
  let state;
  for (const event of events) {
    if (event.type === EventType.STATE_SNAPSHOT) {
      state = event.snapshot?.task?.state ?? state;
    }
    if (event.type === EventType.STATE_DELTA) {
      for (const operation of event.delta ?? []) {
        if (operation.path === "/task") state = operation.value?.state ?? state;
      }
    }
  }
  return state;
}

function publishedTaskState(events) {
  for (const event of [...events].reverse()) {
    if (event.type !== EventType.TEXT_MESSAGE_CONTENT) continue;
    const match = /\bis (COMPLETED|FAILED|CANCELED|REJECTED)\b/u.exec(
      event.delta ?? "",
    );
    if (match !== null) return match[1];
  }
  return undefined;
}

function signPrincipal(principalSubject) {
  const now = Math.floor(Date.now() / 1_000);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "open-webui",
    sub: principalSubject,
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
  if (!value) throw new Error(`${name} is required for P12 consistency`);
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
