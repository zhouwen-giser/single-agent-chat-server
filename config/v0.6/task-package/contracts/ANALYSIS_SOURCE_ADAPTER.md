# Contract — Analysis Source Adapter

## 1. Purpose

`AnalysisSourceAdapter` decouples SACS analysis-session orchestration from the upstream transport. It must represent the truth of the selected transport rather than force Grounding Job, Native Analysis and Fixture into one false WSGS Plan shape.

## 2. Required types

```ts
export const analysisSourceModes = [
  "WSGS_GROUNDING_JOB",
  "WSGS_NATIVE_ANALYSIS",
  "FIXTURE",
  "LEGACY_PLAN",
] as const;

export type AnalysisSourceMode =
  (typeof analysisSourceModes)[number];

export type WritableAnalysisSourceMode =
  Exclude<AnalysisSourceMode, "LEGACY_PLAN">;

export type AnalysisSourceIdentity =
  | {
      kind: "WSGS_GROUNDING_JOB";
      sourceId: string;          // groundingId
      sourceHash: string;        // canonical request hash
      upstreamRunId?: string;    // jobId
    }
  | {
      kind: "WSGS_NATIVE_ANALYSIS";
      sourceId: string;          // planId
      sourceHash: string;        // planHash
      sourceRevision: number;
      upstreamRunId?: string;
    }
  | {
      kind: "FIXTURE";
      sourceId: string;
      sourceHash: string;
      sourceRevision?: number;
      upstreamRunId?: string;
    }
  | {
      kind: "LEGACY_PLAN";
      sourceId: string;
      sourceHash: string;
      sourceRevision?: number;
      readOnly: true;
    };
```

`LEGACY_PLAN` may be returned by persistence for migrated rows. No public command, adapter or repository create method may accept it for a new revision.

## 3. Source request

```ts
export interface StartWorldAnalysisRequest {
  analysisId: string;
  revisionId: string;
  principalId: string;
  threadId: string;
  requestId: string;
  canonicalGroundingRequest: WsgsGroundingRequest;
  requestHash: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}
```

The adapter must recompute and verify `requestHash`; callers cannot supply a false hash.

## 4. Snapshot

```ts
export interface AnalysisSourceSnapshot {
  identity: AnalysisSourceIdentity;
  sourceStatus:
    | "ACCEPTED"
    | "RUNNING"
    | "COMPLETED"
    | "PARTIAL"
    | "AMBIGUOUS"
    | "UNRESOLVED"
    | "FAILED"
    | "CANCELLED";
  resultHash?: string;
  result?: WsgsGroundingResult;
  observedAt: string;
  terminal: boolean;
}
```

A snapshot is transport truth. SACS presentation status is derived separately.

## 5. Event

```ts
export interface AnalysisSourceEvent {
  eventId: string;
  analysisId: string;
  revisionId: string;
  runId: string;
  sourceIdentity: AnalysisSourceIdentity;
  sourceStatus: AnalysisSourceSnapshot["sourceStatus"];
  sourceSequence?: number;
  resultHash?: string;
  occurredAt: string;
  observedAt: string;
}
```

Grounding Job polling has no upstream event sequence. In that mode `sourceSequence` must be absent. A SACS-local durable analysis sequence may still be assigned by the repository.

## 6. Adapter methods

```ts
export interface AnalysisSourceAdapter {
  readonly mode: WritableAnalysisSourceMode;
  readonly productionEligible: boolean;

  start(
    request: StartWorldAnalysisRequest
  ): Promise<AnalysisSourceSnapshot>;

  get(
    identity: AnalysisSourceIdentity,
    signal?: AbortSignal
  ): Promise<AnalysisSourceSnapshot>;

  observe(
    input: {
      analysisId: string;
      revisionId: string;
      runId: string;
      identity: AnalysisSourceIdentity;
      after?: AnalysisSourceCursor;
      signal?: AbortSignal;
    }
  ): AsyncIterable<AnalysisSourceEvent>;

  cancel(
    input: {
      identity: AnalysisSourceIdentity;
      commandId: string;
      idempotencyKey: string;
      reason: "USER_REQUESTED" | "REVISION_RESTART";
      signal?: AbortSignal;
    }
  ): Promise<AnalysisSourceSnapshot>;

  revise(
    request: ReviseWorldAnalysisRequest
  ): Promise<AnalysisSourceSnapshot>;

  resolveChoice(
    request: ResolveWorldAnalysisChoiceRequest
  ): Promise<AnalysisSourceSnapshot>;
}
```

## 7. Grounding Job rules

- `start()` calls only `WsgsHttpClient.createGrounding`.
- A synchronous result is returned as a terminal snapshot.
- An asynchronous job is returned as `ACCEPTED`, `RUNNING` or its terminal status.
- `observe()` performs bounded polling using the durable Grounding ID.
- Repeated equivalent source state is not emitted twice.
- `revise()` and `resolveChoice()` build a new Grounding request and call `start()`; they do not mutate the old Grounding.
- `cancel()` calls `cancelGrounding()` and then keeps observing until source terminality is known.
- The exact WSGS request and idempotency key are stable across replay.

## 8. Native rules

The existing five Native ports may be adapted behind this interface. Native mode still requires the verified authoritative bundle. No Grounding Job implementation may bypass that requirement and call a guessed Native route.

## 9. Fixture rules

Fixture is permitted only with explicit test/development composition. Constructor and server bootstrap must reject Fixture when `NODE_ENV=production`.

## 10. Errors

Required stable errors:

```text
ANALYSIS_SOURCE_MODE_INVALID
ANALYSIS_SOURCE_IDENTITY_INVALID
ANALYSIS_SOURCE_REQUEST_HASH_MISMATCH
ANALYSIS_SOURCE_REPLAY_CONFLICT
ANALYSIS_SOURCE_TRANSPORT_UNAVAILABLE
ANALYSIS_SOURCE_RESPONSE_CONTRACT_VIOLATION
ANALYSIS_SOURCE_OBSERVATION_LIMIT_EXCEEDED
ANALYSIS_SOURCE_CANCEL_UNCONFIRMED
ANALYSIS_SOURCE_LEGACY_WRITE_FORBIDDEN
```
