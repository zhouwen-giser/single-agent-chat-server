# Project status

Status: `SACS_V0_4_DEVELOPMENT_BLOCKED` — S00 and S01 are locally
implemented, while the v0.4 stable candidate is ineligible on external hard
prerequisites.

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

SACS v0.3 remains the qualified release candidate represented by merged main
commit `f60083c` and PR #14. Authorized S00 publication created
[Draft PR #15](https://github.com/zhouwen-giser/single-agent-chat-server/pull/15);
its initial `8aee956` head passed both quality and container CI and remained
`OPEN`, `Draft`, `MERGEABLE`, and `CLEAN`. Codex has not made the PR Ready,
merged, tagged, released, deployed, or modified WSGS/GOWM/SDAR/SMPP.
