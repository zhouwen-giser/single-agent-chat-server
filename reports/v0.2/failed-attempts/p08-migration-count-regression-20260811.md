# P08 failed attempt: migration count regression

- Date: 2026-08-11
- Gate: `pnpm verify:phase8` PostgreSQL integration
- Result: failed as required

Migration `0006_durable_agui_runs.sql` applied successfully, while three
append-only migration assertions still expected five files. The assertions now
name all six migrations and expect six checksummed rows. Full integration then
passed 49/49 and the independent migration gate passed 6/6.
