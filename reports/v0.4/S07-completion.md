# SACS v0.4 S07 multi-turn world-focus runtime

## Decision

S07 passes. SACS_CONVERSATION_WORLD_FOCUS_READY is supported by the production
context assembler, deterministic PendingChoice continuation, focus update
policy, expired-reference revalidation, and real PostgreSQL evidence.

## Runtime behavior

GroundingContextAssembler reads only the authorized principal and Thread focus
and emits the five exact frozen WSGS Context Capsule arrays requested by
TurnPlan.worldFocusUsage. Normal World Answer requests cannot inherit
Fusion-only correlation hints or predicates. Missing requested context fails
with the typed context-unavailable result.

COMPLETED results absorb valid references. PARTIAL results absorb only safe,
non-ambiguous, non-expired references. AMBIGUOUS results create one bounded
OPEN PendingChoice without activating a candidate. UNRESOLVED, FAILED, and
CANCELLED results leave Focus unchanged. Revision compare-and-swap protects
material updates and replay recognizes an already-applied result.

Pending choice input is local and deterministic: exact ordinal forms or an
exact display name may select a candidate. Semantic descriptions remain a
clarification instead of becoming a second grounding authority. An ordinal
without an OPEN choice returns WORLD_GROUNDING_NO_PENDING_CHOICE and performs
zero WSGS requests.

After selection, the runtime restores the persisted original user Message,
TurnPlan, and GroundingRequestPlan. It first invokes VALIDATE_REFERENCES with
the selected frozen KnownWorldReference, then resumes the original world query.
The control text is never used as the WSGS world-query source. Expired or stale
Focus references follow the same validate-before-reuse rule.

## Production wiring and persistence

OpenAI and AG-UI share one WorldGroundingRuntime, Conversation repository, and
WorldFocus repository. Continuation is checked before model classification, so
"第二个" cannot be reclassified as a fresh world request. Original messages
are loaded through a principal/Thread-authorized repository query. Restarted
repositories recover durable Focus and PendingChoice state.

## Validation

The S07 phase suite passed 34/34 tests. It includes unit and contract tests plus
real PostgreSQL integration that exercises initial ambiguity, exact selection,
VALIDATE_REFERENCES, original-source restoration, resumed execution, no-choice
zero-query behavior, expired-reference revalidation, durable Focus update, and
OpenAI/AG-UI shared Thread behavior.

The complete integration suite passed 100/100 with zero database skips.
Migration validation reported 11 contiguous append-only files. Architecture
checked 82 production source files. Lint passed with zero warnings, and
typecheck, build, format, and diff checks passed.

The HTTP WSGS responses in S07 are injected through the production adapter and
are not represented as live WSGS evidence. Genuine live WSGS multi-turn proof
is reserved for S08.

## Publication boundary

The local semantic phase commit is permitted by the repository workflow.
Push and Draft PR #15 updates remain withheld until direct user authorization;
no merge, tag, release, or deployment is performed.
