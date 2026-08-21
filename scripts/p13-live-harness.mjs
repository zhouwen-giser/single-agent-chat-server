import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:net";

export function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the P13 real gate`);
  return value;
}

export function optional(name) {
  return process.env[name]?.trim() || undefined;
}

export function assertCandidateIntegrity() {
  const expected = required("P13_EXPECTED_SACS_SHA");
  const branch =
    optional("P13_REMOTE_BRANCH") ??
    "feature/sacs-v0.3-general-conversation-multitask";
  const local = git(["rev-parse", "HEAD"]);
  const remote = git(["rev-parse", `origin/${branch}`]);
  if (local !== expected || remote !== expected) {
    throw new Error("P13 candidate local/remote SHA mismatch");
  }
  if (git(["status", "--porcelain", "--untracked-files=no"]) !== "") {
    throw new Error("P13 real evidence requires a clean tracked tree");
  }
  return { candidateSha: expected, remoteSha: remote, remoteBranch: branch };
}

export async function startSacs(stamp, overrides = {}) {
  const port = await availablePort();
  const serviceKey = digest(`${stamp}:openai`);
  const agUiKey = digest(`${stamp}:agui`);
  const jwtSecret = digest(`${stamp}:principal`);
  const modelBaseUrl = required("P13_REAL_MODEL_BASE_URL");
  const modelName = required("P13_REAL_MODEL_NAME");
  const sdarBaseUrl = required("P13_REAL_SDAR_BASE_URL");
  const databaseUrl =
    optional("P13_DATABASE_URL") ?? required("TEST_DATABASE_URL");
  const child = spawn(process.execPath, ["dist/apps/server/src/main.js"], {
    cwd: process.cwd(),
    env: compact({
      ...process.env,
      CHAT_SERVER_SERVICE_KEY: serviceKey,
      AG_UI_SERVICE_KEY: agUiKey,
      OPENWEBUI_USER_JWT_SECRET: jwtSecret,
      CHAT_SERVER_HOST: "127.0.0.1",
      CHAT_SERVER_PORT: String(port),
      CHAT_RATE_LIMIT_MAX: "1000",
      LOG_LEVEL: "silent",
      DATABASE_URL: databaseUrl,
      CONVERSATION_MODEL_BASE_URL: modelBaseUrl,
      CONVERSATION_MODEL_NAME: modelName,
      CONVERSATION_MODEL_API_KEY: process.env.P13_REAL_MODEL_API_KEY ?? "",
      SDAR_A2A_BASE_URL: sdarBaseUrl,
      SDAR_A2A_ENDPOINT_OVERRIDE:
        process.env.P13_REAL_SDAR_ENDPOINT_OVERRIDE ?? "",
      ...overrides,
    }),
    stdio: ["ignore", "ignore", "ignore"],
    shell: false,
  });
  let exited;
  child.once("exit", (code, signal) => {
    exited = { code, signal };
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (exited !== undefined) {
      throw new Error(
        `P13 SACS process exited before readiness (${JSON.stringify(exited)})`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/ready`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return {
          baseUrl,
          serviceKey,
          jwtSecret,
          databaseUrl,
          modelBaseUrl,
          modelName,
          sdarBaseUrl,
          async stop() {
            if (child.exitCode !== null) return;
            child.kill("SIGTERM");
            await Promise.race([
              new Promise((resolve) => child.once("exit", resolve)),
              delay(10_000).then(() => child.kill("SIGKILL")),
            ]);
          },
        };
      }
    } catch {
      // Dependency readiness is polled within the bounded startup window.
    }
    await delay(500);
  }
  child.kill("SIGTERM");
  throw new Error("P13 SACS process did not become ready");
}

export async function completion(runtime, input) {
  const response = await fetch(`${runtime.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${runtime.serviceKey}`,
      "content-type": "application/json",
      "x-openwebui-user-jwt": signIdentity(input.subject, runtime.jwtSecret),
      "x-openwebui-chat-id": input.chatId,
      "x-openwebui-message-id": input.assistantMessageId,
      "x-openwebui-user-message-id": input.userMessageId,
      ...(input.parentId === undefined
        ? {}
        : { "x-openwebui-user-message-parent-id": input.parentId }),
    },
    body: JSON.stringify({
      model: "sdar-single-agent",
      messages: input.messages,
      stream: input.stream ?? false,
    }),
    signal: input.signal ?? AbortSignal.timeout(120_000),
  });
  if (input.stream === true) return { response };
  const document = await response.json();
  return {
    response,
    document,
    text: document.choices?.[0]?.message?.content ?? "",
  };
}

export function endpointHash(value) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return digest(url.toString());
}

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function signIdentity(subject, secret) {
  const now = Math.floor(Date.now() / 1_000);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "open-webui",
    sub: subject,
    role: "user",
    iat: now - 1,
    exp: now + 599,
  })}`;
  return `${unsigned}.${createHmac("sha256", secret)
    .update(unsigned, "ascii")
    .digest("base64url")}`;
}

export function stamp(prefix) {
  return `${prefix}-${Date.now()}-${process.pid}`;
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) throw new Error("Unable to verify P13 Git state");
  return result.stdout.trim();
}

function compact(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined),
  );
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Unable to reserve a P13 SACS port");
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
}
