# P05 Failed Attempt - environment example CRLF

- Attempted at: 2026-08-11
- Command: final `git diff --check` after the complete P05 gate.
- Result: `FAILED_REQUIRED_PUBLICATION_CHECK`.
- Passed before the publication check: unit 58/58, contract 35/35, integration
  43/43, security 8/8, architecture, migrations, and build.
- Failure: PowerShell preserved CRLF while editing `.env.example`, so Git
  reported every touched line as trailing whitespace relative to canonical LF
  bytes.
- Remediation: normalize only `.env.example` to UTF-8 LF, rerun format and the
  entire strict P05 gate, then stage only after `git diff --check` passed.
