# SDAR A2A compatibility

The v0.1 boundary is frozen:

| Item                | Required                                   |
| ------------------- | ------------------------------------------ |
| SDAR source         | `667146a3639eefdfed9b89c2417c08e1ac50e9a9` |
| Specification patch | `1.0.1`                                    |
| Wire protocol       | `1.0`                                      |
| Binding             | `HTTP+JSON`                                |
| SDK                 | `@a2a-js/sdk@1.0.0-beta.0`                 |
| Agent Card          | `/.well-known/agent-card.json`             |
| Required input      | `text/plain`                               |
| Required output     | `text/plain`, `application/json`           |
| Required capability | streaming                                  |

Only `sendMessageStream`, `sendMessage`, `getTask`, and `cancelTask` may operate
on SDAR Tasks. JSON-RPC, gRPC, legacy `tasks/*`, SDAR management APIs, the SDAR
database, MCP, event cursors, and arbitrary Task resubscription are unsupported.

An existing-Task message requires one allowlisted `metadata.sdar_action`.
Optional metadata is limited to `input_request_id` and `user_id`.
`INPUT_REQUIRED` is interpreted using published `internalPhase`:

- `awaiting_plan_confirmation`
- `awaiting_user_input`
- `paused`

The adapter rejects malformed/oversized Tasks, Messages, Artifacts, metadata,
timestamps, URLs, identity drift, incompatible modes, unknown states, and more
than 512 stream events. A nonterminal stream end uses bounded `getTask()`
polling without cancellation.

The trusted single-SDAR profile accepts only an Agent Card and Skills with empty
security requirements. `TASK_STATE_AUTH_REQUIRED` is not an internal Task
state: it throws `UnexpectedA2aAuthenticationStateError` with the stable code
`UNEXPECTED_A2A_AUTH_REQUIRED`, stops the operation before persistence or
polling, and never creates a credential prompt or Interrupt.

An explicit endpoint override is startup operator configuration, never user,
model, Message, Artifact, or request input.
It must remain on the configured SDAR origin. Any protocol or SDK upgrade
requires a new ADR, adapter fixtures, adversarial regression, and real E2E.

The source-level frozen baseline remains in
[`SDAR_A2A_COMPATIBILITY_BASELINE.md`](../SDAR_A2A_COMPATIBILITY_BASELINE.md).
