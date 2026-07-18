export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ThreadBinding {
  readonly threadId: string;
  readonly openWebUiChatId: string;
  readonly userId: string;
  readonly userRole: string;
}

export interface TaskBinding {
  readonly bindingId: string;
  readonly threadId: string;
  readonly sdarTaskId: string;
  readonly sdarContextId: string;
  readonly status: string;
  readonly pendingInput?: JsonValue;
  readonly lastStatusTimestamp?: string;
  readonly lastEventHash?: string;
  readonly terminalAt?: string;
  readonly version: number;
}

export type IdempotencyClaim =
  | { readonly outcome: "acquired" }
  | { readonly outcome: "in_progress"; readonly leaseUntil?: string }
  | { readonly outcome: "replay"; readonly resultTaskId: string }
  | { readonly outcome: "conflict" };

export interface StartupReconciliation {
  readonly activeBindings: readonly TaskBinding[];
  readonly recoveredClaimCount: number;
}
