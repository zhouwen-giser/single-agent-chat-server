# P07 failed attempt: persist wrapper expectation

- Date: 2026-08-11
- Gate: `pnpm test:unit`
- Result: failed as required

The persist-before-finish wrapper enriches `input.required` with the durable
expiry, so a test expecting the original object reference failed. The test now
verifies stable event identity plus `expiresAt`, reason, and official Interrupt
outcome fields.
