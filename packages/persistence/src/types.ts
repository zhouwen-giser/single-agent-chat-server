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
  readonly shortId?: string;
  readonly status: string;
  readonly pendingInput?: JsonValue;
  readonly lastStatusTimestamp?: string;
  readonly lastEventHash?: string;
  readonly terminalAt?: string;
  readonly lastInteractedAt?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly version: number;
}

export interface StartupReconciliation {
  readonly activeBindings: readonly TaskBinding[];
  readonly recoveredClaimCount: number;
  readonly recoveredSubmissionSlotCount: number;
  readonly recoveredTaskInteractionSlotCount: number;
}
