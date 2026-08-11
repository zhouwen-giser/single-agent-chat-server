# P07 completion

Status: `PASSED`

P07 implements durable, phase-specific AG-UI Interrupt/Resume behavior for
`awaiting_plan_confirmation`, `awaiting_user_input`, and `paused`. Official
Interrupt outcomes use the frozen reasons, exact allowed actions, durable
expiry, optional public response schema, and exact `inputRequestId`. The
interrupt binding is persisted only after principal/thread/Task/context
authorization and before the event can reach Run finish projection.

Migration `0005_interrupt_resume.sql` evolves the published schema append-only
with reason, response schema/hash, expiry, `RESOLVING`, and claim timestamps.
Resolution follows durable `OPEN -> RESOLVING -> A2A Follow-up -> RESOLVED`.
Same completed hash replays without mutation; changed content conflicts; an
uncertain network result stays `RESOLVING`, so restart cannot automatically
resend. Local official cancellation sends no A2A call and never infers Task or
Goal cancellation.

The authenticated `/ag-ui` endpoint parses official `RunAgentInput.resume` and
routes non-empty Resume input through the protocol-neutral service. Payloads
have a strict field/action allowlist and optional fail-closed public JSON Schema
validation. Before claim, the service uses authorized `getTask()` to revalidate
current Task/context, `INPUT_REQUIRED`, phase, and input request ID. Follow-up
uses the existing frozen adapter and stable A2A Message ID.

Implementation commit `a7a3a84cb99af3e9731432cd3ddf7274802bd987` was
pushed and matched the remote feature head before this evidence commit. Final
P07 verification passed: unit 70/70, contract 37/37, PostgreSQL integration
45/45, security 8/8, format, lint, LangGraph paths, typecheck, build,
architecture over 55 source files, 5 migrations, built-server smoke, and diff
checks. Eleven failed required attempts are retained.
