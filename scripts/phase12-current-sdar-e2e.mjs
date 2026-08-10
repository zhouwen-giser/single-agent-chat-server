import assert from "node:assert/strict";

const base = requiredEnvironment("P12_OPENWEBUI_URL");
const runId = process.env.P12_RUN_STAMP ?? `p12-current-${Date.now()}`;
const adminEmail = requiredEnvironment("P12_OPENWEBUI_EMAIL");
const adminPassword = requiredEnvironment("P12_OPENWEBUI_PASSWORD");
const isolatedPassword = requiredEnvironment("P12_ISOLATED_USER_PASSWORD");

async function auth(email, password, signup = false) {
  const response = await fetch(
    `${base}/api/v1/auths/${signup ? "signup" : "signin"}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "P10 Isolated User", email, password }),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`auth failed: ${response.status} ${raw}`);
  }
  const json = JSON.parse(raw);
  assert.ok(json.token);
  return json;
}

const admin = await auth(adminEmail, adminPassword);

let sequence = 0;
function ids(prefix = runId) {
  sequence += 1;
  return {
    userMessageId: `${prefix}-user-${sequence}`,
    assistantMessageId: `${prefix}-assistant-${sequence}`,
  };
}

async function completion({
  token = admin.token,
  chatId,
  text,
  stream = false,
  parentId = "",
  utilityTask = "",
  fixedIds,
}) {
  const messageIds = fixedIds ?? ids();
  const response = await fetch(`${base}/openai/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "sdar-single-agent",
      stream,
      messages: [{ role: "user", content: text }],
      metadata: {
        chat_id: chatId,
        message_id: messageIds.assistantMessageId,
        user_message_id: messageIds.userMessageId,
        user_message: { id: messageIds.userMessageId, parentId },
        task: utilityTask,
      },
    }),
  });
  const raw = await response.text();
  if (stream) {
    const frames = raw
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6));
    const events = frames
      .filter((frame) => frame !== "[DONE]")
      .map((frame) => JSON.parse(frame));
    return {
      http: response.status,
      contentType: response.headers.get("content-type"),
      text: events
        .map((event) => event.choices?.[0]?.delta?.content)
        .filter(Boolean)
        .join("\n"),
      doneCount: frames.filter((frame) => frame === "[DONE]").length,
      finishCount: events.filter(
        (event) => event.choices?.[0]?.finish_reason === "stop",
      ).length,
      ...messageIds,
    };
  }
  const json = JSON.parse(raw);
  return {
    http: response.status,
    text: json.choices?.[0]?.message?.content ?? "",
    error: json.error,
    ...messageIds,
  };
}

async function create(chatId, text, stream = true) {
  return completion({ chatId, text, stream });
}

async function follow(chatId, text, parentId = "") {
  return completion({ chatId, text, parentId });
}

const modelsResponse = await fetch(`${base}/openai/models`, {
  headers: { authorization: `Bearer ${admin.token}` },
});
const models = await modelsResponse.json();

const ordinary = await completion({
  chatId: `${runId}-ordinary`,
  text: "Hello, what is this chat entrance?",
});
const utility = await completion({
  chatId: `${runId}-utility`,
  text: "Generate a concise title",
  utilityTask: "title_generation",
});
const capabilityChat = `${runId}-capabilities`;
const capabilities = await completion({
  chatId: capabilityChat,
  text: "What capabilities does the agent have?",
});

const rejectChat = `${runId}-reject`;
const rejectCreated = await create(rejectChat, "Execute P10 reject scenario");
const rejected = await follow(
  rejectChat,
  "Reject the plan",
  rejectCreated.userMessageId,
);

const reviseChat = `${runId}-revise`;
const reviseCreated = await create(reviseChat, "Execute P10 revise scenario");
const revised = await follow(
  reviseChat,
  "Revise the plan: keep exactly one device lookup",
  reviseCreated.userMessageId,
);
const reviseConfirmed = await follow(
  reviseChat,
  "Confirm the plan",
  revised.userMessageId,
);
await new Promise((resolve) => setTimeout(resolve, 2_500));
const reviseStatus = await follow(
  reviseChat,
  "task status",
  reviseConfirmed.userMessageId,
);

