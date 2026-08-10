# P10 failed attempt: PowerShell ToHexString availability

- Date: 2026-08-11
- Gate: stable test master-key generation
- Result: failed as observed

Windows PowerShell's loaded .NET surface did not expose
`[Convert]::ToHexString`. The deterministic test-only digest was encoded with
per-byte `ToString('x2')`; no credential value is retained in evidence.
