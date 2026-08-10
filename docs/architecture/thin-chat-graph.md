# Thin single-agent chat graph

Status: Phase 2 implemented and verified.

The graph is deliberately a router and response composer, not a second SDAR.
Its linear nodes are normalize_request, classify_turn, respond_without_tools,
and compose_response.

## State boundary

The state holds messages, stable chat/user identifiers, the utility flag, one
optional active-task snapshot, the validated request kind, an optional
allowlisted follow-up action, response fragments, and a stable error code. It
does not contain Goal, Plan, Workflow, Skill, MCP Task, Provider, or Evidence
state.

## Classification order

1. Utility requests are handled locally.
2. Explicit status and top-level cancellation are deterministic.
3. Existing INPUT_REQUIRED tasks are guarded by internalPhase:
   awaiting_plan_confirmation, awaiting_user_input, and paused have different
   action mappings.
4. Explicit pause, resume, and goal-patch requests require an active task.
5. Remaining input uses the injected structured classification port.
6. Zod strict validation rejects unknown routes, unknown actions, extra fields,
   and inconsistent action/kind combinations.
7. An active task blocks a second new_task classification.

Invalid structured output fails closed to general_chat; it never creates an
arbitrary route or action.

## Model boundary

StructuredChatModel exposes only classify() and answer(). It has no tools, A2A
client, ReAct loop, workflow planner, or MCP access. The production default is a
stable local fallback because the task package does not freeze a model provider.
A configured provider can later implement this port without changing the
graph's deterministic guards or Zod validation.

## Phase boundary

Phase 2 only classifies and composes conversational text. For task-oriented
routes it explicitly states that no SDAR operation occurred. The official A2A
adapter is added in Phase 3.
