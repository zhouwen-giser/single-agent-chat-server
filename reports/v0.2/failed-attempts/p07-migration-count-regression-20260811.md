# P07 failed attempt: migration count regression

- Date: 2026-08-11
- Gate: PostgreSQL integration
- Result: failed as required

The first full PostgreSQL run applied migration 0005 successfully, while two
older persistence assertions still expected four migrations. Both were updated
to the exact five-file append-only list. Full PostgreSQL integration then
passed 45/45.
