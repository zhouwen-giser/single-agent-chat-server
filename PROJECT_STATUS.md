# Project status

Status: `QUALIFIED_RELEASE_CANDIDATE` — final publication status is the
**P14 exact-head publication receipt** on
[PR #14](https://github.com/zhouwen-giser/single-agent-chat-server/pull/14).

P00–P13 are complete. Candidate `9cb0db0` passed the full zero-skip real-model,
real-SDAR multi-Task, upgrade/restart, network, regression, Docker, Compose and
SBOM gate. P13 evidence commit `838c9e7` passed Push and PR CI. See
[P13 acceptance](reports/v0.3/P13-acceptance.json).

P14 synchronized latest main `9734ba2` and prepared the final documents.
Its final-head rerun, CI and Ready transition occur after the containing
commit, and are recorded in the PR receipt to preserve the tested SHA. Until a
`PASSED_READY` receipt exists, final publication is pending. See
[P14 report](reports/v0.3/P14-completion.md) and
[publication policy](reports/v0.3/P14-publication.md).

The SDAR process/main same-tree discrepancy is an explicit operator waiver,
not runtime commit attestation. Qualification never confirmed a device plan.
PR #13 was previously merged by the user; Codex has not merged any PR, tagged,
created a GitHub Release, deployed production or changed SDAR/SMPP upstreams.
