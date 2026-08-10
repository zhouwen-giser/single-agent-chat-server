export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export const followUpActionValues = [
  "confirm_plan",
  "reject_plan",
  "revise_plan",
  "patch_goal",
  "cancel_goal",
  "provide_input",
  "pause",
  "resume",
] as const;
export type SdarFollowUpAction = (typeof followUpActionValues)[number];

export type NormalizedTaskState =
  | "UNSPECIFIED"
  | "SUBMITTED"
  | "WORKING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "INPUT_REQUIRED"
  | "REJECTED"
  | "AUTH_REQUIRED";

export interface NormalizedPart {
  readonly kind: "text" | "data" | "url" | "raw";
  readonly mediaType: string;
  readonly text?: string;
  readonly data?: JsonValue;
  readonly url?: string;
}

export interface NormalizedMessage {
  readonly messageId: string;
  readonly taskId?: string;
  readonly contextId?: string;
  readonly role: "USER" | "AGENT" | "UNSPECIFIED";
  readonly parts: readonly NormalizedPart[];
}

export interface NormalizedArtifact {
  readonly artifactId: string;
  readonly name?: string;
  readonly description?: string;
  readonly parts: readonly NormalizedPart[];
}

export interface NormalizedTask {
  readonly taskId: string;
  readonly contextId: string;
  readonly state: NormalizedTaskState;
  readonly statusMessage?: NormalizedMessage;
  readonly statusTimestamp?: string;
  readonly internalPhase?: string;
  readonly inputRequestId?: string;
  readonly phaseMessage?: string;
  readonly errorCode?: string;
  readonly capabilityGap?: JsonValue;
  readonly nextAction?: string;
  readonly artifacts: readonly NormalizedArtifact[];
}

export type NormalizedSendResult =
  | { readonly kind: "task"; readonly task: NormalizedTask }
  | { readonly kind: "message"; readonly message: NormalizedMessage };

export type NormalizedStreamEvent =
  | { readonly kind: "task"; readonly task: NormalizedTask }
  | { readonly kind: "message"; readonly message: NormalizedMessage }
  | {
      readonly kind: "status";
      readonly taskId: string;
      readonly contextId: string;
      readonly state: NormalizedTaskState;
      readonly message?: NormalizedMessage;
      readonly timestamp?: string;
      readonly internalPhase?: string;
      readonly inputRequestId?: string;
      readonly phaseMessage?: string;
      readonly errorCode?: string;
      readonly nextAction?: string;
      readonly capabilityGap?: JsonValue;
    }
  | {
      readonly kind: "artifact";
      readonly taskId: string;
      readonly contextId: string;
      readonly artifact: NormalizedArtifact;
      readonly append: boolean;
      readonly lastChunk: boolean;
    };

export interface SubmitTaskInput {
  readonly messageId: string;
  readonly text: string;
  readonly userId?: string;
  readonly structuredInput?: JsonValue;
}
export interface FollowUpInput {
  readonly messageId: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly action: SdarFollowUpAction;
  readonly text: string;
  readonly inputRequestId?: string;
  readonly userId?: string;
  readonly data?: JsonValue;
}
export interface OperationOptions {
  readonly signal?: AbortSignal;
}
export interface SdarA2aClient {
  readonly protocolBinding: "HTTP+JSON";
  readonly protocolVersion: "1.0";
  readonly endpoint: string;
  submitTaskStream(
    input: SubmitTaskInput,
    options?: OperationOptions,
  ): AsyncGenerator<NormalizedStreamEvent, void, undefined>;
  sendFollowUp(
    input: FollowUpInput,
    options?: OperationOptions,
  ): Promise<NormalizedSendResult>;
  getTask(
    taskId: string,
    options?: OperationOptions & { readonly historyLength?: number },
  ): Promise<NormalizedTask>;
  cancelTask(
    taskId: string,
    options?: OperationOptions,
  ): Promise<NormalizedTask>;
}
