# ADR 0002: dual northbound protocols, one interaction core

Status: Accepted for SACS v0.2 P01

## Context

SACS v0.1 exposes OpenAI-compatible chat for Open WebUI and delegates business
work to exactly one SDAR through the isolated A2A 1.0 HTTP+JSON adapter. v0.2
adds an official AG-UI HTTP/SSE entry point. A second coordinator, A2A adapter,
or client-owned task state would create conflicting authority and recovery
semantics.

## Decision

OpenAI and AG-UI are protocol adapters around one protocol-neutral interaction
application. Both consume the same typed `SdarInteractionEvent` stream. Only
the existing `packages/sdar-a2a-adapter` may import `@a2a-js/sdk` or perform
SDAR operations.

An HTTP request/AG-UI Run is one bounded interaction and observation window. It
is not an SDAR Task. A Task may survive multiple Runs, disconnects, and process
restarts. Consequently `RUN_FINISHED` or an SSE close never implies Task
completion or cancellation.

## AG-UI wire profile

- `POST /ag-ui` requires `Content-Type: application/json` (including structured
  `+json`) and returns `text/event-stream`. A missing `Accept` or `*/*` is
  treated as accepting SSE; an explicit incompatible `Accept` is rejected.
- `GET /ag-ui/capabilities` publishes the implemented bounded profile.
- Both routes use the existing service bearer and signed principal credential.
  Plain identity headers remain untrusted. CORS is deny-by-default and will be
  configured explicitly in the server phase.
- Exact `@ag-ui/core`, `@ag-ui/client`, and `@ag-ui/encoder` version `0.0.57`
  defines RunAgentInput, events, Interrupt, ResumeEntry, and encoding.
- The supported event profile is Run lifecycle, Text, State snapshot/delta,
  Activity snapshot/delta, and allowlisted Custom events.
- RAW, thinking/reasoning, and inferred tool-call events are rejected. Tool
  events require a future explicit versioned public SDAR contract and are not
  available in v0.2.
- State delta is RFC 6902 JSON Patch. Client state is input context, never SDAR
  authority.

## Interrupt and resume

An `INPUT_REQUIRED` Task becomes an official AG-UI interrupt only after the
server persists a principal/thread/task/context/phase binding. Resume entries
must resolve a currently open binding and must use the phase-specific SDAR
Follow-up action. Unknown, stale, duplicate, and cross-principal resumes fail
before A2A.

## Consequences

Protocol renderers cannot mutate SDAR, infer hidden reasoning, or recompute
Task status. The experimental `@ag-ui/a2a@0.0.6` remains reference-only because
it targets `@a2a-js/sdk ^0.2.2`, permits broader mapping behavior, and would
violate the single-adapter boundary.
