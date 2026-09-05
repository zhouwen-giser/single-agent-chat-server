# Project status

Status: `SACS_V05_FEATURE_COMPLETE`.

The active v0.5 decision is split into independent tracks on
`codex/sacs-v0.5-observer-first-interactive-analysis`:

- DEVELOPMENT: `SACS_V05_FEATURE_COMPLETE`; all 38 active development rows
  pass through the source-bound development Gate, including focused contracts,
  real PostgreSQL, and eight actual HTTP/AG-UI local E2E scenarios.
- INTEGRATION: `SACS_V05_INTEGRATION_PENDING` because the authoritative WSGS
  analysis-control handoff is not published; this does not block development.
- RELEASE: `SACS_V05_RELEASE_HARDENING_PENDING` because release qualification
  was not requested.

The R2 progressive task package passed its official integrity preflight with
seven schemas, ten phases, and 60 active acceptance rows (38 development, 12
integration, 10 release). The prior 418-row global qualification and its
reports are retained only as `SUPERSEDED_STRICT_QUALIFICATION`; they no longer
drive the active product decision. Active evidence is limited to the four JSON
reports under
[`reports/v0.5/progressive`](reports/v0.5/progressive/PROGRESSIVE_STATUS.json).

Production remains fail-closed: fixture analysis is restricted to explicit
test/development composition, while the normal server continues to withhold
AG-UI v0.3 and Analysis Control until a real compatible adapter is composed.
The implementation matrix records the fetched `06c2864` D00 reconciliation
baseline; the source-bound development report records the complete tested
worktree independently.

The detailed v0.4 S00–S05 history below is retained as historical evidence. The
later S06–S12 development closure is recorded in
[`S12-completion.md`](reports/v0.4/S12-completion.md); it must not be inferred
from the older phase summaries.

S00 locks actual fetched SACS main `f60083c`, WSGS candidate `3f9aa7c`, and
SDAR main `b0caf69`. All 32 frozen `sacs-wsgs-grounding/1.0` artifact hashes
match. WSGS nevertheless declares a blocked candidate with 195 PASS,
17 NOT_RUN, and 67 BLOCKED and withholds every required readiness/completion
marker except `GOWM_0_6_3_CONTRACT_LOCKED`. Current SDAR does not declare or
consume `sacs-sdar-operational-grounding/1.0`.

The repaired WSGS branch now contains all referenced Development Ready evidence:
63/63 PASS, a real fourteen-stage pipeline, R1-R6, recovery, and an exact SACS
handoff. It is recorded as `VERIFIED_DEVELOPMENT_READY`. Because its report also
states `productionQualified=false` and omits the task-book Stable Candidate
markers, it does not override the final promotion blocker.

See [S00 acceptance](reports/v0.4/S00-acceptance.json),
[completion report](reports/v0.4/S00-completion.md), and
[publication status](reports/v0.4/S00-publication.md). No WSGS v0.1, fixture,
text downgrade, or unimplemented SDAR extension is counted as real integration.

S01 freezes a bounded v0.4 TurnPlan, deterministic WSGS request-plan ownership,
a validated/non-stale OperationalGroundingBundle, and separated SDAR-plan,
WSGS/GOWM-reality, SACS-composition authorities. Its 17/17 contract suite,
executable authority Gate, 76-file architecture Gate, and typecheck pass. See
[S01 acceptance](reports/v0.4/S01-acceptance.json) and
[S01 completion](reports/v0.4/S01-completion.md). Exact functional commit
`33541ca` passed both GitHub quality and container CI; see
[S01 publication](reports/v0.4/S01-publication.md). Runtime remains on the
qualified v0.3 path until later integration phases.

S02 implements the deterministic TurnPlan-to-WSGS mapping and the only isolated
WSGS HTTP adapter. Its 12/12 contract tests cover fixed routes, capability
locking, transport-only authentication, authority-field rejection, bounded
polling, cancellation, and error redaction. This is injected-transport contract
evidence, not a live WSGS E2E claim. See
[S02 acceptance](reports/v0.4/S02-acceptance.json) and
[S02 completion](reports/v0.4/S02-completion.md).

S03 adds append-only migration 0010 and a durable seven-state grounding
lifecycle with composite request authorization, unique WSGS/grounding/SDAR
reservation identities, immutable outputs/events, terminal closure, and
expired-lease recovery. Its 11/11 static contracts, 3/3 real PostgreSQL groups,
and full 92/92 integration regression passed with zero database skips. See
[S03 acceptance](reports/v0.4/S03-acceptance.json) and
[S03 completion](reports/v0.4/S03-completion.md). Server construction, live
WSGS traffic, and SDAR grounding submission remain later work and are not
claimed by this phase.

S04 activates strict v0.4 TurnPlan routing in both production entry paths and
constructs the isolated WSGS runtime. Safe world answers use only published
strict result fields, ambiguity never auto-selects, NO_DATA never becomes an
absence conclusion, and durable replay avoids a second WSGS POST. The
OperationalGroundingBundle builder accepts only live validated references and
explicit ambiguity confirmation. Current SDAR grounding submission returns the
exact extension-unavailable code before either external call and never
downgrades to text or an ungrounded Task. See
[S04 acceptance](reports/v0.4/S04-acceptance.json) and
[S04 completion](reports/v0.4/S04-completion.md).

S04 passed 9/9 phase tests, the 116-unit/121-contract/93-real-PostgreSQL/12-
security/1-fixture-E2E repository baseline, 0.4.0 container and isolated
Compose Gates, and CycloneDX SBOM generation. Its WSGS response is an injected
Fetch fixture through production adapter code, not live WSGS E2E. World-focus
capsule assembly remains later work.

S05 implements a read-only, unique-Task Authority Fusion Preview. SDAR plan
state is read only through official A2A `getTask()` and bounded published
fragments; WSGS/GOWM reality must be completed, unambiguous, evidence-bearing,
and tied to one world version; SACS composes the two authorities without
inferring equivalence, contradiction, or execution outcome. Durable replay
avoids a second WSGS POST and no hybrid path submits, follows up, or cancels a
Task. See [S05 acceptance](reports/v0.4/S05-acceptance.json) and
[S05 report](reports/v0.4/S05-completion.md).

S05 passed 16/16 phase tests and the updated 122-unit/121-contract/94-real-
PostgreSQL/12-security/1-fixture-E2E baseline. The genuine combined Gate is
BLOCKED: an isolated real SDAR A2A Task failed before plan publication without
a model Provider, and the safety gate requires explicit authorization for this
SACS task before local model and GOWM test credentials may be loaded into
temporary SDAR/WSGS processes. `AUTHORITY_FUSION_PREVIEW_READY` is withheld.
The rebuilt 0.4.0 image and isolated Compose Gate pass; the final S05 CycloneDX
SBOM contains 3718 components.

SACS v0.3 remains the qualified release candidate represented by merged main
commit `f60083c` and PR #14. Authorized S00 publication created
[Draft PR #15](https://github.com/zhouwen-giser/single-agent-chat-server/pull/15);
its initial `8aee956` head passed both quality and container CI and remained
`OPEN`, `Draft`, `MERGEABLE`, and `CLEAN`. Codex has not made the PR Ready,
merged, tagged, released, deployed, or modified WSGS/GOWM/SDAR/SMPP.
