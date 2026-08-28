# SACS v0.4 S08 genuine WSGS multi-turn gate

## Decision

S08 is BLOCKED. SACS_MULTITURN_WORLD_GROUNDING_READY is not emitted.

The production-path runner is implemented at
`scripts/phase-v04-s08-real-multiturn.mjs`. It requires an exact WSGS
development-ready checkout, a local HTTP endpoint whose live and ready probes
both return 200, and an isolated PostgreSQL admin URL. It refuses to run unless
`ALLOW_REAL_WSGS_MULTITURN=YES` is explicitly present.

## Covered live assertions

When authorized, the runner creates and later removes a uniquely named SACS
test database, runs the production migrations, and uses the production WSGS
HTTP adapter, WorldGroundingRuntime, Conversation repository, Grounding
repository, and WorldFocus repository. It verifies:

- “2号车在哪里？” followed by AG-UI “它现在呢？” with KnownWorldReference;
- “A区内有哪些车辆？” followed by “那里附近还有什么？”;
- “滨河路附近有哪些设备？” ambiguity, “第二个”, validation, and original
  query resumption;
- no OPEN choice means zero WSGS POSTs;
- an expired reference invokes VALIDATE_REFERENCES before the follow-up;
- Thread isolation, runtime/repository restart recovery, and OpenAI/AG-UI Focus
  sharing;
- exact replay makes no duplicate WSGS POST;
- continuation WSGS source remains the original Message, never the control
  text.

Only after all assertions pass does the runner emit the S08 Ready marker. Its
output contains counts and hashes, not credentials, raw external identifiers,
or raw upstream business responses.

## Current evidence

The runner contract passed 3/3 tests. Repository lint passed with zero warnings
and typecheck passed. A direct negative execution produced
S08_FAIL_CLOSED_AUTHORIZATION_GATE_PASS. These checks prove runner safety and
coverage structure, not real WSGS behavior.

The locked WSGS worktree exists at commit
3f9aa7cb8542573d2658a132644a9c649544737b. The shared GOWM sample-world Gateway
is healthy on loopback, but no WSGS API is currently running. The WSGS runbook
requires model credentials, a Gateway transport credential, and a registered
delegation private key. No credential values or private-key paths were read,
copied, logged, or committed, and the shared fixture was not restarted.

## Required authorization

Explicit destination-specific authorization is required to use the existing
local WSGS/model/GOWM secure handoff for this isolated S08 run. Static or
injected HTTP evidence cannot replace it.
