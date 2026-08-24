# P12 local gate retries

Status: `NON_EVIDENCE_FAILED_ATTEMPTS`

## Initial static gate

- Result: lint passed, then TypeScript rejected the database-URL redaction
  expression and the refactored idempotency claim union.
- Cause: the regular expression escaped a colon, and the generic transaction
  callback widened discriminant literals before the observation hook.
- Resolution: remove the invalid escape and bind the transaction result to
  `InteractionRequestClaim`. The failed run is not acceptance evidence.

## Initial architecture gate

- Result: formatting, lint, and type checking passed; the strengthened
  architecture scan found two production SDAR client construction sites.
- Cause: the lazy-client helper retained an unused default factory in addition
  to the process entry-point factory.
- Resolution: require factory injection in the lazy helper. Production now has
  exactly one construction site in `apps/server/src/main.ts`. The failed run is
  not acceptance evidence.

## Initial focused security gate

- Result: formatting passed; lint rejected four unnecessary test-string
  escapes before the focused suites ran.
- Cause: the expected escaped Markdown brackets used single rather than
  literal backslashes in JavaScript strings.
- Resolution: express the expected literal backslashes correctly. The failed
  run is not acceptance evidence.

## First SBOM generator image pull

- Result: the application image built and passed its metadata gate, but the
  first `anchore/syft:v1.48.0` pull ended with an unexpected EOF before SBOM
  generation.
- Cause: the Docker registry layer transfer was truncated; no application or
  dependency verification failed.
- Resolution: retry the pinned scanner image pull and generate the CycloneDX
  document only after Docker verifies the complete image. The failed run is
  not acceptance evidence.

## Sandboxed license inventory rerun

- Result: the post-SBOM license rerun could not open pnpm's global metadata
  SQLite file inside the workspace sandbox.
- Cause: the store database is outside the writable sandbox; the same gate had
  already passed in the authoritative escalated run.
- Resolution: rerun the unchanged license command with read access to the pnpm
  store. It passed with 89 production entries. The failed sandbox attempt is
  not acceptance evidence.
