# Failed Attempt

- Phase: P13
- Timestamp: 2026-08-11
- Candidate SHA: `cf19d7286ff0cba0cb00f6bdb1cd562541227aa9`
- Command/scenario: long observation immediately after controlled SDAR restart
- Result: safe HTTP error, but the durable AG-UI Run remained `RUNNING`

## Failure

The short-budget SACS process retained an A2A connection created before the
SDAR restart. Its next execution failed safely at HTTP, while the corresponding
`interaction_run` never reached a durable terminal state.

## Root cause

`DurableAgUiRunService` had `try/finally` but no non-abort execution-error
closure. The exception escaped after `finally`, so the later `finishRun()` and
request completion code was unreachable.

## Fix/disposition

Candidate `40e7ae4e...` adds a continuation sequence offset and converts a
non-abort execution exception into sanitized `run.started`/`run.error` events,
persists `ERROR`, completes the request, and supports deterministic replay.

## Retest evidence

Unit 78/78 and native PostgreSQL integration 51/51 passed. The focused durable
Run suite passed 5/5, including error closure, safe output, no Task binding, and
identical replay. The full exact-candidate gate and CI run 31448260553 passed.
