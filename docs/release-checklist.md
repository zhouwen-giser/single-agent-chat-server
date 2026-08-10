# v0.1.0 release checklist

## Local source review

- [x] Confirm `git diff --check` and the intended tracked diff.
- [x] Review the complete feature-branch history and current boundary.
- [x] Confirm no `.env`, credentials, runtime data, dependency tree, build
      output, or VCS metadata is tracked.
- [x] Confirm the product still serves one fixed SDAR only.

## Required final environment

- [x] PostgreSQL 16.9 with isolated databases.
- [x] Docker daemon and Compose.
- [x] Real pip Open WebUI 0.10.2 with signed user forwarding.
- [x] Exact SDAR `667146a` plus isolated PostgreSQL, Redis, and real MCP
      transport.
- [x] Current-source-head real-E2E manifest covering all 26 required scenarios.

## Commands

- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm peers check`
- [x] `pnpm format:check`
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test:unit`
- [x] `pnpm test:contract`
- [x] `pnpm test:integration` with zero skips
- [x] `pnpm test:e2e`
- [x] `pnpm test:security`
- [x] `pnpm build`
- [x] `pnpm smoke`
- [x] `pnpm verify:migrations`
- [x] `pnpm verify:architecture`
- [x] `pnpm verify:openai-api`
- [x] `pnpm verify:a2a`
- [x] `pnpm verify:openwebui`
- [x] `pnpm verify`

## Container and supply chain

- [x] Production Docker build.
- [x] Non-root, read-only, healthcheck, all capabilities dropped,
      `no-new-privileges`.
- [x] Clean Compose PostgreSQL startup and migration apply.
- [x] Compose cleanup left zero project resources.
- [x] Explicit advertised `0.0.0.0` endpoint override selected the configured
      route without silent rewrite.
- [x] Current CycloneDX SBOM and production license gate.
- [x] Secret-pattern scan and workflow static gate.

## Publication

- [x] Source and verifier fixes pushed to
      `feature/single-sdar-chat-entry-v0.1`.
- [x] Source commit `085e456` remote `quality` and `container` jobs passed.
- [ ] Push the Phase 13 documentation commit and confirm its exact checks.
- [ ] Update PR #1 and mark it Ready.
- [ ] Do not auto-merge; merge/tag/release only with explicit user authorization.
