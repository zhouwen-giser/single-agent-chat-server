# SACS v0.4 S03 completion report

## Decision

S03 passes append-only PostgreSQL persistence, database-boundary exactly-once
reservation, and expired-lease recovery. These results are real PostgreSQL
evidence, but they are not server integration, live WSGS, or SDAR grounding
E2E evidence.

## Append-only lifecycle

Migration `0010_grounding_lifecycle.sql` is added after the byte-frozen 0001
through 0009 chain. It freezes the required seven states and permits only the
documented forward transitions. Request identity, request planning inputs,
recorded WSGS results, the operational bundle, the SDAR submission key, and
the recorded Task/context identity cannot be rewritten. Terminal rows cannot
be reopened.

The database enforces:

- the principal/thread/interaction-request authorization tuple with a
  composite foreign key;
- one grounding idempotency key per principal and Thread;
- globally unique WSGS request and SDAR submission keys;
- state-dependent result, bundle, Task, terminal, failure, and lease shapes;
- monotonically incremented row versions;
- immutable, ordered, hash-addressed grounding events that reject update,
  delete, and non-empty truncate operations.

## Repository and recovery

`GroundingPersistenceRepository` wraps every state change and event append in
one transaction. A duplicated request with changed input conflicts. A request
already beyond `GROUNDING_PENDING` replays its durable state instead of
acquiring another WSGS execution lease. The SDAR reservation retains one
stable submission key and immutable bundle hash across retries.

Startup workers recover only expired `GROUNDING_PENDING` and
`SDAR_SUBMISSION_RESERVED` leases through `FOR UPDATE SKIP LOCKED`. This keeps
the two external-side-effect windows serialized while allowing deterministic
ready-state continuation and read-only submitted-Task observation to use their
durable identities in later runtime integration.

## Validation

`pnpm verify:v04:s03` is the cumulative phase Gate. The completed local
database validation used an isolated PostgreSQL 16.9 container and a dedicated
S03 test database:

- S03 static persistence contracts: 11/11 PASS;
- S03 real PostgreSQL lifecycle/recovery/immutability groups: 3/3 PASS;
- complete integration regression: 92/92 PASS, zero database skips;
- migration Gate: 10 contiguous append-only files, PASS;
- architecture Gate: 79 production source files, PASS;
- lint and TypeScript typecheck: PASS.

The real database tests cover the full forward lifecycle, busy/replay/hash
conflict behavior, one stable SDAR reservation, restart recovery of both
external-side-effect windows, event sequence/hash uniqueness, non-empty audit
truncate rejection, terminal closure, and cross-principal read isolation.

## Non-claims

S03 does not construct the WSGS adapter in the server, call a live WSGS
instance, create an OperationalGroundingBundle from a real result, or submit a
typed Data Part to SDAR. Actual prevention of duplicate model calls and SDAR
Tasks remains a later end-to-end runtime responsibility built on these durable
request and reservation identities.

WSGS remains `productionQualified=false`; current SDAR still lacks
`sacs-sdar-operational-grounding/1.0`. The overall disposition remains
`SACS_V0_4_STABLE_CANDIDATE_BLOCKED`.
