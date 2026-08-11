# Failed Attempt

- Phase: P13
- Timestamp: 2026-08-11
- Candidate SHA: `cf19d7286ff0cba0cb00f6bdb1cd562541227aa9`
- Command/scenario: controlled restart of the exact SDAR test process
- Result: failed twice before the exact process restarted successfully

## Failure

The first PowerShell 5.1 restart helper used `[SHA256]::HashData`, which is not
available in that runtime. The second attempt launched the SDAR harness from
the SACS repository root and looked for `infra/postgres/migrations` in the
wrong checkout.

## Root cause

The helper assumed a newer .NET hashing API and did not preserve the locked
SDAR checkout as its working directory.

## Fix/disposition

Use a PowerShell 5.1-compatible hashing path and start the harness with the
exact `.tmp/p10-sdar-a995` working directory. PostgreSQL and Redis were never
stopped or modified by either failed attempt.

## Retest evidence

The exact SDAR SHA `a9957c82...` restarted, served Agent Card hash
`767ad28a...`, and passed all five final real gates.
