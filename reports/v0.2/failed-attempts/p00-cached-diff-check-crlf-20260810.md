# P00 Failed Attempt — staged CSV line endings

- Attempted at: 2026-08-10
- Commit created: `611c658`
- Result: `FAILED_REQUIRED_PUBLICATION_CHECK`
- Failure: `git diff --cached --check` reported every line in four newly added
  CSV contracts as trailing whitespace because their delivery bytes used CRLF.
- Command-control defect: the PowerShell sequence did not stop on the non-zero
  diff-check result, so the local commit was created anyway.
- Publication boundary: the commit was not pushed in this state.
- Remediation: normalize only the affected CSV files to LF, refresh their
  machine manifest hashes, create a corrective evidence commit, rerun blocking
  diff/format/package checks, and push only the clean two-commit phase result.
