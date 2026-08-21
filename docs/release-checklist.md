# v0.3.0 release-candidate checklist

## Source and product boundary

- [x] Feature branch derives from verified execution-time `origin/main`.
- [x] One fixed configured SDAR; no registry, mesh, endpoint selection, MCP,
      SMPP, or Provider client in SACS.
- [x] Frozen A2A 1.0 HTTP+JSON and SDK `1.0.0-beta.0` only.
- [x] Real configured conversation model has no tools or request endpoint
      authority and no production text/regex fallback.
- [x] OpenAI and AG-UI share durable context, Task Directory, Focus, selector,
      authorization, Coordinator, and `TASK | MESSAGE` result persistence.
- [x] Internal `AUTH_REQUIRED` is absent and unexpected SDK auth state fails
      closed without weakening northbound security.

## Available exact-head gates

- [x] format, lint, typecheck, build, architecture, workflow, migration,
      license, and secret gates.
- [x] unit, contract, security, PostgreSQL integration, OpenAI predecessor,
      official AG-UI, and deterministic fixture suites with zero required
      skips.
- [x] production Docker build and non-root/read-only/capability-dropped
      metadata.
- [x] isolated Compose readiness, migration, and project-scoped cleanup.
- [x] CycloneDX 1.7 SBOM generation.
- [x] exact functional-head quality and container CI.

## Blocked required real gates

- [ ] Genuine configured model multi-turn and strict TurnDecision evidence.
- [ ] Current locked SDAR two-active-Task, focus, precise operation, bounded
      recovery, disconnect, and domain-request evidence.
- [ ] v0.2-to-v0.3 data upgrade plus SACS/PostgreSQL restart on the exact final
      candidate using the genuine model configuration.
- [ ] Combined endpoint/network evidence and zero-skip evidence aggregation.
- [ ] P13 completion report, acceptance JSON, publication report, and exact
      evidence-commit CI.

The execution environment currently has no P13/model/SDAR variables or
operator-reviewed safe Task requests. This is `BLOCKED_ENVIRONMENT`; supporting
fixtures cannot check these boxes.

## Final P14 closure after unblocking

- [ ] Fetch latest `origin/main`, resolve source drift without rebase or
      force-push, and rerun the complete exact-head `pnpm verify:v03` gate.
- [ ] Confirm required skips are zero and local, remote branch, PR head, and all
      evidence SHAs are identical.
- [ ] Publish the final release report and machine-readable acceptance record.
- [ ] Push `chore(p14): publish SACS v0.3 release candidate evidence` and wait
      for exact-head quality/container CI.
- [ ] Mark Draft PR #13 Ready only after every required gate passes.
- [x] Preserve user control of merge; do not merge, tag, release, or deploy.

See [v0.3 qualification](release-candidate-v0.3.md),
[traceability](traceability-v0.3.md), and the exact
[environment blocker](../reports/v0.3/P13-blocked-environment.md).
