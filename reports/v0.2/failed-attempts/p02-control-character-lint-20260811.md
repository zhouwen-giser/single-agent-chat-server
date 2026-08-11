# P02 Failed Attempt — control-character regex lint

- Attempted at: 2026-08-11
- Command: `pnpm verify:phase2`
- Result: `FAILED_REQUIRED`
- Passed before failure: repository formatting.
- Failing step: ESLint `no-control-regex` rejected the public-text control
  character removal regex in `interaction-contract`.
- Evidence boundary: the aggregate stopped at lint; no later stage is claimed
  by this attempt.
- Remediation: filter Unicode code points explicitly while preserving tab,
  newline, and carriage return, retain redaction/bounds tests, and rerun the
  complete phase gate.
