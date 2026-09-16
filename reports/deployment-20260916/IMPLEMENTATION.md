# Development deployment implementation

Branch `codex/sacs-development-deployment`, based on existing v0.6 commit
0546a0a. Scope: independent SACS/PostgreSQL on sz-gowm, existing WSGS/SDAR/model
APIs, explicitly user-approved shared anonymous development identity. No
shared upstream mutation or device-execution acceptance is authorized here.

Default authentication is unchanged. Anonymous access requires both explicit
switches and assigns only the fixed user role, ignoring client identity/JWT.
All four business route groups use the same mode. Wire contracts are unchanged.

Packaging requires clean committed source, includes fixed-image identities,
migration hashes, environment defaults and SHA-256 checksums, and excludes real
configuration. Remote installer owns only sacs-dev, keeps private credentials
and data outside releases, separates PG env from model secrets, preserves
configuration on reinstall, backs up its own DB before upgrades and refuses
schema-incompatible application rollback. Existing WSGS model fields are
imported on the remote host only.

Initial checks: TypeScript PASS; anonymous/config tests 10 PASS; tooling and
anonymous tests 6 PASS after permitting local Python execution (the sandbox
initially returned EPERM). Lint has existing warnings, no errors. Full CI first
stopped on 14 previously committed generated integration receipts; only their
format-ignore paths were added, preserving all historical bytes. Full rerun,
offline build and remote checks are recorded separately upon completion.

Local full `pnpm verify:ci` subsequently passed with isolated PostgreSQL.
GitHub run 35071751332 quality passed; its container build, container checks
and Compose checks passed, but SBOM generation exposed an obsolete 0.5.0
image/version assertion. SBOM now derives both defaults from package.json.
Local Compose validation was blocked by exhausted Docker network pools;
unrelated networks were not pruned. GitHub provides the Compose evidence.

Remote preflight confirmed WSGS 1.2 and frozen-file checks, then identified
the deployed SDAR's JSON-only advertised output. SACS already validates JSON
Parts; output negotiation now uses the intersection of advertised and supported
text/JSON formats, including both submit and follow-up requests. Unsupported
formats remain rejected; A2A binding, version, origin and authentication checks
are unchanged. A2A contract regression: 12 PASS; typecheck PASS. No SDAR task
was submitted. Package tamper/missing/extra/symlink rejection is also tested.

No claim of complete v0.6 advanced analysis, free time windows, production
authentication, tenant isolation or physical-device execution is made.
