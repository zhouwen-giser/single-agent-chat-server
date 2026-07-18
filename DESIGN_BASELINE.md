# single-agent-chat-server v0.1 Design Baseline — R2

## 1. Product role

`single-agent-chat-server` is a conversational entrance for exactly one configured SDAR A2A agent.

```text
Open WebUI
  → /v1/chat/completions
  → thin LangGraph Chat Graph
  → SDAR A2A 1.0 HTTP+JSON Client
  → SDAR
```

It is not an Agent Mesh, a generic agent host, or a second SDAR runtime.

## 2. Frozen decisions

| ID | Decision |
|---|---|
| D-01 | The service targets one configured SDAR Agent only. |
| D-02 | Open WebUI remains an external UI and connects through OpenAI-compatible APIs. |
| D-03 | Use a maintained LangGraph.js project template; archived `create-agent-chat-app` is reference-only. |
| D-04 | SDAR interaction is A2A-only through an isolated official SDK adapter. |
| D-05 | Pin SDAR compatibility to A2A spec patch 1.0.1, wire 1.0, HTTP+JSON, `@a2a-js/sdk@1.0.0-beta.0`. |
| D-06 | The chat graph routes conversation and explains published state only; SDAR owns Goal, Skill, planning, execution and evidence. |
| D-07 | PostgreSQL stores checkpoints, identity mappings, task bindings, idempotency and last observed status; it does not copy SDAR execution state. |
| D-08 | A2A streams are bounded. A nonterminal stream end is followed by `getTask()` polling; no event cursor or arbitrary task resubscription is assumed. |
| D-09 | Every existing-task message is an explicit, validated SDAR Follow-up action; arbitrary next-turn forwarding is forbidden. |
| D-10 | Mesh, Registry, AG-UI, MCP, Skill Center and Evaluation are out of v0.1 scope. |

## 3. SDAR A2A compatibility baseline

Inspected upstream:

```text
repository: https://github.com/zhouwen-giser/skill-driven-agent-runtime
main commit: 667146a3639eefdfed9b89c2417c08e1ac50e9a9
spec patch: 1.0.1
wire: 1.0
binding: HTTP+JSON
sdk: @a2a-js/sdk@1.0.0-beta.0
agent card: /.well-known/agent-card.json
default endpoint: /a2a
streaming: true
push notifications: false
authentication: none in current SDAR V1.1
```

Do not implement old `tasks/*` RPC names. Use:

```text
ClientFactory.createFromUrl / createFromAgentCard
sendMessageStream
sendMessage
getTask
cancelTask
```

The Agent Card application `version` may be `0.0.0`; do not use it for compatibility decisions. Validate `supportedInterfaces[].protocolBinding` and `protocolVersion` instead.

## 4. Follow-up contract

Supported `metadata.sdar_action` values:

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

Follow-up metadata may contain only:

```text
sdar_action
input_request_id (optional)
user_id (optional)
```

`provide_input` may include text and at most one data Part. There is no generic `updateTask()` operation.

## 5. Minimal graph

```text
START
  → normalize_request
  → utility_task_guard
  → load_binding
  → refresh_active_task_if_needed
  → classify_turn
      ├─ general_chat → local_answer
      ├─ new_sdar_task → send_message_stream
      ├─ task_status → get_task_and_explain
      ├─ task_follow_up → validate_phase_action → send_message
      └─ task_cancel → cancel_task
  → observe_or_poll_within_budget
  → persist_turn_state
  → stream_response
  → END
```

No ReAct loop is needed unless a later ADR proves it necessary.

## 6. State boundary

```ts
interface SingleAgentChatState {
  messages: unknown[];
  threadId: string;
  userId: string;
  openWebUiChatId: string;
  requestKind?:
    | "utility"
    | "general_chat"
    | "new_task"
    | "status"
    | "follow_up"
    | "cancel";
  followUpAction?:
    | "confirm_plan"
    | "reject_plan"
    | "revise_plan"
    | "patch_goal"
    | "cancel_goal"
    | "provide_input"
    | "pause"
    | "resume";
  activeTask?: {
    taskId: string;
    contextId: string;
    state: string;
    internalPhase?: string;
    phaseMessage?: string;
    inputRequestId?: string;
    lastStatusTimestamp?: string;
    lastEventHash?: string;
  };
  responseFragments: string[];
  lastError?: { code: string; message: string };
}
```

SDAR remains authoritative.

## 7. State interpretation

```text
queued                                           → SUBMITTED
normal execution phases                          → WORKING
awaiting_plan_confirmation / awaiting_user_input → INPUT_REQUIRED
paused                                           → INPUT_REQUIRED
completed                                        → COMPLETED
canceled                                         → CANCELED
failed / invalidated / capability_gap             → FAILED
```

`INPUT_REQUIRED` alone is insufficient. The graph must inspect `Task.metadata.internalPhase` before choosing a Follow-up action.

## 8. Stream policy

- Consume `sendMessageStream()` for a new task or Follow-up.
- Publish only real Task/status message text as OpenAI-compatible deltas.
- SDAR may end its A2A stream after about 30 seconds while the Task remains `WORKING`.
- If nonterminal, poll `getTask()` within the current Chat request budget.
- Close the Chat stream at `CHAT_STREAM_MAX_DURATION_MS` without canceling SDAR.
- Later turns query the persisted binding with `getTask()`.
- Do not assume an event cursor, replay endpoint or arbitrary task subscription.
- Final results come from the `result` Artifact text and JSON Parts.

## 9. Docker endpoint policy

```text
SDAR_A2A_BASE_URL=http://sdar:9999
SDAR_A2A_ENDPOINT_OVERRIDE=http://sdar:9999/a2a
```

Fetch and validate the Agent Card first. Apply an endpoint override only when explicitly configured, by copying the validated card and replacing the selected HTTP+JSON interface before `createFromAgentCard()`. Never silently rewrite endpoints.

## 10. Security

- Validate the Open WebUI service API key and signed user identity.
- Authorize every Task operation by local `(user_id, chat_id, task_id)` binding.
- Current SDAR A2A has no authentication; keep it on a trusted isolated network.
- Never accept a user-provided SDAR endpoint or Task ID without local authorization.
- Do not log prompts, credentials, full artifacts or hidden reasoning by default.
- Add request/body/event size limits, timeouts and rate limits.
