import { createHash } from "node:crypto";

import { safePublicText } from "../../interaction-contract/src/index.js";
import {
  hashJson,
  type AgentCardSnapshot,
  type JsonValue,
  type TaskBinding,
} from "../../persistence/src/index.js";
import type {
  NormalizedAgentCard,
  NormalizedMessage,
  NormalizedPart,
  NormalizedTask,
  SdarA2aClient,
  SdarFollowUpAction,
} from "../../sdar-a2a-adapter/src/index.js";

export const queryIntentValues = [
  "query_capabilities",
  "query_active_task",
  "query_task_status",
  "query_task_result",
  "query_task_history",
  "list_conversation_tasks",
  "query_previous_task",
  "query_allowed_actions",
  "query_capability_gap",
] as const;

export type QueryIntent = (typeof queryIntentValues)[number];

export interface ResolvedQueryIntent {
  readonly intent: QueryIntent;
  readonly taskId?: string;
}

const intentPatterns: readonly [QueryIntent, RegExp][] = [
  [
    "query_capability_gap",
    /(?:能力缺口|能力差距|capabilit(?:y|ies)\s+gap|missing capabilit)/iu,
  ],
  [
    "query_allowed_actions",
    /(?:允许(?:的)?操作|可(?:以|用)做什么|下一步操作|allowed actions?|what can i do next)/iu,
  ],
  [
    "query_task_history",
    /(?:任务历史|消息历史|task history|message history)/iu,
  ],
  ["query_task_result", /(?:任务结果|产物|task result|artifacts?)/iu],
  [
    "query_previous_task",
    /(?:上一个任务|前一个任务|previous task|prior task)/iu,
  ],
  [
    "list_conversation_tasks",
    /(?:列出|查看|显示).*(?:会话|对话).*(?:任务)|(?:会话|对话).*(?:任务列表)|list (?:the )?(?:conversation )?tasks/iu,
  ],
  [
    "query_active_task",
    /(?:当前|活跃|正在).*(?:任务)|active task|current task/iu,
  ],
  [
    "query_task_status",
    /(?:任务状态|任务进度|进度怎么样|怎么样了|task status|task progress|status of (?:the )?task|^status$|^progress$)/iu,
  ],
  [
    "query_capabilities",
    /(?:有哪些能力|支持什么|能做什么|技能列表|capabilit(?:y|ies)|what can (?:you|the agent) do|agent skills?)/iu,
  ],
];

export function resolveQueryIntent(
  text: string,
): ResolvedQueryIntent | undefined {
  const normalized = text.trim();
  if (normalized.length === 0) return undefined;
  const match = intentPatterns.find(([, pattern]) => pattern.test(normalized));
  if (match === undefined) return undefined;
  const taskId = extractExplicitTaskId(normalized);
  return {
    intent: match[0],
    ...(taskId === undefined ? {} : { taskId }),
  };
}

function extractExplicitTaskId(text: string): string | undefined {
  const match =
    /(?:task[_\s-]?id|任务(?:id|编号))\s*[:=#]?\s*([a-z0-9][a-z0-9._:-]{0,255})/iu.exec(
      text,
    );
  return match?.[1];
}

export interface QueryRepository {
  findAuthorizedTask(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly sdarTaskId: string;
  }): Promise<TaskBinding | undefined>;
  findActiveTask(input: {
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<TaskBinding | undefined>;
  listTaskBindings(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly limit?: number;
  }): Promise<readonly TaskBinding[]>;
  recordAuthorizedTaskObservation(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly sdarTaskId: string;
    readonly status: string;
    readonly pendingInput?: JsonValue;
    readonly lastStatusTimestamp?: string;
    readonly terminal: boolean;
  }): Promise<TaskBinding | undefined>;
  saveAgentCardSnapshot(
    input: Omit<AgentCardSnapshot, "snapshotId">,
  ): Promise<AgentCardSnapshot>;
  getLatestAgentCardSnapshot(): Promise<AgentCardSnapshot | undefined>;
}

export interface QueryExecutionInput extends ResolvedQueryIntent {
  readonly principalId: string;
  readonly threadId: string;
  readonly signal?: AbortSignal;
}