const inputChat = `${runId}-input`;
const inputCreated = await create(
  inputChat,
  "Execute phase11 input required scenario",
);
const inputProvided = await follow(
  inputChat,
  "device-17",
  inputCreated.userMessageId,
);
await new Promise((resolve) => setTimeout(resolve, 750));
const inputPlanReady = await follow(
  inputChat,
  "task status",
  inputProvided.userMessageId,
);
const inputConfirmed = await follow(
  inputChat,
  "Confirm the plan",
  inputPlanReady.userMessageId,
);
await new Promise((resolve) => setTimeout(resolve, 2_500));
const inputResult = await follow(
  inputChat,
  "show the task result",
  inputConfirmed.userMessageId,
);
const inputHistory = await follow(
  inputChat,
  "task history",
  inputResult.userMessageId,
);

const pauseChat = `${runId}-pause`;
const pauseCreated = await create(pauseChat, "Execute phase11 delay scenario");
const pauseConfirmed = await follow(
  pauseChat,
  "Confirm the plan",
  pauseCreated.userMessageId,
);
await new Promise((resolve) => setTimeout(resolve, 50));
const paused = await follow(pauseChat, "pause", pauseConfirmed.userMessageId);
const resumed = await follow(pauseChat, "resume", paused.userMessageId);
await new Promise((resolve) => setTimeout(resolve, 3_500));
const pauseStatus = await follow(
  pauseChat,
  "task status",
  resumed.userMessageId,
);

const cancelChat = `${runId}-cancel`;
const cancelCreated = await create(
  cancelChat,
  "Execute phase11 delay scenario",
);
const canceled = await follow(
  cancelChat,
  "cancel the task",
  cancelCreated.userMessageId,
);

const gapChat = `${runId}-gap`;
const gapCreated = await create(gapChat, "Execute PHASE11_GAP_BRANCH scenario");
const gapConfirmed = await follow(
  gapChat,
  "Confirm the plan",
  gapCreated.userMessageId,
);
await new Promise((resolve) => setTimeout(resolve, 2_500));
const gapStatus = await follow(
  gapChat,
  "task status",
  gapConfirmed.userMessageId,
);

const retryChat = `${runId}-retry`;
const retryIds = ids(`${runId}-retry-fixed`);
const retryFirst = await completion({
  chatId: retryChat,
  text: "Execute P10 idempotency retry scenario",
  stream: true,
  fixedIds: retryIds,
});
const retrySecond = await completion({
  chatId: retryChat,
  text: "Execute P10 idempotency retry scenario",
  stream: true,
  fixedIds: retryIds,
});

