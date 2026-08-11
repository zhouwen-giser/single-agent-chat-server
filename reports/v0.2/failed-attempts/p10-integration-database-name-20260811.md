# P10 failed attempt: integration database identity

- Date: 2026-08-11
- Gate: full `verify:phase10`
- Result: failed closed as required

The first full gate pointed integration tests at the live P10 chat database.
All 49 PostgreSQL cases rejected it before destructive setup because they
require the isolated name `single_agent_chat_phase4`. That dedicated database
was created in the SACS test container; the rerun passed 50/50 without resetting
the real E2E database.
