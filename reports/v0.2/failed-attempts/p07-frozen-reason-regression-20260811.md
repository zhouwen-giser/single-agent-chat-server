# P07 failed attempt: frozen interrupt reason regression

- Date: 2026-08-11
- Gate: `pnpm test:unit`
- Result: failed as required

After implementing the P07 frozen reason map, a P06 assertion still expected
raw `awaiting_user_input`. The implementation correctly emitted
`sdar.input_required`; the stale assertion was updated and full unit tests
passed.
