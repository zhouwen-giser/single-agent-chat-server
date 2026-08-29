# S13 geospatial explanation baseline — PASS_WITH_EXTERNAL_BLOCKERS

`SACS_GEOSPATIAL_BASELINE_LOCKED` is asserted for the dedicated local stacked
branch `codex/sacs-v0.4-geospatial-explanation`.

The branch starts at the exact SACS PR #15 head
`2dcbbe1c6074a54e0c332337f03a4e5574c19e06`. PR #15 remains open, non-Draft
and mergeable, and both GitHub quality and container checks are successful.
Before feature changes, the full Jest baseline passed 311 tests with 100
package-defined skips (411 total).

WSGS PR #6 was re-fetched at
`601772e935bd47b74d16679bf215654eb0a0cb27`. It remains an open Draft with a
successful CI check, but its checked-in v0.2.1 ledger remains fail-closed on
`GDPS_V021_HANDOFF_INCOMPLETE`. It does not publish the authoritative
`WSGS_SACS_CONSUMER_LOCK.json`, geospatial finding profile, result lock,
provenance lock and checksums required by S14. The existing WSGS debug handoff
still declares runtime commit `46e872359536b84351ce2b417117fc5725c59145`,
and the application readiness probe timed out after 20 seconds. No credential
was printed or persisted.

GOWM application readiness responded with `status=ok`, 122 capabilities and
registry revision
`sha256:efd0395dbd05c884c781f964b22147efcb38c4cef91704597706ec4b8332075a`.
GDPS main remains at the merged v0.2 head. A local v0.2.1 candidate exists but
is dirty, unpublished and therefore is not an authoritative consumer handoff.

S13 records the exact source and runtime distinction in
`S13-source-lock.json`. It does not promote historical reports, local changes,
fixtures or Docker process state into running geospatial evidence.

No push, PR update, merge, tag, release, deployment or shared-infrastructure
mutation was performed.
