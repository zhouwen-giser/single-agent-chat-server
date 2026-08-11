# P12 failed attempts: source lock and predecessor driver assertions

- Date: 2026-08-11
- Gate: current-SDAR source lock and Open WebUI regression driver
- Result: failed attempts retained

The first source-lock probe pointed at another local SDAR checkout whose current
SHA was not the frozen `a9957c82` candidate. The gate failed closed. It was
rerun against the exact clean checkout under `.tmp/p10-sdar-a995` without
modifying upstream files.

Two predecessor assertions were stale: disconnect recovery expected an older
fixed text shape after the P11 typed path, and utility handling expected an
exact string before the required utility header was forwarded. The driver was
updated to validate the approved typed/published recovery representation and
the actual isolated utility response. The later exact-SHA run passed; these
earlier source and assertion failures are not counted as passing evidence.
