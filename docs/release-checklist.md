# v0.1.0 release checklist

## Local source review

- [ ] Verify archive SHA-256 and unpack into an empty directory.
- [ ] Confirm `git diff --check` and a clean tracked tree.
- [ ] Review every local commit after remote baseline `61fec2f`.
- [ ] Confirm no `.env`, credentials, runtime data, dependency tree, build
      output, or VCS metadata is in the archive.
- [ ] Confirm the product still serves one fixed SDAR only.

## Required final environment

- [ ] Native PostgreSQL 16 with an isolated database.
- [ ] Docker daemon and Compose.
- [ ] Real Open WebUI 0.10.2 with signed user forwarding.
- [ ] Real SDAR at commit `667146a` plus its required Redis/MCP dependencies.
- [ ] Current-head real-E2E evidence JSON covering all scenarios required by
      `scripts/verify-openwebui.mjs`.

## Commands

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm peers check`
- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test:unit`
- [ ] `pnpm test:contract`
- [ ] `pnpm test:integration` with zero required skips
- [ ] `pnpm test:e2e`
- [ ] `pnpm test:security`
- [ ] `pnpm build`
- [ ] `pnpm smoke`
- [ ] `pnpm verify:migrations`
- [ ] `pnpm verify:architecture`
- [ ] `pnpm verify:openai-api`
- [ ] `pnpm verify:a2a`
- [ ] `pnpm verify:openwebui`
- [ ] `pnpm verify`

## Container and supply chain

- [ ] Production Docker build.
- [ ] Non-root, read-only, healthcheck, all capabilities dropped,
      `no-new-privileges`.
- [ ] Clean Compose database startup and migrations.
- [ ] Compose cleanup of only project resources.
- [ ] CycloneDX SBOM and production license gate.
- [ ] Secret/credential scan and workflow static gate.

## Owner-only remote actions

- [ ] Push reviewed commits to `feature/single-sdar-chat-entry-v0.1`.
- [ ] Confirm remote `quality` and `container` jobs pass at the pushed SHA.
- [ ] Update PR #1 from the local draft.
- [ ] Decide manually whether the PR can leave Draft.
- [ ] Do not auto-merge; merge/tag/release only with explicit authorization.