export class InteractionQueryService {
  constructor(
    private readonly repository: QueryRepository,
    private readonly getClient: () => Promise<SdarA2aClient>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: QueryExecutionInput): Promise<string> {
    if (input.intent === "query_capabilities") {
      return this.queryCapabilities();
    }
    if (input.intent === "list_conversation_tasks") {
      const bindings = await this.listBindings(input);
      return renderBindingList(bindings);
    }
    if (input.intent === "query_previous_task") {
      const bindings = await this.listBindings(input);
      const binding = bindings.find(
        (candidate) => candidate.terminalAt !== undefined,
      );
      if (binding === undefined)
        return "No previous Task is bound to this conversation.";
      return this.queryBoundTask(binding, input);
    }

    const binding = await this.resolveAuthorizedBinding(input);
    if (binding === undefined) {
      return input.taskId === undefined
        ? input.intent === "query_active_task"
          ? "No active Task is bound to this conversation."
          : "No Task is bound to this conversation."
        : "That Task is not authorized for this conversation.";
    }
    return this.queryBoundTask(binding, input);
  }

  private async queryCapabilities(): Promise<string> {
    try {
      const client = await this.getClient();
      if (client.agentCard === undefined) {
        throw new Error("Current Agent Card projection is unavailable");
      }
      await this.persistAgentCard(client.agentCard, client.endpoint).catch(
        () => undefined,
      );
      return renderCapabilities(client.agentCard, false);
    } catch {
      const snapshot = await this.repository.getLatestAgentCardSnapshot();
      if (snapshot === undefined) {
        return "Current SDAR capabilities are unavailable and no safe Agent Card snapshot exists.";
      }
      return renderSnapshotCapabilities(snapshot);
    }
  }

  private async persistAgentCard(
    card: NormalizedAgentCard,
    endpoint: string,
  ): Promise<void> {
    const safeSkills = cloneJson(card.skills);
    await this.repository.saveAgentCardSnapshot({
      contentHash: hashJson(cloneJson(card)),
      protocolVersion: card.protocolVersion,
      specPatch: "1.0.1",
      binding: card.protocolBinding,
      safeSkills,
      sourceUrlHash: sha256(endpoint),
      observedAt: this.now().toISOString(),
    });
  }

  private async listBindings(
    input: Pick<QueryExecutionInput, "principalId" | "threadId">,
  ): Promise<readonly TaskBinding[]> {
    return this.repository.listTaskBindings({
      principalId: input.principalId,
      threadId: input.threadId,
      limit: 50,
    });
  }

  private async resolveAuthorizedBinding(
    input: QueryExecutionInput,
  ): Promise<TaskBinding | undefined> {
    if (input.taskId !== undefined) {
      return this.repository.findAuthorizedTask({
        principalId: input.principalId,
        threadId: input.threadId,
        sdarTaskId: input.taskId,
      });
    }
    const active = await this.repository.findActiveTask({
      principalId: input.principalId,
      threadId: input.threadId,
    });
    if (active !== undefined || input.intent === "query_active_task") {
      return active;
    }
    return (await this.listBindings(input))[0];
  }

  private async queryBoundTask(
    binding: TaskBinding,
    input: QueryExecutionInput,
  ): Promise<string> {
    const client = await this.getClient();
    const task = await client.getTask(binding.sdarTaskId, {
      signal: input.signal,
      ...(input.intent === "query_task_history" ? { historyLength: 100 } : {}),
    });
    if (
      task.taskId !== binding.sdarTaskId ||
      task.contextId !== binding.sdarContextId
    ) {
      throw new Error(
        "SDAR Task identity did not match the authorized binding",
      );
    }
    await this.repository.recordAuthorizedTaskObservation({
      principalId: input.principalId,
      threadId: input.threadId,
      sdarTaskId: task.taskId,
      status: task.state,
      ...(task.state !== "INPUT_REQUIRED"
        ? {}
        : {
            pendingInput: cloneJson({
              internalPhase: task.internalPhase ?? null,
              inputRequestId: task.inputRequestId ?? null,
            }),
          }),
      ...(task.statusTimestamp === undefined
        ? {}
        : { lastStatusTimestamp: task.statusTimestamp }),
      terminal: ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(
        task.state,
      ),
    });
    switch (input.intent) {
      case "query_active_task":
      case "query_task_status":
      case "query_previous_task":
        return renderTaskStatus(task);
      case "query_task_result":
        return renderTaskResult(task);
      case "query_task_history":
        return renderTaskHistory(task);
      case "query_allowed_actions":
        return renderAllowedActions(task);
      case "query_capability_gap":
        return renderCapabilityGap(task);
      default:
        throw new Error(`Unsupported bound Task query: ${input.intent}`);
    }
  }
}

function renderCapabilities(
  card: NormalizedAgentCard,
  degraded: boolean,
): string {
  const heading = degraded
    ? "SDAR capabilities (degraded last-known-good Agent Card):"
    : `SDAR capabilities from the current Agent Card (${card.name} ${card.version}):`;
  if (card.skills.length === 0) return `${heading}\n- No skills are published.`;
  return `${heading}\n${card.skills
    .map((skill) => {
      const description = safePublicText(skill.description, 1_000);
      return `- ${safePublicText(skill.name, 256) ?? skill.id}${description === undefined ? "" : `: ${description}`}`;
    })
    .join("\n")}`;
}

