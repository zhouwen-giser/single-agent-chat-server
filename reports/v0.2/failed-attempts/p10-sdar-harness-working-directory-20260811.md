# P10 failed attempt: SDAR harness working directory

- Date: 2026-08-11
- Gate: exact runtime startup
- Result: failed as observed

The first harness launch inherited the SACS working directory and could not
find `infra/postgres/migrations`. Relaunching with the exact SDAR clone as the
working directory resolved only path discovery and preserved the locked code.
