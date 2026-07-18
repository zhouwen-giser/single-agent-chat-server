# SDAR A2A client adapter

Status: Phase 3 implementation.

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
