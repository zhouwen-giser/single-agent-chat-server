# P08 failed attempt: normalized A2A message fixture

- Date: 2026-08-11
- Gate: P08 PostgreSQL integration
- Result: failed as required

The first disconnect test supplied a string where `NormalizedTask.statusMessage`
requires a normalized A2A Message. The coordinator rejected the fixture before
completing its inner request, so the test's durable-binding wait timed out. The
fixture now uses the official normalized Message/Part shape. The P08 suite then
reached the intended recovery boundary.
