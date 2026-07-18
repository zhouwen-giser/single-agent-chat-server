# SDAR A2A Compatibility Baseline for single-agent-chat-server

## 1. Inspected upstream

```text
repository: https://github.com/zhouwen-giser/skill-driven-agent-runtime
branch: main
inspected commit: 667146a3639eefdfed9b89c2417c08e1ac50e9a9
inspection date: 2026-07-18
```

Relevant upstream files:

```text
package.json
third_party/a2a-1.0.1-baseline.json
third_party/sources.lock.yaml
packages/a2a-adapter/src/compatibility.ts
packages/a2a-adapter/src/http-endpoint.ts
packages/a2a-adapter/src/task-service-executor.ts
packages/a2a-adapter/src/task-mapping.ts
packages/a2a-adapter/src/postgres-task-store.ts
apps/example-a2a-client/src/client.ts
apps/server/src/environment.ts
scripts/verify-a2a-baseline.mjs
scripts/run-a2a-tck.mjs
reports/EP-01-protocol-domain-skeleton/a2a-tck-http-json-must-protocol-harness/compatibility.json
```

## 2. Frozen wire contract

| Property | Value |
|---|---|
| Specification patch | 1.0.1 |
| Wire protocol | 1.0 |
| SDK | `@a2a-js/sdk@1.0.0-beta.0` |
| Transport | HTTP+JSON / REST |
| Agent Card | `/.well-known/agent-card.json` |
| Task endpoint | `/a2a` |
| Streaming | true |
| Push notification | false |
| Authentication | none in current SDAR V1.1 |
| Default input mode | `text/plain` |
| Default output modes | `text/plain`, `application/json` |

The inspected SDAR report records 100% MUST compatibility for the HTTP+JSON TCK scope. JSON-RPC and gRPC are not mounted by SDAR's current HTTP endpoint and are not part of this project's acceptance target.

## 3. Client operations

```text
ClientFactory.createFromUrl(baseUrl)
ClientFactory.createFromAgentCard(card)
client.sendMessageStream(request)
client.sendMessage(request)
client.getTask(request)
client.cancelTask(request)
```

Do not model generic `updateTask()` or `subscribeEvents(taskId)` operations.

## 4. Initial Task Message

Required:

```text
ROLE_USER
at least one text/plain Part
unique messageId
```

Allowed first-version metadata:

```text
user_id: string (optional)
structured_input: JSON value (optional and only when reliable)
```

## 5. Existing Task Follow-up

A Follow-up reuses both `taskId` and `contextId` and requires `metadata.sdar_action`.

Allowed actions:

```text
confirm_plan
reject_plan
revise_plan
patch_goal
cancel_goal
provide_input
pause
resume
```

Strict metadata allowlist:

```text
sdar_action
input_request_id (optional)
user_id (optional)
```

For `provide_input`, the Message may carry text and at most one data Part. Data Parts are forbidden for other actions.

## 6. State interpretation

| SDAR internal phase | A2A state |
|---|---|
| `queued` | `SUBMITTED` |
| normal execution phases | `WORKING` |
| `awaiting_plan_confirmation` | `INPUT_REQUIRED` |
| `awaiting_user_input` | `INPUT_REQUIRED` |
| `paused` | `INPUT_REQUIRED` |
| `completed` | `COMPLETED` |
| `canceled` | `CANCELED` |
| `failed`, `invalidated`, `capability_gap` | `FAILED` |

Always retain `Task.metadata.internalPhase`, `errorCode`, `capabilityGap`, `status.message`, `status.timestamp`, `taskId`, and `contextId` in the local normalized snapshot.

## 7. Streaming behavior

The SDAR executor sends an initial Task and status updates, then finishes at an interaction boundary or after a bounded wait (default approximately 30 seconds). A stream may finish while the Task is still `WORKING`.

Required client behavior:

```text
sendMessageStream
  → consume Task/status events
  → if terminal or INPUT_REQUIRED: return to Chat
  → if stream ends while nonterminal: poll getTask
  → close Chat stream at local budget without canceling Task
  → later user turns continue through getTask or an explicit Follow-up
```

Do not assume replay cursors, event sequence cursors, or re-subscription by Task ID.

## 8. Result and failure interpretation

A completed Task may include the `result` Artifact with:

```text
text/plain
application/json
```

A Capability Gap is represented as A2A `FAILED` with structured metadata such as:

```text
internalPhase=capability_gap
errorCode=CAPABILITY_GAP
capabilityGap=...
nextAction=register-capability-and-submit-new-task
```

Do not collapse Capability Gap into a generic infrastructure error.

## 9. Cancellation boundary

Use `client.cancelTask()` for the top-level SDAR Task and display the Task state returned by SDAR. Do not infer that a lower-level remote MCP Provider has certainly stopped or released resources. That evidence belongs to SDAR and is not part of the current A2A projection.

## 10. Docker endpoint caveat

The current SDAR server may advertise its bind host in the Agent Card. When bound to `0.0.0.0`, this can produce an unusable URL.

Required explicit configuration:

```text
SDAR_A2A_BASE_URL=http://sdar:9999
SDAR_A2A_ENDPOINT_OVERRIDE=http://sdar:9999/a2a
```

The client must validate the downloaded card, copy it, apply the configured override to the selected HTTP+JSON interface, and use `createFromAgentCard()`. No silent rewrite is allowed.

## 11. Drift gate

Phase 0 must fail closed if the live Agent Card or checked SDAR source no longer matches this baseline. Codex may update the baseline only by:

1. recording the new SDAR commit;
2. adding an ADR;
3. updating the pinned SDK deliberately;
4. updating contract fixtures;
5. running real SDAR E2E;
6. recording the reason and evidence.
