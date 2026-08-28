# Project status

Status: `SACS_V0_4_DEVELOPMENT_BLOCKED` — S00 is locally implemented, while
the v0.4 stable candidate is ineligible on external hard prerequisites.

S00 locks actual fetched SACS main `f60083c`, WSGS candidate `7ba29dc`, and
SDAR main `b0caf69`. All 32 frozen `sacs-wsgs-grounding/1.0` artifact hashes
match. WSGS nevertheless declares a blocked candidate with 195 PASS,
17 NOT_RUN, and 67 BLOCKED and withholds every required readiness/completion
marker except `GOWM_0_6_3_CONTRACT_LOCKED`. Current SDAR does not declare or
consume `sacs-sdar-operational-grounding/1.0`.

The WSGS branch also contains a `DEVELOPMENT_READY` summary, but 7 evidence
artifacts referenced by that summary are absent from its exact Git tree. It is
recorded as `UNVERIFIED_MISSING_ARTIFACTS` and does not override the blocked
stable-candidate report.

See [S00 acceptance](reports/v0.4/S00-acceptance.json),
[completion report](reports/v0.4/S00-completion.md), and
[publication status](reports/v0.4/S00-publication.md). No WSGS v0.1, fixture,
text downgrade, or unimplemented SDAR extension is counted as real integration.

SACS v0.3 remains the qualified release candidate represented by merged main
commit `f60083c` and PR #14. Authorized S00 publication created
[Draft PR #15](https://github.com/zhouwen-giser/single-agent-chat-server/pull/15);
its initial `8aee956` head passed both quality and container CI and remained
`OPEN`, `Draft`, `MERGEABLE`, and `CLEAN`. Codex has not made the PR Ready,
merged, tagged, released, deployed, or modified WSGS/GOWM/SDAR/SMPP.
