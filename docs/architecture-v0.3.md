# SACS v0.3 target architecture

This document is the implementation draft governed by
[ADR 0003](adr/0003-real-conversation-context-multitask.md).

```text
Open WebUI / official AG-UI client
                 |
       authenticated northbound adapters
                 |
       Conversation Application Service
       - message ingest and deduplication
       - bounded context assembly
       - configured general model
       - strict TurnDecision validation
       - Task Directory, Focus, resolver
       - deterministic authorization
                 |
       Multi-Task Interaction Runtime
       - submit/list/status
       - explicit follow-up/cancel
       - TASK | MESSAGE request result
       - Chat submission / Task interaction leases
                 |
       one isolated fixed A2A adapter
                 |
               one SDAR
```

## Authority map

| Fact                                                | Authority                                      |
| --------------------------------------------------- | ---------------------------------------------- |
| Principal, client/thread binding                    | SACS PostgreSQL                                |
| User/assistant messages and summaries               | SACS PostgreSQL                                |
| Task binding, Focus, last reference, request result | SACS PostgreSQL                                |
| A2A Task state, result, and published metadata      | SDAR through A2A                               |
| Provider/Resource/Action state                      | SDAR/SMPP/Provider, published through SDAR     |
| Natural-language explanation                        | configured model, explicitly non-authoritative |

## Shared request path

1. Authenticate service and principal.
2. Resolve the internal thread and ingest/deduplicate client messages.
3. Load summary, recent messages, bounded Task Directory, Focus, and reference.
4. Ask the configured model for a strict `TurnDecision`.
5. Validate locally, resolve the Task deterministically, and authorize the full
   principal/thread/task/context tuple.
6. Answer locally or execute one allowed operation through the fixed A2A client.
7. Persist an atomic `TASK | MESSAGE` request result when A2A was used.
8. Persist the assistant text actually published and update reference/Focus.
9. Render through OpenAI or AG-UI without changing the shared semantics.

Utility/background Open WebUI requests remain deterministic and cannot call the
model for business routing, create an SDAR Task, or change Focus.

## Package boundaries

- `apps/server/src/chat/conversation-application-service.ts`: the shared
  conversation application boundary. It owns context preparation, the thin
  graph invocation, deterministic Task resolution/reference updates, and
  explicit Coordinator dispatch. Northbound runners translate protocol
  envelopes and render results; they do not classify or route independently.
  AG-UI imports every supported official message ID and uses the same service;
  its runner only projects typed Coordinator observations into AG-UI events.

- `packages/conversation-model`: model port, strict TurnDecision contracts, and
  fixed OpenAI-compatible client with bounded timeout/retry/readiness. It has no
  tool surface and accepts no request-level endpoint.
- `packages/conversation-context`: protocol-neutral conversation types, stable
  client-history reconciliation, bounded assembly, and optimistic rolling
  summarization. Assembly reserves space for the current user turn, then uses
  summary, newest non-overlapping messages, bounded Task summaries, Focus, and
  last reference in deterministic priority order. P03's
  `conversation_message` and `conversation_summary` are server-authoritative
  and independent of LangGraph checkpoint retention.
- `packages/task-directory`: Task summaries, selectors, and directory contract.
  P05 persists stable short IDs, Focus, last reference, deterministic active
  and recent lists, and Task-level mutation leases. P06 resolves only the
  model's schema-valid selector against that bounded directory: full Task ID,
  unique short ID, stable ordinal, Focus, latest/previous, unique bounded
  summary, or the sole active Task. Ambiguous mutations stop locally and emit a
  content-free `ambiguous_task_reference` counter; untargeted status renders
  the complete active directory.
- `packages/request-result`: strict completed-result union. A completed request
  contains exactly one bounded `TASK` or `MESSAGE` result. `MESSAGE` parts are
  normalized text, data, or HTTP(S) URL values; opaque SDK objects and raw
  protocol payloads are rejected.
- `packages/chat-runtime`: shared explicit multi-Task coordinator.
  Follow-up and Cancel require a full authorized `taskId`; status refresh also
  targets one Task, while `listTaskStatuses` is read-only. Mutations lease only
  the selected binding, so different Tasks progress concurrently. Every
  returned or polled Task is checked against both persisted Task and Context
  identity before Focus, persistence, observation, or publication.
- `packages/sdar-a2a-adapter`: the only official A2A SDK boundary.
  It maps no internal `AUTH_REQUIRED` state: the SDK enum throws a typed
  deployment mismatch, and Agent Cards requiring authentication fail client
  construction. Endpoint/Card selection exists only in startup configuration.

OpenAI and AG-UI adapters must not copy any conversation, selector, focus,
authorization, coordinator, or request-result implementation.

Client bindings for the same signed principal and external thread ID converge
on one internal Thread. Stable external message IDs are reconciled at that
Thread boundary, including when repeated history arrives through the other
northbound protocol. Each transport persists only assistant text it actually
publishes.

## Completed request results

Both northbound protocols use the same `interaction_request` repository and
the same `InteractionTaskCoordinatorRepository`. Completion writes the request
state, normalized result, rendered assistant text, and result hash in one
database transaction. PostgreSQL constraints reject a completed row with no
result, both result variants, or an incomplete variant.

A completed `MESSAGE` replays the exact stored rendered text without calling
the model, A2A, or `getTask`. A completed `TASK` first reauthorizes the stored
principal/thread/Task/Context tuple and may then refresh the Task through
`getTask`. If an initial A2A stream publishes Message fragments and later
creates a Task, the durable result is `TASK`; the earlier fragments remain
observable conversation events. A stream that ends without either a valid
Agent Message or Task remains claimed for bounded recovery rather than
inventing a result.

An AG-UI Run separately retains its optional Task/context association for event
recovery. That association never changes the completed-result discriminator:
a Task-associated Message is still replayed as `MESSAGE`. Restart recovery for
a `TASK` uses the Task recorded by that Run, never the Thread's Focus.
