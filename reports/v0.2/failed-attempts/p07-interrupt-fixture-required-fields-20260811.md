# P07 failed attempt: required interrupt fixture fields

- Date: 2026-08-11
- Gate: `pnpm typecheck`
- Result: failed as required

The first repository typecheck rejected an older interrupt fixture because it
did not supply the new frozen required `reason` and `expiresAt` fields. The
fixture was updated. Production types were not weakened with implicit defaults.
