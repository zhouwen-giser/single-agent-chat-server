# P13 Goal Blocker Report

- Status: `BLOCKED_ENVIRONMENT`
- Current phase: P13
- Qualified candidate head: `3170166befbef0e89064571c388b63869d016956`
- Qualified candidate remote head: `3170166befbef0e89064571c388b63869d016956`
- Timestamp UTC: `2026-08-24T09:00:00.000Z`

> Resume result (`2026-08-24`): the user supplied the real-model and real-SDAR
> configuration. Candidate `3170166` passed Push and PR CI, the full regression
> chain, current-source locking, and the genuine two-turn/strict-decision model
> gate. The real SDAR gate is now blocked by an authenticated A2A deployment
> that contradicts its unauthenticated Agent Card and the SACS trusted-network
> contract. No credential or endpoint value is recorded here.

## Current exact blocker

The configured loopback SDAR publishes an A2A 1.0 HTTP+JSON streaming Agent
Card with zero agent/skill security requirements, but an initial
`sendMessageStream` through the pinned official SDK fails before its first
event with HTTP 401 and `GOVERNED_CONTROL_AUTHENTICATION_REQUIRED`. The same
failure occurs through SACS and through a direct official-adapter probe. No
Task binding is created; SACS renders its safe failure response and does not
retry with credentials.

The local SDAR process is current source
`7fa3ed8f7a7cac6ecff6a16fb8ce72c1d61b1c3e`. Its environment contains governed
control identity configuration, and the current UGV profile requires that
identity. Supplying that bearer token to SACS or adding an interactive A2A auth
flow would violate the v0.3 hard invariant. Modifying SDAR/SMPP source or
pretending the Fixture passed the gate is also prohibited. P13 therefore
remains `BLOCKED_ENVIRONMENT` at the real-SDAR boundary.

Sanitized current evidence:

```text
candidate: 3170166befbef0e89064571c388b63869d016956
Push CI: 32708059492 (quality/container success)
PR CI: 32708065323 (quality/container success)
real model: PASSED; durableTwoTurnReference=true; strictTurnDecision=true
Agent Card: HTTP+JSON 1.0; streaming=true; securityRequirements=0
initial A2A stream: 401 GOVERNED_CONTROL_AUTHENTICATION_REQUIRED; events=0
Task creation/confirmation/execution: 0/0/0
```

## Historical initial blocker (superseded)

The execution environment contains none of the required P13 real-model or
real-SDAR variables. It therefore cannot run the required genuine
OpenAI-compatible model conversations, create two active Tasks against the
locked current SDAR, or start SACS around the destructive isolated upgrade and
restart scenario. The exact missing configuration is:

- `P13_REAL_MODEL_BASE_URL`, `P13_REAL_MODEL_NAME`, and any required
  `P13_REAL_MODEL_API_KEY`;
- `P13_REAL_SDAR_BASE_URL` and any necessary validated endpoint override;
- two operator-reviewed safe requests, their domain kind, and an optional safe
  Follow-up;
- the exact candidate/source SHA, CI URL, evidence/SBOM output, and isolated
  database/container variables enumerated in `.env.example`.

PostgreSQL 16.14 is reachable in the isolated
`sacs-v03-p06-postgres-20260821` container, Docker 29.6.1 is reachable, and the
exact candidate CI run succeeded. Those available services do not substitute
for the missing real model and SDAR.

## Continuation environment re-audit

At `2026-08-21T18:41:30.877Z`, a second environment audit still found no
`P13_*`, `CONVERSATION_MODEL_*`, `SDAR_A2A_*`, or `OPENAI_*` variable names.
The candidate gate therefore continued to fail closed at
`P13_EXPECTED_SACS_SHA` before making any real request.

The audit did discover an unconfigured loopback A2A endpoint at
`http://127.0.0.1:10999`. Its public Agent Card advertises A2A 1.0 HTTP+JSON
streaming and only the effectful `embodied.move` capability, with an explicit
`confirmation_required` limitation. It was not used as P13 evidence because:

