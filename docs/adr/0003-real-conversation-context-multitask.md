# ADR 0003: real conversation model, durable context, and multi-Task chat

Status: Accepted for SACS v0.3 P01

## Context

SACS v0.2 is a dual-northbound gateway with a thin rule-based chat graph and at
most one active SDAR Task per Chat. Production uses a local regex/fixed-text
fallback, conversation history is not a protocol-neutral PostgreSQL authority,
and a completed interaction request is represented by an optional Task ID.

v0.3 must support natural multi-turn conversation and multiple independent
active Tasks without turning SACS into a second SDAR or giving a model execution
authority.

## Decision

### Configured real conversation model

Production uses one process-configured OpenAI-compatible Chat Completions
endpoint. The model may decide a strict `TurnDecision`, answer ordinary chat,
summarize conversation text, and explain already-published safe results. It has
no tools, functions, A2A client, database, URL fetch, shell, MCP, SMPP, Provider,
or device access. Base URL, model name, and key are startup configuration only.
Missing or invalid production model configuration fails readiness; regex and
fixed-text models are explicit test fixtures only.

All model output is untrusted data:

```text
model output
  -> strict local schema validation
  -> deterministic Task selector
  -> principal/thread/task/context authorization
  -> phase/action validation
  -> exactly one fixed A2A client operation
```

### Server-authoritative durable context

OpenAI and AG-UI import messages into one protocol-neutral PostgreSQL
conversation log. Stable external IDs and content hashes deduplicate repeated
client history. The server persists the text actually published to the user as
assistant messages. Summary plus recent messages, bounded Task Directory,
Focus, and the current user message form the model context. Original messages
are retained; summaries use optimistic versioning and never replace Task truth.

### One Chat to many active Tasks

The one-active-Task partial unique index and implicit single-row repository APIs
are removed by append-only migration. A configurable limit defaults to eight.
New Task submission uses a short Chat lease for count-and-submit; Follow-up and
Cancel use a Task-binding lease, allowing different Tasks in one Chat to proceed
independently.

Task Directory ordering is deterministic. Focus and last-reference state aid
conversation only and never grant authority. The model proposes exactly one
bounded `TaskSelector`; deterministic local code resolves and authorizes it.
Unqualified read-only status lists all active Tasks. An ambiguous mutation
returns candidates and performs no A2A call.

### TASK or MESSAGE completed result

An A2A interaction completes atomically with exactly one result:

- `TASK`: Task and context identity are present.
- `MESSAGE`: normalized safe Message and stable rendered text are present; Task
  identity is optional relation metadata.

Message replay returns the persisted result without model, A2A, or `getTask()`
calls. If a stream publishes Message events and later creates a Task, the final
request result is `TASK` while published Messages remain event/conversation
history.

### Trusted single-SDAR A2A and no internal AUTH_REQUIRED

One lazy cached provider constructs one client from fixed startup configuration
after Agent Card validation. SACS never accepts a request-, model-, history-, or
Artifact-selected endpoint and never calls SDAR management, database, SMPP,
MCP, Provider, or device interfaces.

The trusted isolated SACS-to-SDAR path adds no interactive authentication flow.
Internal Task state excludes `AUTH_REQUIRED`. If the official SDK emits
`TASK_STATE_AUTH_REQUIRED`, normalization throws a typed
`UNEXPECTED_A2A_AUTH_REQUIRED` deployment/protocol error, stops polling, and
does not persist an interrupt or ask the user for credentials. Northbound
service keys, JWTs, principal/thread/task authorization, rate limits, CORS, and
redaction remain mandatory.

## Migration and compatibility

- Existing migrations `0001` through `0006` are immutable.
- Append-only migrations add conversation messages/summaries, multi-Task focus
  and leases, and the request-result union after data backfill.
- Empty install and representative v0.2 in-place upgrade are both required.
- OpenAI predecessor routes and official AG-UI event ordering remain compatible.
- Existing Task, Run, Interrupt, and principal/thread bindings remain valid.

## Consequences

The graph remains a thin orchestration shell. PostgreSQL becomes authoritative
for conversation/reference/idempotency state but never for SDAR domain truth.
Model failures cannot silently trigger business work. More storage and
coordination code are required, but restart recovery, stable replay, and precise
multi-Task authorization become testable contracts.
