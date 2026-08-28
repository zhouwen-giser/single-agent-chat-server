# SACS v0.4 S06 ConversationWorldFocus contract and persistence

## Decision

S06 passes. SACS_CONVERSATION_WORLD_FOCUS_CONTRACT_READY is supported by
strict TypeScript and JSON contracts, append-only migration 0011, and real
PostgreSQL evidence.

## Contracts and authority

ConversationWorldFocus is scoped by principal and Thread, revisioned, and
bounded to 64 references. ReferenceKey remains an opaque WSGS/GOWM token.
The identity hash deliberately excludes only ReferenceKey.version, so a new
world version refreshes the same object instead of creating a duplicate.

The WSGS adapter no longer accepts unknown arrays for Context Capsule authority
fields. It implements the exact frozen KnownWorldReference,
PriorGroundingReference, MapSelection, ExternalCorrelationHint, and
ExternalPredicateCapsule schemas from sacs-wsgs-grounding/1.0.
Unknown authority fields and model-supplied Product IDs are rejected.

## Persistence

Migration 0011_conversation_world_focus.sql adds only:

- conversation_world_focus;
- conversation_world_reference;
- pending_grounding_choice.

Migrations 0001 through 0010 remain byte-identical. Focus updates use a locked
row plus expected revision and the database requires revision to increase by
exactly one. Principal/Thread composite foreign keys enforce isolation.
References store bounded source metadata but no geometry, full result, or
conversation history. Only one OPEN choice may exist per principal/Thread.

## Validation

An isolated PostgreSQL 17.10 instance applied the complete 0001 through 0011
chain. S06 passed 12/12 phase tests covering frozen schemas, identity hashing,
expiry, restart recovery, version refresh, concurrent compare-and-swap,
principal/Thread isolation, usable-reference filtering, PendingChoice
uniqueness, candidate membership, and expiration.

The complete integration suite passed 99/99 with zero database skips.
Migration validation reported 11 contiguous append-only files. Architecture
checked 82 production source files; lint, typecheck, build, and diff checks
passed.

## Failed attempts retained

The task-package shell preflight could not find psql and resolved python3
to the Windows Store alias. The package's Python validator was therefore run
with the active interpreter and passed
TASK_PACKAGE_VALID schemas=10 developmentRequired=119 deferred=7.

The first PostgreSQL run found that the internal sourceMessageId persistence
field was accidentally passed into the strict public reference schema. The
repository now explicitly maps only public contract fields before validation.
The first cumulative integration run also exposed three older tests that
hard-coded migration 0010 as the final migration; their expected append-only
chain now correctly includes 0011.

## Publication boundary

The local semantic phase commit is permitted by the repository workflow.
Push and Draft PR #15 updates remain withheld until direct user authorization;
no merge, tag, release, or deployment is performed.
