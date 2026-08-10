# P08 failed attempt: PostgreSQL restart dynamic port

- Date: 2026-08-11
- Gate: real PostgreSQL restart recovery
- Result: failed as required

The dedicated PostgreSQL container preserved the exact durable probe across a
real restart, but Docker reassigned its dynamically published host port from
`44549` to `43609`. The first post-restart test command retained the old URL and
failed all four cases with `ECONNREFUSED`. After discovering the authoritative
`docker port` value, the same four P08 tests passed through port `43609`.
