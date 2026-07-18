import { afterEach, describe, expect, it } from "@jest/globals";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  createSdarA2aClient,
  parseSdarA2aConfig,
  type SdarA2aClient,
} from "../packages/sdar-a2a-adapter/src/index.js";

interface SeenRequest {
  readonly method: string;
  readonly url: string;
  readonly version?: string;
  readonly body?: unknown;
}
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});

async function startMock(
  options: {
    readonly advertisedEndpoint?: string;
    readonly protocolBinding?: string;
    readonly protocolVersion?: string;
    readonly discoveryDelayMs?: number;
  } = {},
) {
  const seen: SeenRequest[] = [];
  const server = createServer(async (request, response) => {
    const body = await readJsonBody(request);
    seen.push({
      method: request.method ?? "",
      url: request.url ?? "",
      ...(typeof request.headers["a2a-version"] === "string"
        ? { version: request.headers["a2a-version"] }
        : {}),
      ...(body === undefined ? {} : { body }),
    });
    if (request.url === "/.well-known/agent-card.json") {
      if (options.discoveryDelayMs !== undefined) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.discoveryDelayMs),
        );
      }
      if (!response.destroyed) {
        json(
          response,
          agentCard({
            endpoint: options.advertisedEndpoint ?? "http://127.0.0.1:1/a2a",
            binding: options.protocolBinding ?? "HTTP+JSON",
            version: options.protocolVersion ?? "1.0",
          }),
        );
      }
      return;
    }
    if (request.url === "/a2a/message:stream") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        "data: " +
          JSON.stringify({
            task: taskJson("TASK_STATE_WORKING", {
              internalPhase: "executing",
              phaseMessage: "working",
            }),
          }) +
          String.fromCharCode(10, 10),
      );
      return;
    }
    if (request.url === "/a2a/message:send") {
      json(response, {
        task: taskJson("TASK_STATE_INPUT_REQUIRED", {
          internalPhase: "awaiting_user_input",
        }),
      });
      return;
    }
    if (request.url === "/a2a/tasks/task-1?historyLength=0") {
      json(
        response,
        taskJson(
          "TASK_STATE_COMPLETED",
          {
            internalPhase: "completed",
          },
          true,
        ),
      );
      return;
    }
    if (request.url === "/a2a/tasks/task-1:cancel") {
      json(
        response,
        taskJson("TASK_STATE_CANCELED", {
          internalPhase: "canceled",
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock server did not expose a TCP address");
  }
  const baseUrl = "http://127.0.0.1:" + address.port;
  return { baseUrl, endpoint: baseUrl + "/a2a", seen };
}

async function connectedClient(): Promise<{
  readonly client: SdarA2aClient;
  readonly seen: SeenRequest[];
}> {
  const mock = await startMock();
  return {
    client: await createSdarA2aClient({
      baseUrl: mock.baseUrl,
      endpointOverride: mock.endpoint,
      operationTimeoutMs: 2_000,
    }),
    seen: mock.seen,
  };
}
describe("official SDAR A2A adapter HTTP+JSON contract", () => {
  it("parses explicit endpoint configuration without implicit rewrites", () => {
    expect(parseSdarA2aConfig({})).toEqual({
      baseUrl: "http://127.0.0.1:9999",
      discoveryTimeoutMs: 10_000,
      operationTimeoutMs: 30_000,
    });
    expect(
      parseSdarA2aConfig({
        SDAR_A2A_BASE_URL: "http://sdar:9999",
        SDAR_A2A_ENDPOINT_OVERRIDE: "http://sdar:9999/a2a",
      }),
    ).toMatchObject({
      baseUrl: "http://sdar:9999",
      endpointOverride: "http://sdar:9999/a2a",
    });
  });
  it("validates binding/version and uses only an explicit endpoint override", async () => {
    const mock = await startMock({
      advertisedEndpoint: "http://0.0.0.0:9999/a2a",
    });
    const client = await createSdarA2aClient({
      baseUrl: mock.baseUrl,
      endpointOverride: mock.endpoint,
    });
    expect(client).toMatchObject({
      protocolBinding: "HTTP+JSON",
      protocolVersion: "1.0",
      endpoint: mock.endpoint,
    });

    const wrongBinding = await startMock({ protocolBinding: "JSONRPC" });
    await expect(
      createSdarA2aClient({ baseUrl: wrongBinding.baseUrl }),
    ).rejects.toThrow("does not advertise HTTP+JSON protocol version 1.0");
    const wrongVersion = await startMock({ protocolVersion: "0.3" });
    await expect(
      createSdarA2aClient({ baseUrl: wrongVersion.baseUrl }),
    ).rejects.toThrow("does not advertise HTTP+JSON protocol version 1.0");
  });

  it("streams a bounded WORKING Task through the official SDK", async () => {
    const { client, seen } = await connectedClient();
    const events = [];
    for await (const event of client.submitTaskStream({
      messageId: "message-1",
      text: "run the task",
      userId: "user-1",
      structuredInput: { priority: 1 },
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        kind: "task",
        task: expect.objectContaining({
          taskId: "task-1",
          contextId: "context-1",
          state: "WORKING",
          internalPhase: "executing",
          phaseMessage: "working",
        }),
      },
    ]);
    const request = seen.find((item) => item.url === "/a2a/message:stream");
    expect(request?.version).toBe("1.0");
    expect(request?.body).toMatchObject({
      message: {
        messageId: "message-1",
        role: "ROLE_USER",
        parts: [{ text: "run the task", mediaType: "text/plain" }],
        metadata: {
          user_id: "user-1",
          structured_input: { priority: 1 },
        },
      },
    });
  });

  it("enforces strict follow-up metadata and provide_input data rules", async () => {
    const { client, seen } = await connectedClient();
    const result = await client.sendFollowUp({
      messageId: "message-2",
      taskId: "task-1",
      contextId: "context-1",
      action: "provide_input",
      text: "input text",
      inputRequestId: "input-1",
      userId: "user-1",
      data: { answer: 42 },
    });
    expect(result).toMatchObject({
      kind: "task",
      task: {
        taskId: "task-1",
        state: "INPUT_REQUIRED",
        internalPhase: "awaiting_user_input",
      },
    });
    const request = seen.find((item) => item.url === "/a2a/message:send");
    expect(request?.body).toMatchObject({
      message: {
        taskId: "task-1",
        contextId: "context-1",
        metadata: {
          sdar_action: "provide_input",
          input_request_id: "input-1",
          user_id: "user-1",
        },
        parts: [
          { text: "input text", mediaType: "text/plain" },
          { data: { answer: 42 }, mediaType: "application/json" },
        ],
      },
    });
    const metadata = (
      request?.body as {
        message: { metadata: Record<string, unknown> };
      }
    ).message.metadata;
    expect(Object.keys(metadata).sort()).toEqual([
      "input_request_id",
      "sdar_action",
      "user_id",
    ]);

    await expect(
      client.sendFollowUp({
        messageId: "message-3",
        taskId: "task-1",
        contextId: "context-1",
        action: "pause",
        text: "pause",
        data: { injected: true },
      }),
    ).rejects.toThrow("data is only allowed for provide_input");
    await expect(
      client.sendFollowUp({
        messageId: "message-4",
        taskId: "task-1",
        contextId: "context-1",
        action: "resume",
        text: "resume",
        extra: "forbidden",
      } as never),
    ).rejects.toThrow("Unrecognized key");
  });

  it("polls Task state, normalizes Result text+JSON, and cancels top-level Task", async () => {
    const { client, seen } = await connectedClient();
    const completed = await client.getTask("task-1", { historyLength: 0 });
    const canceled = await client.cancelTask("task-1");

    expect(completed).toMatchObject({
      state: "COMPLETED",
      internalPhase: "completed",
      artifacts: [
        {
          artifactId: "result",
          parts: [
            { kind: "text", text: "done", mediaType: "text/plain" },
            {
              kind: "data",
              data: { value: 42 },
              mediaType: "application/json",
            },
          ],
        },
      ],
    });
    expect(canceled.state).toBe("CANCELED");
    expect(
      seen.some((item) => item.url === "/a2a/tasks/task-1?historyLength=0"),
    ).toBe(true);
    expect(seen.some((item) => item.url === "/a2a/tasks/task-1:cancel")).toBe(
      true,
    );
  });

  it("bounds Agent Card discovery with AbortSignal timeout", async () => {
    const mock = await startMock({ discoveryDelayMs: 500 });
    await expect(
      createSdarA2aClient({
        baseUrl: mock.baseUrl,
        discoveryTimeoutMs: 100,
      }),
    ).rejects.toThrow();
  });
});
function agentCard(input: {
  readonly endpoint: string;
  readonly binding: string;
  readonly version: string;
}) {
  return {
    name: "Mock SDAR",
    description: "Mock SDAR A2A server",
    supportedInterfaces: [
      {
        url: input.endpoint,
        protocolBinding: input.binding,
        protocolVersion: input.version,
      },
    ],
    version: "0.0.0",
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "application/json"],
  };
}

function taskJson(
  state: string,
  metadata: Record<string, unknown>,
  withArtifact = false,
) {
  return {
    id: "task-1",
    contextId: "context-1",
    status: {
      state,
      message: {
        messageId: "status-1",
        contextId: "context-1",
        taskId: "task-1",
        role: "ROLE_AGENT",
        parts: [{ text: "published status", mediaType: "text/plain" }],
      },
      timestamp: "2026-07-18T12:00:00Z",
    },
    artifacts: withArtifact
      ? [
          {
            artifactId: "result",
            name: "result",
            parts: [
              { text: "done", mediaType: "text/plain" },
              { data: { value: 42 }, mediaType: "application/json" },
            ],
          },
        ]
      : [],
    metadata,
  };
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function json(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