const disconnectChat = `${runId}-disconnect`;
const disconnectIds = ids(`${runId}-disconnect`);
const disconnectController = new AbortController();
const disconnectResponse = await fetch(`${base}/openai/chat/completions`, {
  method: "POST",
  signal: disconnectController.signal,
  headers: {
    authorization: `Bearer ${admin.token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "sdar-single-agent",
    stream: true,
    messages: [
      { role: "user", content: "Execute P10 disconnect recovery scenario" },
    ],
    metadata: {
      chat_id: disconnectChat,
      message_id: disconnectIds.assistantMessageId,
      user_message_id: disconnectIds.userMessageId,
      user_message: { id: disconnectIds.userMessageId, parentId: "" },
      task: "",
    },
  }),
});
const reader = disconnectResponse.body.getReader();
const decoder = new TextDecoder();
let disconnectedBytes = 0;
let disconnectedText = "";
for (let attempt = 0; attempt < 20; attempt += 1) {
  const read = await reader.read();
  if (read.done) break;
  disconnectedBytes += read.value.byteLength;
  disconnectedText += decoder.decode(read.value, { stream: true });
  if (disconnectedText.includes("Task queued.")) break;
}
disconnectController.abort();
await reader.cancel().catch(() => undefined);
await new Promise((resolve) => setTimeout(resolve, 2_500));
const disconnectRecovered = await follow(disconnectChat, "task status");

const isolatedEmail = `${runId}@example.invalid`;

const isolatedResponse = await fetch(`${base}/api/v1/auths/add`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${admin.token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    name: "P10 Isolated User",
    email: isolatedEmail,
    password: isolatedPassword,
    role: "admin",
    profile_image_url: "",
  }),
});
const isolatedRaw = await isolatedResponse.text();
if (!isolatedResponse.ok) {
  throw new Error(
    `admin add user failed: ${isolatedResponse.status} ${isolatedRaw}`,
  );
}
const isolated = JSON.parse(isolatedRaw);
const isolatedStatus = await completion({
  token: isolated.token,
  chatId: rejectChat,
  text: "task status",
});

const evidence = {
  runId,
  exactHead: process.env.P12_EXPECTED_SACS_SHA,
  models: {
    http: modelsResponse.status,
    ids: models.data?.map((model) => model.id) ?? [],
  },
  ordinary,
  utility,
  capabilities,
  reject: { created: rejectCreated, rejected },
  revise: {
    created: reviseCreated,
    revised,
    confirmed: reviseConfirmed,
    status: reviseStatus,
  },
  input: {
    created: inputCreated,
    provided: inputProvided,
    planReady: inputPlanReady,
    confirmed: inputConfirmed,
    result: inputResult,
    history: inputHistory,
  },
  pauseResume: {
    created: pauseCreated,
    confirmed: pauseConfirmed,
    paused,
    resumed,
    status: pauseStatus,
  },
  cancel: { created: cancelCreated, canceled },
  capabilityGap: {
    created: gapCreated,
    confirmed: gapConfirmed,
    status: gapStatus,
  },
  idempotency: {
    first: retryFirst,
    second: retrySecond,
    sameResponse: retryFirst.text === retrySecond.text,
  },
  disconnect: {
    http: disconnectResponse.status,
    observedBytesBeforeAbort: disconnectedBytes,
    recovered: disconnectRecovered,
  },
  userIsolation: {
    isolatedUserId: isolated.id,
    statusAgainstAdminChat: isolatedStatus,
  },
};

for (const [name, response] of [
  ["ordinary", ordinary],
  ["utility", utility],
  ["capabilities", capabilities],
  ["rejectCreated", rejectCreated],
  ["rejected", rejected],
  ["reviseCreated", reviseCreated],
  ["revised", revised],
  ["reviseConfirmed", reviseConfirmed],
  ["reviseStatus", reviseStatus],
  ["inputCreated", inputCreated],
  ["inputProvided", inputProvided],
  ["inputPlanReady", inputPlanReady],
  ["inputConfirmed", inputConfirmed],
  ["inputResult", inputResult],
  ["inputHistory", inputHistory],
  ["pauseCreated", pauseCreated],
  ["pauseConfirmed", pauseConfirmed],
  ["paused", paused],
  ["resumed", resumed],
  ["pauseStatus", pauseStatus],
  ["cancelCreated", cancelCreated],
  ["canceled", canceled],
  ["gapCreated", gapCreated],
  ["gapConfirmed", gapConfirmed],
  ["gapStatus", gapStatus],
  ["retryFirst", retryFirst],
  ["retrySecond", retrySecond],
  ["disconnectRecovered", disconnectRecovered],
  ["isolatedStatus", isolatedStatus],
]) {
  assert.equal(response.http, 200, `${name} HTTP status`);
}
assert.equal(modelsResponse.status, 200);
assert.ok(evidence.models.ids.includes("sdar-single-agent"));
assert.equal(retryFirst.doneCount, 1);
assert.equal(retrySecond.doneCount, 1);
assert.ok(disconnectedBytes > 0);

assert.ok(ordinary.text.length > 0);
assert.equal(utility.text, "Single SDAR chat");
assert.match(capabilities.text, /current Agent Card/u);
assert.match(rejected.text, /SDAR status: CANCELED/u);
assert.match(revised.text, /Revised plan confirmation required/u);
assert.match(reviseStatus.text, / is COMPLETED\./u);
assert.match(inputCreated.text, /requested user input/u);
assert.match(inputPlanReady.text, /awaiting_plan_confirmation/u);
assert.match(inputResult.text, /Device is online/u);
assert.match(inputHistory.text, /Published history/u);
assert.match(paused.text, /SDAR status: INPUT_REQUIRED/u);
assert.match(paused.text, /paused/u);
assert.match(resumed.text, /Task resumed by user/u);
assert.match(pauseStatus.text, / is COMPLETED\./u);
assert.match(canceled.text, /SDAR status: CANCELED/u);
assert.match(canceled.text, /top-level SDAR Task state/u);
assert.match(gapStatus.text, /Internal phase: capability_gap/u);
assert.match(gapStatus.text, /Required capability is unavailable/u);
assert.ok(retrySecond.text.length > 0);
assert.match(disconnectRecovered.text, /awaiting_plan_confirmation/u);
assert.match(isolatedStatus.text, /No Task is bound/u);

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the real P12 E2E`);
  return value;
}
