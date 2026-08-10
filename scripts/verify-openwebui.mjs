import { readFile } from "node:fs/promises";

const requiredScenarios = [
  "model_discovery",
  "normal_chat_without_task",
  "agent_card_discovery",
  "create_task",
  "published_phase_message",
  "bounded_stream",
  "get_task_after_nonterminal_stream",
  "status_query",
  "plan_confirm",
  "plan_reject",
  "plan_revise",
  "provide_input",
  "pause",
  "resume",
  "cancel_task",
  "completed_artifact",
  "failed",
  "capability_gap",
  "server_restart_recovery",
  "user_isolation",
  "utility_isolation",
  "retry_idempotency",
  "signed_identity",
  "sdar_outage",
  "docker_endpoint_override",
  "phase12_security_regression",
];

const baseUrl = requiredUrl("OPENWEBUI_VERIFY_BASE_URL");
const sdarBaseUrl = requiredUrl("SDAR_A2A_BASE_URL");
const bearer = required("OPENWEBUI_VERIFY_BEARER_TOKEN");
const taskPrompt = required("OPENWEBUI_VERIFY_TASK_PROMPT");
const evidenceFile = required("PHASE13_E2E_EVIDENCE_FILE");
required("TEST_DATABASE_URL");

const headers = {
  authorization: `Bearer ${bearer}`,
  "content-type": "application/json",
};
const models = await fetchJson(new URL("/openai/models", baseUrl), {
  headers,
  signal: AbortSignal.timeout(10_000),
});
const modelEntries = Array.isArray(models.data) ? models.data : models;
if (
  !Array.isArray(modelEntries) ||
  !modelEntries.some(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      entry.id === "sdar-single-agent",
  )
) {
  throw new Error("Open WebUI did not discover sdar-single-agent");
}

const agentCard = await fetchJson(
  new URL("/.well-known/agent-card.json", sdarBaseUrl),
  { signal: AbortSignal.timeout(10_000) },
);
if (
  agentCard.capabilities?.streaming !== true ||
  !agentCard.supportedInterfaces?.some(
    (candidate) =>
      candidate.protocolBinding === "HTTP+JSON" &&
      candidate.protocolVersion === "1.0",
  )
) {
  throw new Error("Live SDAR Agent Card does not satisfy the frozen baseline");
}

const verificationId = `phase13-live-${Date.now().toString(36)}`;
const completion = await fetchJson(
  new URL("/openai/chat/completions", baseUrl),
  {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "sdar-single-agent",
      messages: [{ role: "user", content: taskPrompt }],
      stream: false,
      metadata: {
        chat_id: verificationId,
        message_id: `${verificationId}-assistant`,
        user_message_id: `${verificationId}-user`,
        user_message: { id: `${verificationId}-user`, parentId: "" },
        task: "phase13_live_verification",
      },
    }),
    signal: AbortSignal.timeout(120_000),
  },
);
if (
  !Array.isArray(completion.choices) ||
  typeof completion.choices[0]?.message?.content !== "string" ||
  completion.choices[0].message.content.length === 0
) {
  throw new Error(
    "Open WebUI task completion did not return conversational text",
  );
}

const evidence = JSON.parse(await readFile(evidenceFile, "utf8"));
const headResponse = await runGit(["rev-parse", "HEAD"]);
if (evidence.localHeadSha !== headResponse.trim()) {
  throw new Error(
    "Phase 13 real-E2E evidence is not for the current local HEAD",
  );
}
for (const scenario of requiredScenarios) {
  if (evidence.scenarios?.[scenario] !== "PASSED_REAL") {
    throw new Error(`Required real-E2E scenario is not passed: ${scenario}`);
  }
}

process.stdout.write(
  `Real Open WebUI/SDAR gate passed at ${evidence.localHeadSha} for ${requiredScenarios.length} required scenarios.\n`,
);

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url.pathname} returned HTTP ${response.status}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url.pathname} did not return JSON`);
  }
}

async function runGit(args) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr.trim())),
    );
  });
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the real E2E gate`);
  return value;
}

function requiredUrl(name) {
  const value = required(name);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${name} must use http or https`);
  }
  return url;
}