- no operator selected two safe, non-destructive requests for that capability;
- no genuine model endpoint exists for the required SACS execution;
- the adjacent SDAR checkout is at `382c7090dfefca7f8792326b315ff6709bcc9956`,
  while its recorded `origin/main` is
  `2275bc52759914bc80113358a9083e6f00d59e6d`, and the checkout contains
  substantial pre-existing tracked and untracked user work;
- no authoritative evidence ties the running endpoint to a clean, locked SDAR
  and SMPP source pair.

The upstream checkout was inspected read-only and left untouched. A reachable
endpoint is not treated as qualified merely because it returns an Agent Card.

## Evidence

```text
command: compgen -e | rg '^(P13_|CONVERSATION_MODEL_|SDAR_A2A_|TEST_DATABASE_URL$)'
exit code: 1
sanitized output: no matching environment variable names

command: node scripts/require-phase13-environment.mjs
exit code: 1
sanitized output: P13_EXPECTED_SACS_SHA is required for the P13 candidate gate

command: git rev-parse HEAD; git rev-parse origin/feature/sacs-v0.3-general-conversation-multitask
exit code: 0
sanitized output: both are 3a3abbd983db0480f668ce674759210915085198

CI: https://github.com/zhouwen-giser/single-agent-chat-server/actions/runs/32511015976
quality job 96861907391: success
container job 96862547655: success
```

## Work completed despite blocker

- Added exact-head, clean-tree, local/remote candidate enforcement and
  fail-closed P13 environment validation.
- Added genuine model, current SDAR two-active-Task, safe domain request,
  ambiguous mutation, bounded observation, client-disconnect, v0.2 upgrade,
  SACS/PostgreSQL restart, and network-boundary gate drivers.
- Added five sanitized `PASSED_REAL` evidence schemas and a zero-skip
  aggregator; raw evidence is restricted below `.tmp`.
- Added all requested `verify:v03:*` commands and one complete
  `pnpm verify:v03` gate.
- Exact functional head passed 100 unit, 78 contract, 89 PostgreSQL
  integration, 22 predecessor, 12 security, 35 AG-UI, 146 dedicated P12
  security/acceptance tests, build, architecture, licenses, and secret scan.
- Exact functional head built and inspected the production image, passed
  isolated Compose/readiness/migration/cleanup, and generated a CycloneDX 1.7
  SBOM with 3,718 components and SHA-256
  `ffcda6352f26ec301027261851222f92d96ed2f9b65079b4ac30905269337593`.

## Current required acceptance criteria not satisfied

- AC-040: current locked SDAR two-active-Task and precise-operation proof.
- AC-041: exact P13 v0.2 upgrade plus SACS/PostgreSQL restart gate; its driver
  must start SACS with the genuine model and cannot be downgraded to a fixture.
- AC-042: final combined real endpoint/network evidence for the exact
  candidate.
- P13 completion artifacts, `PASSED` status, and PR Ready state.
- P14 final synchronization and full exact-head rerun.

## Exact recovery steps

1. Provide or reconfigure a current-main SDAR deployment whose published A2A
   security declaration matches its wire behavior and whose initial/read-only
   Task traffic is unauthenticated on the trusted isolated network. Do not give
   the governed-control bearer token to SACS.
2. Keep the two reviewed non-executing requests, or replace them with two safe
   requests supported by that unauthenticated Agent Card.
3. Remove stale `.tmp/p13-real-evidence`, set
   `P13_EXPECTED_SACS_SHA` to the exact clean local/remote candidate, and run
   `pnpm verify:v03` with zero required skips.
4. Review the sanitized evidence, commit/push the P13 completion artifacts,
   then perform P14 synchronization and rerun the full gate before marking the
   Draft PR Ready.

## Integrity statement

No fixture, mock, skipped test, old commit evidence, or fabricated result was
used to satisfy the blocked real gate. The deterministic fixture and
PostgreSQL suites remain supporting evidence only.
