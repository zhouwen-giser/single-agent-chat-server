import {
  Role,
  type AgentCard,
  type Message,
  type Part,
  type SendMessageRequest,
} from "@a2a-js/sdk";
import {
  ClientFactory,
  DefaultAgentCardResolver,
  RestTransportFactory,
  type Client,
} from "@a2a-js/sdk/client";

import {
  normalizeAgentCard,
  normalizeSendResult,
  normalizeStreamEvent,
  normalizeTask,
} from "./normalize.js";
import type {
  FollowUpInput,
  NormalizedAgentCard,
  OperationOptions,
  SdarA2aClient,
  SubmitTaskInput,
} from "./types.js";
import {
  adapterConfigSchema,
  followUpInputSchema,
  submitTaskInputSchema,
} from "./validation.js";

export interface SdarA2aAdapterConfig {
  readonly baseUrl: string;
  readonly endpointOverride?: string;
  readonly discoveryTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

interface ResolvedCard {
  readonly card: AgentCard;
  readonly endpoint: string;
}

const MAX_STREAM_EVENTS = 512;

export async function createSdarA2aClient(
  input: SdarA2aAdapterConfig,
): Promise<SdarA2aClient> {
  const parsed = adapterConfigSchema.parse(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  const discoveryFetch = withDefaultTimeout(
    fetchImpl,
    parsed.discoveryTimeoutMs,
  );
  const resolver = new DefaultAgentCardResolver({
    fetchImpl: discoveryFetch,
  });
  const downloadedCard = await resolver.resolve(parsed.baseUrl);
  const resolved = selectHttpJsonInterface(
    downloadedCard,
    parsed.baseUrl,
    parsed.endpointOverride,
  );
  const factory = new ClientFactory({
    transports: [new RestTransportFactory({ fetchImpl })],
    preferredTransports: ["HTTP+JSON"],
    clientConfig: {
      polling: true,
      acceptedOutputModes: ["text/plain", "application/json"],
    },
    cardResolver: resolver,
  });
  const sdkClient = await factory.createFromAgentCard(resolved.card);
  if (
    sdkClient.transport.protocolName !== "HTTP+JSON" ||
    sdkClient.protocolVersion !== "1.0"
  ) {
    throw new Error("A2A client did not negotiate HTTP+JSON protocol 1.0");
  }
  return new OfficialSdarA2aClient(
    sdkClient,
    resolved.endpoint,
    normalizeAgentCard(resolved.card),
    parsed.operationTimeoutMs,
  );
}

function selectHttpJsonInterface(
  card: AgentCard,
  baseUrl: string,
  endpointOverride?: string,
): ResolvedCard {
  const selected = card.supportedInterfaces.find(
    (candidate) =>
      candidate.protocolBinding === "HTTP+JSON" &&
      candidate.protocolVersion === "1.0",
  );
  if (selected === undefined) {
    throw new Error(
      "Agent Card does not advertise HTTP+JSON protocol version 1.0",
    );
  }
  if (card.capabilities?.streaming !== true) {
    throw new Error("Agent Card does not advertise required streaming support");
  }
  if (
    card.securityRequirements.length > 0 ||
    card.skills.some((skill) => skill.securityRequirements.length > 0)
  ) {
    throw new Error(
      "Agent Card requires unsupported authentication for the trusted SDAR connection",
    );
  }
  if (!card.defaultInputModes.includes("text/plain")) {
    throw new Error("Agent Card does not accept required text/plain input");
  }
  if (
    !card.defaultOutputModes.includes("text/plain") ||
    !card.defaultOutputModes.includes("application/json")
  ) {
    throw new Error("Agent Card does not advertise required output modes");
  }
  validateHttpUrl(selected.url, "Agent Card interface URL");
  const endpoint = endpointOverride ?? selected.url;
  validateHttpUrl(endpoint, "A2A endpoint");
  if (new URL(endpoint).origin !== new URL(baseUrl).origin) {
    throw new Error(
      "A2A endpoint must share the configured SDAR base URL origin",
    );
  }
  return {
    endpoint,
    card: {
      ...card,
      supportedInterfaces: [{ ...selected, url: endpoint }],
    },
  };
}

class OfficialSdarA2aClient implements SdarA2aClient {
  readonly protocolBinding = "HTTP+JSON" as const;
  readonly protocolVersion = "1.0" as const;

  constructor(
    private readonly client: Client,
    readonly endpoint: string,
    readonly agentCard: NormalizedAgentCard,
    private readonly operationTimeoutMs: number,
  ) {}

  async *submitTaskStream(
    input: SubmitTaskInput,
    options: OperationOptions = {},
  ) {
    const parsed = submitTaskInputSchema.parse(input);
    const request = createSubmitRequest(parsed);
    const signal = operationSignal(this.operationTimeoutMs, options.signal);
    let eventCount = 0;
    for await (const event of this.client.sendMessageStream(request, {
      signal,
    })) {
      eventCount += 1;
      if (eventCount > MAX_STREAM_EVENTS) {
        throw new Error(
          `A2A stream exceeded the ${MAX_STREAM_EVENTS}-event limit`,
        );
      }
      yield normalizeStreamEvent(event);
    }
  }

  async sendFollowUp(input: FollowUpInput, options: OperationOptions = {}) {
    const parsed = followUpInputSchema.parse(input);
    const result = await this.client.sendMessage(
      createFollowUpRequest(parsed),
      { signal: operationSignal(this.operationTimeoutMs, options.signal) },
    );
    return normalizeSendResult(result);
  }

  async getTask(
    taskId: string,
    options: OperationOptions & { readonly historyLength?: number } = {},
  ) {
    const id = requiredIdentifier(taskId, "taskId");
    if (
      options.historyLength !== undefined &&
      (!Number.isInteger(options.historyLength) ||
        options.historyLength < 0 ||
        options.historyLength > 100)
    ) {
      throw new Error("historyLength must be an integer from 0 to 100");
    }
    const task = await this.client.getTask(
      {
        tenant: "",
        id,
        ...(options.historyLength === undefined
          ? {}
          : { historyLength: options.historyLength }),
      },
      { signal: operationSignal(this.operationTimeoutMs, options.signal) },
    );
    return normalizeTask(task);
  }

  async cancelTask(taskId: string, options: OperationOptions = {}) {
    const id = requiredIdentifier(taskId, "taskId");
    const task = await this.client.cancelTask(
      { tenant: "", id, metadata: undefined },
      { signal: operationSignal(this.operationTimeoutMs, options.signal) },
    );
    return normalizeTask(task);
  }
}

function createSubmitRequest(
  input: ReturnType<typeof submitTaskInputSchema.parse>,
): SendMessageRequest {
  const metadata: Record<string, unknown> = {};
  if (input.userId !== undefined) metadata.user_id = input.userId;
  if (input.structuredInput !== undefined) {
    metadata.structured_input = input.structuredInput;
  }
  return {
    tenant: "",
    message: createUserMessage({
      messageId: input.messageId,
      text: input.text,
      metadata: Object.keys(metadata).length === 0 ? undefined : metadata,
    }),
    configuration: {
      acceptedOutputModes: ["text/plain", "application/json"],
      taskPushNotificationConfig: undefined,
      returnImmediately: false,
    },
    metadata: undefined,
  };
}

function createFollowUpRequest(
  input: ReturnType<typeof followUpInputSchema.parse>,
): SendMessageRequest {
  const metadata: Record<string, unknown> = { sdar_action: input.action };
  if (input.inputRequestId !== undefined) {
    metadata.input_request_id = input.inputRequestId;
  }
  if (input.userId !== undefined) metadata.user_id = input.userId;
  const parts: Part[] = [];
  if (input.text.trim().length > 0) parts.push(textPart(input.text));
  if (input.data !== undefined) {
    parts.push({
      content: { $case: "data", value: input.data },
      metadata: undefined,
      filename: "",
      mediaType: "application/json",
    });
  }
  return {
    tenant: "",
    message: {
      messageId: input.messageId,
      contextId: input.contextId,
      taskId: input.taskId,
      role: Role.ROLE_USER,
      parts,
      metadata,
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: {
      acceptedOutputModes: ["text/plain", "application/json"],
      taskPushNotificationConfig: undefined,
      returnImmediately: false,
    },
    metadata: undefined,
  };
}

function createUserMessage(input: {
  readonly messageId: string;
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
}): Message {
  return {
    messageId: input.messageId,
    contextId: "",
    taskId: "",
    role: Role.ROLE_USER,
    parts: [textPart(input.text)],
    metadata: input.metadata,
    extensions: [],
    referenceTaskIds: [],
  };
}

function textPart(text: string): Part {
  return {
    content: { $case: "text", value: text },
    metadata: undefined,
    filename: "",
    mediaType: "text/plain",
  };
}

function operationSignal(
  timeoutMs: number,
  signal: AbortSignal | undefined,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function withDefaultTimeout(
  fetchImpl: typeof fetch,
  timeoutMs: number,
): typeof fetch {
  return async (input, init) => {
    const supplied = init?.signal ?? undefined;
    const signal = operationSignal(timeoutMs, supplied);
    return fetchImpl(input, { ...init, signal });
  };
}

function validateHttpUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(label + " must be an absolute URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(label + " must use http or https");
  }
}

function requiredIdentifier(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) {
    throw new Error(name + " must contain 1 to 256 characters");
  }
  return normalized;
}
