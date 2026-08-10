import type { JsonValue } from "./types.js";

export type InteractionProtocol = "openai" | "ag_ui";
export type ClientType = "openwebui" | "ag_ui";

export interface Principal {
  readonly principalId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly role: string;
}

export interface ClientThreadBinding {
  readonly bindingId: string;
  readonly clientType: ClientType;
  readonly externalThreadId: string;
  readonly principalId: string;
  readonly threadId: string;
}

export interface InteractionRun {
  readonly runId: string;
  readonly protocol: InteractionProtocol;
  readonly principalId: string;
  readonly threadId: string;
  readonly externalRequestId: string;
  readonly status: "RUNNING" | "FINISHED" | "ERROR" | "INTERRUPTED";
  readonly taskId?: string;
  readonly contextId?: string;
  readonly lastSequence: number;
  readonly outcome?: JsonValue;
}

export interface InterruptBinding {
  readonly interruptId: string;
  readonly runId: string;
  readonly principalId: string;
  readonly threadId: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly internalPhase:
    "awaiting_plan_confirmation" | "awaiting_user_input" | "paused";
  readonly inputRequestId?: string;
  readonly status: "OPEN" | "RESOLVED" | "CANCELLED";
  readonly resolutionHash?: string;
  readonly version: number;
}

export interface AgentCardSnapshot {
  readonly snapshotId: string;
  readonly contentHash: string;
  readonly protocolVersion: string;
  readonly specPatch: string;
  readonly binding: string;
  readonly safeSkills: JsonValue;
  readonly sourceUrlHash: string;
  readonly observedAt: string;
}

export type InteractionRequestClaim =
  | { readonly outcome: "acquired"; readonly requestId: string }
  | { readonly outcome: "in_progress" }
  | { readonly outcome: "replay"; readonly resultTaskId?: string }
  | { readonly outcome: "conflict" };
