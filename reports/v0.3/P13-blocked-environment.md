# P13 historical blocker report (resolved)

Resolved on 2026-08-26: candidate `9cb0db0` passed the complete real/model,
SDAR, migration/restart, network, container and SBOM gate with zero required
skips. See [P13 completion](P13-completion.md) and
[acceptance](P13-acceptance.json). The material below is retained as historical
failure evidence; it is not the current release status.

- Status: `BLOCKED_ENVIRONMENT`
- Current phase: P13
- Current SACS candidate/remote: `f3b13b5b249428b82c02392bb596caa2e1d02220`
- Candidate Push CI: `32808746156` (`success`)
- Candidate PR CI: `32808768240` (`success`)
- Last fully exercised candidate: `3170166befbef0e89064571c388b63869d016956`
- Timestamp UTC: `2026-08-25T04:56:31.225Z`

> Resume result (`2026-08-24`): the user supplied the real-model and real-SDAR
> configuration. Candidate `3170166` passed Push and PR CI, the full regression
> chain, current-source locking, and the genuine two-turn/strict-decision model
> gate. The refreshed SDAR now advertises its natural-language admission
> extension, and a metadata-free `text/plain` UGV request reaches an unconfirmed
> `INPUT_REQUIRED` plan boundary. SDAR PR #27 is on remote `main`. The remaining
> precondition is a fresh SDAR authority window for the two real Tasks. The user
> explicitly directed the goal to continue despite the process commit being PR
> head `68e05ea` rather than remote-main merge commit `1d5aafd`; the two Git
> trees are byte-identical and the deviation remains disclosed. No credential,
> endpoint value, prompt, coordinate, or Task identifier is recorded here.

## Current exact blocker

Candidate `f3b13b5` passed Push and PR CI and the complete local regression
chain. Its formal real source-lock and genuine model gates passed with zero
required skips. Before the first real SDAR scenario, the previously refreshed
Capability authority expired. SACS correctly persisted the returned Task as
terminal `FAILED`, with the published reason that the requested Exposure was
not active, current, or ready; no active binding was therefore available to
the scenario. A follow-up Agent Card read confirmed that
`io.sdar/naturalLanguageCapabilityAdmission` had disappeared. No plan was
confirmed and no UGV action executed.

P13 now supports an explicit short-authority workflow: immediately after an
operator refresh, `pnpm verify:v03:real-sdar` creates exact-candidate real
evidence. The complete gate may then opt into revalidating that same evidence,
including its candidate/source SHAs and every scenario assertion, while still
running every other required gate with `requiredSkips=0`. Default behavior
continues to execute the live SDAR scenario directly.

Both repositories pin the official `@a2a-js/sdk@1.0.0-beta.0`; the negotiated
wire contract is A2A 1.0 over HTTP+JSON. SACS v0.3 is the SACS product version,
not an A2A v0.3 compatibility mode. No old `tasks/*`, JSON-RPC, gRPC, or A2A
v0.3 path is involved in this failure.

The configured loopback SDAR publishes an A2A 1.0 HTTP+JSON streaming Agent
Card with zero agent/skill security requirements. The process restarted at
`2026-08-24T10:42:34Z` from clean local commit
`f1c86de448d5e4df6d2e879d80c5765edcff8852`. An official-client probe submitted
one reviewed, non-executing, metadata-free `text/plain` UGV plan request without
credentials. It produced an A2A Task and reached the new server-resolved
Capability path; it no longer failed with either HTTP 401 or
`UGV_AGENT_PROFILE_TASK_CAPABILITY_BINDING_REQUIRED`.

After the authority refresh and restart, the public Agent Card included
`io.sdar/naturalLanguageCapabilityAdmission`. A repeated official-client probe
then progressed through `SUBMITTED` and `WORKING` to:

```text
state: INPUT_REQUIRED
internalPhase: awaiting_plan_confirmation
published message: Plan confirmation required.
```

No confirmation Follow-up was sent and no UGV action executed. This proves the
server-owned resolver, current Exposure/readiness/Provider authority and manual
confirmation boundary required for the two real P13 Tasks.

SDAR remote `main` is now `1d5aafd0a2c8324d8d0ac3cf33eebcb3c12aec6b`.
The running clean checkout is PR head
`68e05ea4d55666f7007b63edd59f32187c2aeeeb`; it is an ancestor of that merge
commit and both commits have exact tree
`fca281f87b1aeba6e391fdc1013be7acc600891a`. The code is identical. The user
explicitly directed this run not to block on the differing commit identities;
the final report must retain both identities and must not claim that the
running process itself is commit `1d5aafd`. SACS does not modify, switch or
publish the upstream repository.

Sanitized current evidence:

```text
current SACS candidate/remote: f3b13b5b249428b82c02392bb596caa2e1d02220
Push/PR CI: 32808746156 / 32808768240 (success / success)
last full local candidate: 3170166befbef0e89064571c388b63869d016956
real model: PASSED; durableTwoTurnReference=true; strictTurnDecision=true
Agent Card: HTTP+JSON 1.0; streaming=true; securityRequirements=0
official SDK in SACS/SDAR: @a2a-js/sdk@1.0.0-beta.0
natural-language admission extension: advertised
text/plain A2A submission: SUBMITTED -> WORKING -> INPUT_REQUIRED
internalPhase: awaiting_plan_confirmation
Task confirmation/execution: 0/0
running SDAR local/remote-main: 68e05ea... / 1d5aafd...
running/remote tree: fca281f... / fca281f... (identical)
latest formal source-lock: PASSED; requiredSkips=0
latest formal real model: PASSED; requiredSkips=0
latest formal real SDAR: FAILED before scenario; authority expired
post-failure natural-language admission extension: absent
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

1. Publish the exact-candidate evidence-reuse implementation and obtain green
   Push/PR CI for its new SHA.
2. Remove stale `.tmp/p13-real-evidence`; immediately after the operator
   refreshes `a2a.embodied.move@2`, run `pnpm verify:v03:real-sdar` before the
   authority window expires.
3. Set `P13_REUSE_EXACT_REAL_SDAR_EVIDENCE=true` and run the complete
   `pnpm verify:v03`. The reuse validator must accept the exact candidate/source
   identities and all real scenario assertions with zero skips.
4. Retain the user's explicit runtime-SHA deviation disclosure, review the
   sanitized evidence, commit/push the P13 completion artifacts,
   then perform P14 synchronization and rerun the full gate before marking the
   replacement Draft PR Ready.

## Integrity statement

No fixture, mock, skipped test, old commit evidence, or fabricated result was
used to satisfy the blocked real gate. The deterministic fixture and
PostgreSQL suites remain supporting evidence only.
