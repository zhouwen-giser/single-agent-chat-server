# SACS v0.4 S05 authority-fusion preview report

## Decision

S05 implements the compare-only Authority Fusion Preview and passes its
internal automated and real-PostgreSQL gates. The task book also requires a
genuine SDAR-plan plus WSGS/GOWM-reality verification. That external gate is
blocked because the current SACS task has not received explicit,
destination-specific authorization to load the local model and GOWM test
credentials. `AUTHORITY_FUSION_PREVIEW_READY` is therefore withheld.

## Production behavior

`HYBRID_PLAN_REALITY_COMPARE` first resolves exactly one Task already bound to
the requesting user and Chat. Multiple active Tasks return the Task directory;
an absent or ambiguous selection never calls A2A or WSGS. For one resolved
Task, SACS consumes the official coordinator `statusForTask()` path, which uses
A2A 1.0 HTTP+JSON `getTask()`, verifies the bound Task identity, persists the
observation, and exposes only published status fragments. The snapshot is
bounded to 128 fragments and 8,000 characters, and the existing observer still
receives the same published Task event.

The WorldGroundingRuntime hashes the strict SDAR snapshot into the durable
request identity and issues one read-only WSGS grounding request. A completed
preview requires at least one reference and one evidence item, only COMPLETED
evidence, no ambiguity, unresolved mention, or capability gap, and exactly one
source world version. SACS then renders the SDAR plan and WSGS/GOWM reality
side-by-side. The composition explicitly does not infer equivalence,
contradiction, execution outcome, or any authority change. It never submits,
follows up, cancels, or otherwise mutates the SDAR Task.

The stored outer Message is replayed without a second WSGS POST. The SDAR plan
snapshot is included in the stable request hash, so the same external Message
ID cannot silently reuse a preview for a different observed plan. Incomplete,
NO_DATA, unresolved, ambiguous, capability-gap, empty-evidence, and mixed-world
results return `AUTHORITY_FUSION_PREVIEW_UNAVAILABLE` and never render the Ready
marker.

## Validation

`pnpm verify:v04:s05` passed cumulatively on an isolated PostgreSQL 16.9
instance:

- S00 source and compatibility locks: 6/6 PASS;
- S01 authority contracts: 19/19 PASS;
- S02 deterministic planner and isolated adapter: 12/12 PASS;
- S03 persistence contracts and real PostgreSQL groups: 14/14 PASS;
- S05 runtime, application, and PostgreSQL tests: 16/16 PASS;
- cumulative real PostgreSQL integration: 94/94 PASS with zero database skips;
- migration, 80-file architecture, lint, typecheck, format, and build Gates:
  PASS.

The complete repository CI baseline passed 122 unit, 121 contract, 94 real
PostgreSQL integration, 12 security, and one deterministic fixture E2E test.
OpenAI predecessor, A2A, AG-UI, smoke, workflow, license, and the 570-file
secret scan also passed.

The rebuilt `single-agent-chat-server:0.4.0` image passed its metadata Gate.
Isolated Compose reached readiness HTTP 200 with 18 migrated tables, non-root
execution, read-only root, all capabilities dropped, `no-new-privileges`, and
complete cleanup. The CycloneDX 1.7 SBOM contains 3718 components with SHA-256
`1d1aa2624fbdc47e8f111fbc10d01ca5d12fe99e1d9bdaba37f0c251fc3a8f60`.

The two phase PostgreSQL tests use the real persistence repositories and
production WSGS HTTP adapter, with injected Fetch responses. They prove
durable one-POST behavior and contract enforcement, but are not live WSGS,
GOWM, SDAR, or final Authority Fusion E2E evidence.

## Real-gate attempt

The repaired WSGS branch and its Development Ready handoff were rechecked:
the candidate is clean and pushed, the tested implementation is `75c6d273`,
the ledger is 63/63 PASS, and `productionQualified=false`. The existing GOWM
sample instance was observed healthy and was not stopped, restarted, rebuilt,
or modified.

An isolated SDAR PostgreSQL/Redis/A2A instance was started without external
Provider access. Agent Card discovery negotiated A2A 1.0 HTTP+JSON. One test
Task explicitly prohibited Provider and physical actions; it traversed
SUBMITTED and WORKING but failed before publishing a plan because the isolated
instance had no configured model Provider. This is a genuine failed attempt,
not plan-state evidence.

Configuring the existing model credential into that temporary SDAR instance,
and loading the GOWM sample token/private key into a temporary WSGS process,
were both denied by the credential safety gate. The earlier general
authorization did not identify the current SACS task and these exact credential
uses. No credential was printed, logged, copied, committed, or sent. Temporary
SDAR/WSGS processes, databases, and two generated log files were stopped and
removed; the GOWM sample instance remains running.

## Blocker and non-claims

To resume the genuine S05 Gate, the user must explicitly authorize the current
SACS task to read and use the local GOWM sample token/private key and the local
model API credential solely for this isolated Authority Fusion verification,
with no value appearing in output, reports, commits, PRs, or logs.

Until that authorization and a passing live comparison exist:

- `AUTHORITY_FUSION_PREVIEW_READY` is not claimed;
- the S05 real gate is BLOCKED, not PASS or NOT_RUN;
- injected Fetch, an SDAR Task that failed before plan publication, and prior
  WSGS Development Ready evidence are not substituted for live fusion E2E;
- current SDAR still lacks `sacs-sdar-operational-grounding/1.0`;
- WSGS remains `productionQualified=false`;
- the overall disposition remains `SACS_V0_4_STABLE_CANDIDATE_BLOCKED`.
