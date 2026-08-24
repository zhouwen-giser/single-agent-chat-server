# SDAR A2A client adapter

Status: Phase 9 trusted single-SDAR fail-closed boundary.

The package at packages/sdar-a2a-adapter is the only production boundary that
imports the official A2A SDK. It pins @a2a-js/sdk 1.0.0-beta.0 (Apache-2.0) and
registers only RestTransportFactory. JSON-RPC, gRPC, and v0.3 compatibility are
not enabled.

## Discovery and endpoint policy

The adapter fetches /.well-known/agent-card.json and accepts only an interface
whose protocolBinding is HTTP+JSON and protocolVersion is 1.0. The application
version field on the card is ignored for compatibility.

SDAR_A2A_ENDPOINT_OVERRIDE is optional and explicit. When present, the adapter
copies the validated card, replaces the selected HTTP+JSON interface URL, and
calls ClientFactory.createFromAgentCard. When absent, it uses the exact
advertised URL. It never rewrites 0.0.0.0 or another host silently.

The fixed SACS→SDAR link is an unauthenticated trusted-network profile. The
Agent Card and every Skill must have empty security requirements. A required
scheme fails client creation. If the SDK later publishes
`TASK_STATE_AUTH_REQUIRED`, normalization throws the typed, sanitized
`UNEXPECTED_A2A_AUTH_REQUIRED` deployment error before the Coordinator can
persist state, poll, create an Interrupt, or request credentials.

## Exposed operations

The stable internal interface exposes only submitTaskStream, sendFollowUp,
getTask, and cancelTask. These map one-to-one to the permitted SDK methods
sendMessageStream, sendMessage, getTask, and cancelTask.

Initial Message metadata permits only user_id and reliable structured_input.
Existing-task Message metadata permits only sdar_action, input_request_id, and
user_id. Data is accepted only for provide_input and is limited to one Part.

SDK Task, Message, status event, and Artifact types are normalized before they
leave the package. The normalized snapshot retains task/context IDs, state,
published status text/timestamp, internalPhase, phaseMessage, errorCode,
capabilityGap, nextAction, and text/JSON artifacts.

## Timeout and stream boundary

Agent Card discovery and every operation have AbortSignal timeouts. Caller abort
signals are combined with the configured timeout. A stream ending while the
normalized Task is WORKING is not treated as terminal and does not cancel the
Task; callers use getTask polling within their own request budget.

## Production task coordination

The production server creates the SDK client lazily on the first SDAR-bound
turn. PostgreSQL readiness and utility/local chat remain available when SDAR is
temporarily unreachable; a failed discovery is not cached permanently.

New-task submission claims the protocol-neutral northbound request key before
calling `sendMessageStream`. Completion stores exactly one normalized result.
A Task result contains its `taskId` and `contextId`; a Message-only result
contains the bounded Agent Message and exact rendered assistant text. Replaying
the latter performs no A2A or `getTask` call. If a stream emits Message
fragments before a Task appears, the fragments are still published and stored
but the final request result is the Task. Exact repeated Task events are cached
and suppressed from progress streaming, while an explicit status query always
renders its current authorized snapshot.

Published `status.message` text and `phaseMessage` become Markdown fragments.
Terminal Artifact text is returned directly and JSON data is rendered in a
bounded code block. Skill, MCP, Workflow, plan, and hidden-reasoning nodes are
never synthesized.

## Follow-up and terminal interaction

`INPUT_REQUIRED` is an interaction boundary, not ordinary WORKING state. The
published `internalPhase` and optional `input_request_id` are persisted with the
binding. Plan confirmation accepts only explicit `confirm_plan`, `reject_plan`,
`revise_plan`, or `patch_goal`; user-input waits accept only `provide_input`;
paused waits accept only `resume`. Working tasks permit explicit `pause`,
`patch_goal`, or optional `cancel_goal`. Wrong phase/action combinations are
rejected before the adapter is called.

Follow-up uses the existing `taskId` and `contextId` through adapter
`sendFollowUp`, which maps only to SDK `sendMessage`. Top-level cancellation
uses adapter `cancelTask` and displays the exact returned Task state without
inferring lower-level Provider shutdown.

An A2A Follow-up may validly return a Task or a direct Agent Message. A direct
Message completes the request as `MESSAGE`, retains the related Task identity,
and is replayed exactly without refreshing a Task whose state may since have
changed.

The shared Coordinator accepts no implicit current-Task mutation. Follow-up and
Cancel require an authorized full `taskId`, acquire only that binding's lease,
and compare both Task and Context identity on every A2A Task result. Status and
directory listing do not acquire mutation leases.

FAILED tasks with published `capabilityGap`, `CAPABILITY_GAP`, or
`internalPhase=capability_gap` are distinguished from ordinary business
failure. Published error codes are allowlisted, text and Artifact content are
bounded and secret-like values are redacted, and protocol exceptions never
reach OpenAI SSE clients verbatim.
