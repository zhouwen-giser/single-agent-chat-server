# P14 release-candidate report

Status at commit: `QUALIFIED_AWAITING_POST_COMMIT_GATES`.

## Delivered scope

- SACS product/package/image/OCI metadata is 0.3.0; pinned A2A remains wire 1.0,
  HTTP+JSON, official SDK 1.0.0-beta.0. No A2A v0.3 compatibility was added.
- README, changelog, operations, Open WebUI guidance, security, release policy,
  qualification, traceability and project status describe the implemented model,
  durable context, multi-Task selection, exact results and trusted single SDAR.
- P13 candidate `9cb0db0` passed the complete real and container gate with zero
  required skips. Evidence commit `838c9e7` passed Push/PR CI
  `32925165630` / `32925168899`.
- On 2026-08-26, `git fetch origin main` and ancestry verification confirmed
  latest main `9734ba21c0903f560866e349cc3a163f12108ed7` is already included.
  SDAR/SMPP remain locked to `1d5aafd` / `b6f0f64`; no upstream files changed.
- P14 changes only documentation and publication records. The runtime, tests,
  migrations, lockfile, container and CI configuration remain as qualified.

## Required post-commit publication

This committed report cannot contain its own Git SHA or future CI results.
Therefore its completion receipt is published on
[PR #14](https://github.com/zhouwen-giser/single-agent-chat-server/pull/14)
under **P14 exact-head publication receipt**, after these actions actually pass:

1. Push the final candidate without rewriting history; bind configuration to that SHA.
2. Archive old evidence, run the real SDAR scenario for the new SHA, then execute
   the complete `verify:v03` gate with exact-candidate reuse and legal command-only
   model settings. No prior-head real evidence can satisfy this step.
3. Verify clean local HEAD, remote feature branch and PR HEAD match every real
   evidence document; verify latest-main ancestry and both successful CI runs.
4. Publish a sanitized receipt with exact SHAs, evidence/log/SBOM hashes, real
   scenario timestamps, commands, exit status and zero skips.
5. Mark the PR Ready only then, re-read its actual state and publish the final
   `PASSED_READY` machine-readable receipt. Do not make another commit afterward.

Until that receipt exists, AC-044 and the overall goal remain pending. Once it
exists, it supersedes this pre-publication status without changing the tested SHA.

## Evidence and limitations

P13 acceptance records the genuine model and SDAR tests. Live SDAR proof used
safe, unconfirmed plans plus read-only Task operations; effectful operations
remain contract/PostgreSQL coverage, not claimed device execution. Compose's
readiness fixture is explicitly separate from genuine model evidence. Network
proof is architecture/configuration inspection, not packet capture.

The user's same-tree SDAR process-SHA waiver remains disclosed in P13 acceptance;
the public Card does not attest a running Git SHA. Binding revision and unchanged
Catalog/snapshot are operator statements, not SACS Management API observations.

No PR merge, tag, GitHub Release, production deployment, SDAR/SMPP repository
change, plan confirmation or device execution is authorized by this delivery.
