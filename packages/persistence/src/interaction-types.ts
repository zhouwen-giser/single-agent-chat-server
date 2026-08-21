import type { JsonValue } from "./types.js";
import type { CompletedRequestResult } from "../../request-result/src/index.js";

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

export type InterruptInternalPhase =
  "awaiting_plan_confirmation" | "awaiting_user_input" | "paused";

export type InterruptReason =
  "sdar.plan_confirmation" | "sdar.input_required" | "sdar.paused";

export interface InterruptBinding {
  readonly interruptId: string;
  readonly runId: string;
  readonly principalId: string;
  readonly threadId: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly internalPhase: InterruptInternalPhase;
  readonly reason: InterruptReason;
  readonly inputRequestId?: string;
  readonly responseSchema?: JsonValue;
  readonly responseSchemaHash?: string;
  readonly expiresAt: string;
  readonly status: "OPEN" | "RESOLVING" | "RESOLVED" | "CANCELLED";
  readonly resolutionHash?: string;
  readonly resolutionClaimedAt?: string;
  readonly resolvedAt?: string;
  readonly version: number;
}

export type InterruptResolutionClaim =
  | { readonly outcome: "acquired"; readonly interrupt: InterruptBinding }
  | { readonly outcome: "replay"; readonly interrupt: InterruptBinding }
  | { readonly outcome: "in_progress"; readonly interrupt: InterruptBinding }
  | { readonly outcome: "conflict"; readonly interrupt: InterruptBinding }
  | { readonly outcome: "expired"; readonly interrupt: InterruptBinding }
  | { readonly outcome: "cancelled"; readonly interrupt: InterruptBinding }
  | { readonly outcome: "not_found" };

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
  | { readonly outcome: "replay"; readonly result: CompletedRequestResult }
  | { readonly outcome: "conflict" };
