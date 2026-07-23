# Local owner handoff

## What is ready

The source, tests, operational scripts, documentation, Phase 12 evidence, and
Phase 13 blocked report are committed locally on
`work/local-phase12-phase13-handoff`. The six local commits after remote
`61fec2f` are:

1. `2124f21` — fix the Phase 11 formatting CI gate.
2. `5a0ad53` — reconcile Phase 11 handoff state.
3. `a93e953` — harden the single-agent chat boundary.
4. `daad45c` — record Phase 12 evidence.
5. `3d3b580` — add final acceptance commands and fixture.
6. `719572c` — prepare v0.1.0 local acceptance documentation.

The final evidence commit and exact archive SHA are recorded in the external
delivery manifest generated during packaging.

## What is not ready

This is a blocked local-review candidate, not a release candidate approved for
publication. Native PostgreSQL, Docker, Open WebUI, SDAR, Redis, and MCP
transport are unavailable in the Work-mode workspace. The integration suite
skipped 35 database cases, current-head real E2E did not run, container and
Compose checks did not run, and no current-head SBOM was generated.

Remote GitHub Actions: NOT RUN FOR LOCAL HEAD

No push, PR edit/comment, workflow rerun, tag, release, merge, or other GitHub
write was performed. `origin` retains `NO_PUSH_ALLOWED` as its push URL.

## Owner review and unblock steps

1. Verify the ZIP with its `.sha256` companion and delivery manifest.
2. Unpack into an empty directory and review the complete diff from `61fec2f`.
3. Supply isolated PostgreSQL 16, Docker/Compose, real Open WebUI 0.10.2, SDAR
   `667146a`, and its real Redis/MCP dependencies.
4. Generate current-head real scenario evidence and run every item in
   `docs/release-checklist.md`, with zero required skips.
5. Confirm `pnpm verify` passes, including current image/SBOM.
6. Only after approval, restore a deliberate push URL and push the reviewed
   commits to `feature/single-sdar-chat-entry-v0.1`.
7. Confirm remote `quality` and `container` jobs pass at that exact SHA.
8. Manually update PR #1 using `OWNER_PR_UPDATE_DRAFT.md`; do not auto-merge.
