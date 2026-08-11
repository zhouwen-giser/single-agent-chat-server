# P06 completion

Status: `PASSED`

P06 replaces the mapping placeholder with a strict two-stage public projection:
normalized A2A facts become typed `SdarInteractionEvent` records, and the same
event spine can be rendered by both the existing OpenAI adapter and the new
official AG-UI event projection. The mapper is scoped to one run and one
authorized Task/context pair. It emits `task.bound` plus a state/activity
snapshot before any delta and rejects changed Task identity or delta-before-
snapshot input.

Task state, phase, Artifact text/JSON/HTTPS references, Capability Gap,
phase-specific allowed actions, `INPUT_REQUIRED`, and bounded observation end
have explicit mappings. AG-UI state deltas are RFC 6902 operations. Run finish
and Task terminal state remain independent; the mapper does not cancel,
resubscribe, poll, or infer an event cursor.

Custom events are constructed from the frozen catalog field-by-field. Secret-
like JSON keys are recursively redacted, oversized JSON is replaced by a
bounded marker, URL references require HTTPS without credentials, and Raw A2A
parts are dropped. The AG-UI profile cannot emit Raw, Tool, reasoning, internal
MCP, or internal skill events. A reusable typed-event AG-UI run handler is now
available for the P07/P08 interaction runtime.

Implementation commit `b3d53e1186dc0fa244910c0e6d75569bea32e963` was
pushed and matched the remote feature head before this evidence commit. Final
P06 verification passed: unit 63/63, contract 35/35, PostgreSQL integration
43/43, security 8/8, plus format, lint, LangGraph path, typecheck, build,
architecture, four migrations, built-server smoke, and diff checks. Three
failed required attempts are retained without relabeling.
