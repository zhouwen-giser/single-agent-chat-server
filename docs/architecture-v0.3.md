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
  and recent lists, and Task-level mutation leases; P06 adds deterministic
  selector resolution.
- `packages/request-result`: strict completed-result union; P08 adds persistence
  and replay.
- `packages/chat-runtime`: shared explicit multi-Task coordinator.
- `packages/sdar-a2a-adapter`: the only official A2A SDK boundary.

OpenAI and AG-UI adapters must not copy any conversation, selector, focus,
authorization, coordinator, or request-result implementation.
