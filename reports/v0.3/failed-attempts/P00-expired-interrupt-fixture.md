# P00 failed attempt: expired open-Interrupt fixture

- Exact head: `296dc7366a99e9e8e53fa6616ecea60488e22bc0`
- GitHub run: `32471979102`
- Initial quality job: `96740479218`
- Failed-job rerun: `96740889027`
- Result: both failed identically, 50/51 PostgreSQL integration tests passed.

## Failure

`restores an open interrupt and run after repository restart` expected
`findOpenInterrupt()` to return an object, but it returned `undefined`.

The fixture inserted:

```text
expiresAt = 2026-08-12T00:00:00.000Z
```

The repository deliberately queries `status = 'OPEN' AND expires_at > now()`.
The last green main CI ran on 2026-08-11; the current run occurred on 2026-08-21.
The test therefore became deterministically invalid without any production code
change.

## Resolution

Change only this fixture expiry to `2099-01-01T00:00:00.000Z`, matching the
non-expiring value already used by later tests in the same file. Retain the
production expiry predicate unchanged and rerun the real PostgreSQL suite and
exact-head CI.

## Integrity

The failed runs remain failed evidence. No retry is reported as a pass, no
assertion is weakened, and no product expiration behavior is changed.
