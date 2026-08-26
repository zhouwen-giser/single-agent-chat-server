# v0.3 release-candidate qualification

P13 is an exact-local-and-remote-head gate. It refuses a tracked dirty tree,
requires the published feature branch to equal `P13_EXPECTED_SACS_SHA`, and
writes raw machine evidence only below `.tmp`. A missing real model, real SDAR,
safe operator-selected request, exact source SHA, CI URL, Docker daemon, or
isolated PostgreSQL target is `BLOCKED_ENVIRONMENT`; fixtures cannot satisfy
those gates.

## Required environment

Use `.env.example` as the name catalog. Secrets must come from the execution
environment and must not be written to shell history, evidence, reports, or
Git. `P13_SAFE_TASK_A_TEXT` and `P13_SAFE_TASK_B_TEXT` must be two independent,
non-destructive requests that the current Agent Card can keep active together.
At least one must exercise the declared `P13_SAFE_DOMAIN_KIND` (`provider`,
`resource`, `action`, or `diagnostic`) through SDAR. Set
`P13_SAFE_FOLLOW_UP_TEXT` only when the operator has identified a reversible,
safe Follow-up; otherwise the gate records the permitted real-read-only plus
official-fixture/PostgreSQL proof mode.

When loading a local `.env`, ordinary `CONVERSATION_MODEL_*` settings also
affect the isolated Compose readiness check. Production rejects timeout values
above 120000 ms and output limits above 16384 tokens. The verified invocation
uses command-only `CONVERSATION_MODEL_TIMEOUT_MS=30000` and
`CONVERSATION_MODEL_MAX_OUTPUT_TOKENS=2048` when the local file has larger
values. This does not edit operator configuration or weaken validation. The
genuine P13 model harness independently uses its bounded `P13_REAL_MODEL_*`
configuration.

The migration gate is intentionally destructive only to the database named
`single_agent_chat_phase4` in the explicitly named
`sacs-v03-*` test container. It creates a v0.2 schema and representative data,
upgrades through migrations 0007–0009, starts and stops SACS, restarts that
PostgreSQL container, starts SACS again, and verifies context, summary, two
active Tasks, Focus, TASK and MESSAGE replay, and a durable AG-UI Run. Never
point it at a shared or production database.

## Commands

The individual gates are:

```text
pnpm verify:v03:unit
pnpm verify:v03:contract
pnpm verify:v03:postgres
pnpm verify:v03:security
pnpm verify:v03:fixture
pnpm verify:v03:real-model
pnpm verify:v03:real-sdar
pnpm verify:v03:migration
pnpm verify:v03:network
```

`pnpm verify:v03` is the complete fail-closed candidate gate. It first checks
the environment, reruns all predecessor/static/PostgreSQL gates, collects five
real evidence documents, verifies their exact candidate SHA and zero required
skips, builds and inspects the production container, verifies isolated Compose,
and generates a CycloneDX 1.7 SBOM.

If the current SDAR publishes a deliberately short-lived Capability authority
window, qualify it immediately after the operator refreshes that authority:

```text
pnpm verify:v03:real-sdar
P13_REUSE_EXACT_REAL_SDAR_EVIDENCE=true pnpm verify:v03
```

Reuse is opt-in and accepts only the existing `.tmp/…/real-sdar.json` whose
schema, gate identity, candidate SHA, SDAR/SMPP source SHAs, required scenario
assertions, exit code and zero-skip result match the current clean candidate.
It is not a fixture or an old-commit skip: the first command performs the real
requests, while the complete gate revalidates that exact-candidate evidence and
runs every other required gate. Delete the evidence directory whenever the
candidate or locked sources change.

Evidence contains only endpoint hashes, model name and protocol, source SHAs,
Agent Card hash, hashed Task/thread identifiers, timestamps, commands, exit
codes, skip counts, Docker/PostgreSQL versions, and the exact CI URL. It never
contains model keys, prompts, user text, raw Task IDs, or endpoint credentials.
