# Project status

Status: `P13_PASSED_P14_PENDING`

P00–P13 qualification is complete. Exact published candidate
`9cb0db08c8f2e3ba89757f07ffb9ecaf2c5f84cb` passed the full `verify:v03`
gate with zero required skips: genuine model, real SDAR multi-Task, migration
and SACS/PostgreSQL restart, network boundary, regression, container, Compose
and SBOM. See [P13 completion](reports/v0.3/P13-completion.md) and
[acceptance](reports/v0.3/P13-acceptance.json).

Replacement [PR #14](https://github.com/zhouwen-giser/single-agent-chat-server/pull/14)
remains Draft on `feature/sacs-v0.3-general-conversation-multitask` until P14
final-candidate qualification and publication CI. PR #13 was merged by the user
before these phases completed; that merge was not release qualification.

The SDAR process/remote-main same-tree discrepancy is an explicit operator
waiver, not a claim of runtime commit attestation. No device plan was confirmed
or executed by the qualification scenarios.

Codex has not merged a PR, created a tag/GitHub Release, deployed production,
or modified the SDAR/SMPP upstream repositories.
