# P03 completion

Status: `PASSED`

Migration `0004_interaction_gateway.sql` evolves the existing PostgreSQL state
without reset. It adds protocol-neutral principal, conversation thread, client
thread binding, interaction request/run, durable AG-UI interrupt binding, and
safe Agent Card snapshot tables. Existing task bindings gain a required
conversation thread ID while retaining the v0.1 foreign key path.

The migration converts every existing OpenWebUI user/thread/request/task into
the new model, preserves active-task uniqueness on the protocol-neutral thread,
and leaves A2A event cache and leases in place. New repositories enforce
principal+thread authorization before request, run, interrupt, or Task access.

The v0.1 OpenWebUI repository now dual-writes new principals/client threads and
uses the same conversation thread for new Task bindings. AG-UI can create a
Task binding without inventing a legacy OpenWebUI row.

Verification passed for a fresh database, a complete three-migration v0.1
upgrade with a live active Task binding, request replay/conflict, restart/open
interrupt recovery, Agent Card safe LKG, and cross-principal isolation. Full
results: unit 35/35, contract 30/30, PostgreSQL integration 41/41, four
contiguous append-only migrations, lint/type/build all passed. Two failed
required attempts are retained.