function renderSnapshotCapabilities(snapshot: AgentCardSnapshot): string {
  const skills = Array.isArray(snapshot.safeSkills) ? snapshot.safeSkills : [];
  const lines = skills.flatMap((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return [];
    const name = safePublicText(value.name, 256);
    const description = safePublicText(value.description, 1_000);
    if (name === undefined) return [];
    return [`- ${name}${description === undefined ? "" : `: ${description}`}`];
  });
  return [
    `SDAR capabilities (degraded last-known-good Agent Card; observed ${snapshot.observedAt}; not a readiness signal):`,
    ...(lines.length === 0 ? ["- No skills are published."] : lines),
  ].join("\n");
}

function renderBindingList(bindings: readonly TaskBinding[]): string {
  if (bindings.length === 0) return "No Tasks are bound to this conversation.";
  return [
    "Tasks authorized for this conversation:",
    ...bindings.map(
      (binding) =>
        `- ${binding.sdarTaskId}: ${binding.status}${binding.terminalAt === undefined ? " (active)" : ""}`,
    ),
  ].join("\n");
}

function renderTaskStatus(task: NormalizedTask): string {
  const statusText = renderMessage(task.statusMessage);
  return [
    `Task ${task.taskId} is ${task.state}.`,
    ...(task.internalPhase === undefined
      ? []
      : [`Internal phase: ${task.internalPhase}.`]),
    ...(task.phaseMessage === undefined
      ? []
      : [safePublicText(task.phaseMessage) ?? ""]),
    ...(statusText === undefined ? [] : [statusText]),
  ]
    .filter((value) => value.length > 0)
    .join("\n");
}

function renderTaskResult(task: NormalizedTask): string {
  if (task.artifacts.length === 0) {
    return `Task ${task.taskId} has no published result artifacts.`;
  }
  return [
    `Published result artifacts for Task ${task.taskId}:`,
    ...task.artifacts.map((artifact) => {
      const label = safePublicText(artifact.name, 256) ?? artifact.artifactId;
      const content = renderParts(artifact.parts);
      return `- ${label}${content === undefined ? "" : `: ${content}`}`;
    }),
  ].join("\n");
}

function renderTaskHistory(task: NormalizedTask): string {
  const history = task.history ?? [];
  if (history.length === 0)
    return `Task ${task.taskId} has no published history.`;
  return [
    `Published history for Task ${task.taskId}:`,
    ...history.flatMap((message) => {
      const rendered = renderMessage(message);
      return rendered === undefined ? [] : [`- ${message.role}: ${rendered}`];
    }),
  ].join("\n");
}

function renderAllowedActions(task: NormalizedTask): string {
  const actions = allowedActions(task);
  return actions.length === 0
    ? `Task ${task.taskId} currently has no allowed conversational actions.`
    : `Allowed actions for Task ${task.taskId}: ${actions.join(", ")}.`;
}

function allowedActions(task: NormalizedTask): readonly SdarFollowUpAction[] {
  if (task.state === "INPUT_REQUIRED") {
    if (task.internalPhase === "awaiting_plan_confirmation") {
      return ["confirm_plan", "reject_plan", "revise_plan", "patch_goal"];
    }
    if (task.internalPhase === "awaiting_user_input") return ["provide_input"];
    if (task.internalPhase === "paused") return ["resume", "cancel_goal"];
    return [];
  }
  if (["SUBMITTED", "WORKING"].includes(task.state)) {
    return ["patch_goal", "cancel_goal", "pause"];
  }
  return [];
}

function renderCapabilityGap(task: NormalizedTask): string {
  if (task.capabilityGap === undefined) {
    return `Task ${task.taskId} has no published capability gap.`;
  }
  const rendered = safePublicText(JSON.stringify(task.capabilityGap), 4_000);
  return `Published capability gap for Task ${task.taskId}: ${rendered ?? "unavailable"}`;
}

function renderMessage(
  message: NormalizedMessage | undefined,
): string | undefined {
  return message === undefined ? undefined : renderParts(message.parts);
}

function renderParts(parts: readonly NormalizedPart[]): string | undefined {
  const values = parts.flatMap((part) => {
    if (part.kind === "text") {
      const text = safePublicText(part.text, 4_000);
      return text === undefined ? [] : [text];
    }
    if (part.kind === "data") {
      const text = safePublicText(JSON.stringify(part.data), 4_000);
      return text === undefined ? [] : [text];
    }
    return [];
  });
  return values.length === 0 ? undefined : values.join(" ");
}

function cloneJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
