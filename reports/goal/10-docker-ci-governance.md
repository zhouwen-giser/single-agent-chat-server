# Phase 10 Docker, CI, and governance report

Generated: 2026-07-19T08:04:05+08:00

## Result

Phase 10 container deployment, repository governance, local CI-equivalent
verification, semantic commit, push, and remote GitHub Actions gates are
complete.

## Delivered

- multi-stage Node.js 22.14.0 production image with pnpm 11.13.1
- production-only runtime dependencies, non-root `node` user, and healthcheck
- Compose server plus PostgreSQL 16.9 with loopback-only publication
- read-only server filesystem, bounded `/tmp`, dropped capabilities, and
  no-new-privileges
- isolated backend and documented external Open WebUI frontend network
- explicit migration command, environment template, Make targets, and scripts
- pinned GitHub Actions SHAs, Dependabot, CODEOWNERS, and release policy
- frozen dependency, peer, architecture, production-license, container, and
  CycloneDX SBOM gates

## Complete gate actually run

- `TEST_DATABASE_URL=... pnpm verify:phase10`: passed
  - format, ESLint, LangGraph config, typecheck, and build: passed
  - unit: 5 suites, 27 tests passed
  - contract: 2 suites, 25 tests passed
  - integration: 3 suites, 35 tests passed, including 34 real PostgreSQL tests
  - architecture: 41 production source files passed
  - production licenses: 84 entries; Apache-2.0, BSD-3-Clause, ISC, MIT
- `pnpm install --frozen-lockfile`: passed
- `pnpm peers check`: passed
- `docker build --target runtime`: passed
- container metadata: `user=node`; healthcheck present
- `git diff --check`: passed

## Real container and clean-database smoke

The Compose stack started from a new named volume. PostgreSQL became healthy,
the server returned `/ready` with configuration and PostgreSQL both `ok`, and
the empty database received three application migrations. Five `chat_service`
tables and four `langgraph_checkpoint` tables were present. Runtime identity was
`uid=1000(node)`, and a write probe under `/app` returned
`read-only-confirmed`. `docker compose down --volumes --remove-orphans` removed
all project containers, volumes, and networks; a post-cleanup query found zero
of each.

Final image ID:
`sha256:cd7f74a5fdf2e87842bb9138ecb13e46d911de6b781be9e7456a9f41e55756c4`.
The CycloneDX 1.7 SBOM contains 3706 components, has SHA-256
`bf01c58791a5b70764368b50a95717e768a29938117e33475d734ae47bdfa21a`,
and contained no tested local paths or temporary secrets.

## Remote CI

Both push and pull-request workflow runs passed their `quality` and `container`
jobs. The Dependabot configuration check also passed. Draft PR #1 was open,
clean, and pointed at the exact phase commit when captured.

## Boundaries and honest E2E state

The container smoke used real PostgreSQL and the real built server image. SDAR
was deliberately not required for readiness, and no real SDAR or Open WebUI to
SDAR vertical-slice claim is made before Phase 11.

## Publication state

- Head before phase commit: `49540f2b3989e1c71c1899acce603ca705b69257`
- Phase commit: `d8fade106e80cfd36998403225380cae99277413`
- Feature push: succeeded
- Draft PR #1: open, draft, clean, exact head captured
- Blockers: none
- Next phase: Phase 11 real SDAR and Open WebUI E2E
