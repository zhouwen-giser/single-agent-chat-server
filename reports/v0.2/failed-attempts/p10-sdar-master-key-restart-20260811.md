# P10 failed attempt: unstable SDAR test master key

- Date: 2026-08-11
- Gate: isolated runtime restart
- Result: failed as observed

Changing the test master key across restarts made the isolated credential blob
undecryptable and produced `SECRET_DECRYPT_FAILED`. Only P10's dedicated SDAR
containers and test volumes were recreated, then a stable test-only key was
used for restart evidence. No unrelated container was changed.
