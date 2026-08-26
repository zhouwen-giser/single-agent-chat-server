# P14 historical prerequisite blocker

P13 was qualified on 2026-08-26 at candidate `9cb0db0`; its complete gate passed
with zero required skips. The historical prerequisites below are resolved.
P14 final-head qualification and Ready publication remain separate work.
See [P13 completion](P13-completion.md).

- Status: `BLOCKED_ENVIRONMENT`
- Current incomplete prerequisite: P13
- P14 preparation head: `630a630cda050e72b9cab1e798b87f4d9d4d7a83`
- Current SACS pre-source-lock head: `94ef72a2f0082e5dd656f670d023646757592e5a`
- Latest `origin/main`: `9734ba21c0903f560866e349cc3a163f12108ed7`
- Timestamp UTC: `2026-08-25T04:20:24.388Z`

## Exact blocker

P14 cannot publish final release-candidate evidence or mark a replacement PR Ready
because P13 AC-040 through AC-042 remain incomplete. The genuine model gate has
passed. The current A2A 1.0 SDAR accepts anonymous metadata-free `text/plain`
UGV submissions and enters its new natural-language admission path, but the
deployment reached `INPUT_REQUIRED` with `awaiting_plan_confirmation` and did
not execute immediately after authority refresh. During the later aggregate
gate, that authority had expired and the first Task failed closed. The remaining
precondition is fresh exact-candidate real-SDAR evidence followed by strict
reuse validation in the complete P13 gate.

The running SDAR source is clean PR-head commit
`68e05ea4d55666f7007b63edd59f32187c2aeeeb`, while SDAR remote `main` is
`1d5aafd0a2c8324d8d0ac3cf33eebcb3c12aec6b`. Their Git trees are identical,
The user explicitly directed the goal to continue despite those differing
commit identities because the trees are identical. Final evidence must disclose
both SHAs rather than claiming exact process identity. See
`P13-blocked-environment.md` for the sanitized official-client observations.

The user merged PR #13 on `2026-08-24T23:59:14Z` before P13/P14 completion.
That user-controlled merge is not represented as release completion. Remaining
source-lock, evidence and release-candidate changes require a replacement PR;
Codex did not merge, tag, release or deploy anything.

## Work completed despite blocker

- Aligned the private product/package, default image tag, Compose, OCI label,
  container verifier, and SBOM verifier to SACS `0.3.0`.
- Updated README, changelog, project status, operations, release checklist,
  governance, troubleshooting, Open WebUI multi-Task guidance, and P13
  qualification documentation.
- Added the v0.3 feature branch to push CI while retaining PR CI and pinned
  actions.
- Fetched latest `origin/main`; it is already an ancestor of the preparation
  head, so no merge, rebase, or conflict resolution is needed.
- Locally passed the complete available `verify:ci` chain: 100 unit, 78
  contract, 89 PostgreSQL integration twice, 22 OpenAI predecessor, 12
  security, 35 AG-UI, 146 dedicated acceptance, one fixture E2E, plus build,
  smoke, migration, architecture, workflow, license, and secret gates with zero
  required skips.
- Built `single-agent-chat-server:0.3.0`; container metadata, isolated
  Compose/readiness/migration/cleanup, and CycloneDX 1.7 generation passed. The
  tracked SBOM contains 3,718 components and SHA-256
  `cc46f943ada7f6c529974439fb981b84b58a7745d230b51a631285a1bdde3acf`.
- Exact preparation-head push CI run `32513481057` passed quality job
  `96869729481` and container job `96870397127`.
- Exact preparation-head PR CI run `32513485570` passed quality job
  `96869744900` and container job `96870478458`.

## Required acceptance criteria not satisfied

- P13 AC-039 through AC-042 genuine real-model/current-SDAR/upgrade-restart/
  network evidence.
- P13 completion, acceptance, and publication artifacts.
- P14 complete exact-head `pnpm verify:v03` with zero required skips.
- Final release candidate report and machine-readable acceptance artifact.
- Final `chore(p14): publish SACS v0.3 release candidate evidence` commit and
  its exact-head CI.
- Replacement Draft-to-Ready transition; PR #13 is already user-merged.

## Exact recovery steps

1. Publish the strict exact-candidate real-SDAR evidence-reuse workflow and
   obtain green exact-head CI on replacement Draft PR #14.
2. Refresh the SDAR authority, immediately run the individual real-SDAR gate,
   then run the complete gate with reuse explicitly enabled.
3. Set `P13_EXPECTED_SACS_SHA` and `P13_CI_RUN_URL` for the exact clean final
   candidate, clear stale ignored evidence, and run `pnpm verify:v03`.
4. Review and publish P13 reports only after all five real evidence documents
   pass with required skips equal to zero.
5. Fetch `origin/main` again, rerun the full final gate, generate the P14 final
   report/acceptance/publication artifacts, and push the required final commit.
6. Confirm local head, remote branch, PR head, evidence SHA, and green CI are
   identical; only then mark the replacement PR Ready. Do not merge it.

## Integrity statement

No fixture, mock, skipped test, old commit evidence, or fabricated result was
used to satisfy the blocked real gate. No merge, tag, GitHub Release, or
production deployment was performed.
