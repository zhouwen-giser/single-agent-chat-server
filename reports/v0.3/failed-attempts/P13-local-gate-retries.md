# P13 local gate retries

## Sandboxed loopback attempt

The first `pnpm verify:phase12` attempt ran inside a network-isolated sandbox.
The unit suite passed, but nine A2A contract cases could not bind
`127.0.0.1` (`EPERM`) and timed out. This was classified as an execution
environment failure, not a product defect. The authorized loopback rerun passed
all 78 contract tests.

## pnpm license metadata attempt

The authorized regression command inherited a workspace-specific
`PNPM_CONFIG_STORE_DIR` whose metadata lacked the package index for
`@a2a-js/sdk@1.0.0-beta.0`; `verify:licenses` stopped after all preceding code
and PostgreSQL suites had passed. A frozen-lockfile install confirmed no
dependency changes. Rerunning `pnpm verify:licenses` against pnpm's normal local
metadata database passed 89 production entries. No lockfile or dependency
version changed.

## Docker dependency metadata retry

The exact-head Docker build encountered transient registry metadata retries for
`@babel/compat-data`. BuildKit completed from the pinned lockfile and cache,
then produced image manifest
`bebdae2d4006cfcb776e7c366699dcacee507c342c0fc3d391848b0938a3202a`.

None of these retries is counted as real-model or real-SDAR evidence.

## Continuation endpoint-discovery attempt

A continuation audit found `http://127.0.0.1:10999` listening and returning an
A2A 1.0 Agent Card. The card exposes only `embodied.move` with a
`confirmation_required` limitation. The endpoint was not exercised: no two
operator-reviewed safe requests were supplied, no genuine model endpoint was
configured, and the running service could not be tied to a clean locked SDAR
and SMPP source pair. The nearby SDAR checkout also contains substantial
pre-existing user changes, which were preserved. This discovery is blocker
diagnosis only and is not counted as real evidence.

## Source-lock candidate CI interrupt expiry

After the SDAR source-lock refresh, exact-head push CI run `32703576086`
passed 100 unit and 78 contract tests, then failed one of 89 PostgreSQL
integration tests. `agui-multitask-interrupt.postgres.int.test.ts` injected an
absolute service clock of `2026-08-22T00:00:00.000Z`; once wall-clock time moved
past that date, the database correctly treated the newly persisted Interrupt
as expired. The test now uses the service's production default current clock.
The focused rerun passed 1/1 and the complete isolated PostgreSQL rerun passed
89/89. Production expiry semantics were not changed, and the failed CI is not
counted as release evidence.

## First resumed real-gate startup attempt

The first resumed `pnpm verify:v03` attempt passed the complete available
regression chain and the real source-lock gate, then stopped before any real
Task creation because SACS exited during configuration parsing. The user `.env`
contained general model timeout/output values above the production schema
limits. The P13 harness had correctly overridden the real endpoint, name, and
key, but had accidentally inherited those unrelated general tuning values.
The harness now pins the same bounded timeout, output, temperature, retry, and
response-format settings used by the direct P13 model qualification. No
production validation limit was weakened, no secret was logged, and this
failed attempt is not counted as real-model or real-SDAR evidence.

## Real-model existing-Task status misclassification

After the first Turn Decision fix, exact candidate `2948b4e` passed both CI
workflows, the full local regression chain, source locking, and real two-turn
memory. Its next strict real-model decision check classified an explicit
existing-Task status request as `new_task` instead of `task_status`, so the run
stopped before any SDAR Task creation. The prompt now defines mutually
exclusive mappings for new SDAR work, Task listing, existing-Task reads,
Follow-up mutations, top-level cancellation, ordinary chat, and clarification.
In particular, `new_task` is prohibited for reading or changing an existing
Task, while status/result/history/allowed-operation/capability-gap questions
map to `task_status`. This failed attempt is not counted as real-model or
real-SDAR evidence.

## Real-SDAR governed-control authentication mismatch

Candidate `3170166` passed both CI workflows, the complete regression chain,
source locking, and the genuine model gate. Its first reviewed non-executing
SDAR request then produced no A2A event or Task. A direct probe through the
pinned official adapter reproduced HTTP 401
`GOVERNED_CONTROL_AUTHENTICATION_REQUIRED`. The Agent Card simultaneously
advertises A2A 1.0 HTTP+JSON streaming with zero security requirements and is
not stale. The confirmation Bearer middleware was incorrectly mounted over the
entire `/a2a` path instead of only confirmation traffic. No token was sent to
SACS, no interactive authentication was added, and no Task was confirmed or
executed. This remains `BLOCKED_ENVIRONMENT` until the corrected SDAR process
is restarted; it is not real SDAR evidence.

## Real-model Turn Decision misclassification

The next exact-head `pnpm verify:v03` attempt passed the complete regression
chain and source-lock gate, then failed the two-turn real-model assertion
before creating any SDAR Task. PostgreSQL contained all four ordered user and
assistant messages. A loopback-only diagnostic proxy recorded only prompt
metadata and proved that both prior messages reached the second Turn Decision,
but the model returned `clarification` instead of `general_chat`; the graph
therefore rendered the classification question without invoking the general
answer call. An isolated repeat reproduced the failure, and a redacted real
model comparison also showed that the old prompt could misclassify the history
question as `new_task`. The decision prompt now states that it classifies only
intent, assigns prior-conversation questions to `general_chat`, and reserves
`clarification` for Task operations that cannot safely proceed. No endpoint,
credential, prompt text, model answer, or Task identifier was retained. This
failed attempt is not counted as real-model or real-SDAR evidence.

## Post-restart natural-language admission probes

The first restart used a process started before the new SDAR natural-language
admission files were written, so both the original reviewed request and a
subject-qualified UGV variant still failed with
`UGV_AGENT_PROFILE_TASK_CAPABILITY_BINDING_REQUIRED`. Process start time and
source modification time identified the stale runtime precisely; neither Task
was confirmed or executed.

After a second restart, an official A2A 1.0 probe sent one metadata-free
`text/plain` UGV request. It no longer encountered authentication or missing
binding errors, proving that the server-owned natural-language resolver ran.
The Task failed closed with the published message that the requested Exposure
was not active, current, or ready. The SDAR deployment therefore still lacks a
qualifying current PostgreSQL Exposure/readiness/Provider authority snapshot.
The running clean SDAR commit is local `f1c86de448d5e4df6d2e879d80c5765edcff8852`,
while remote `main` remains `7fa3ed8f7a7cac6ecff6a16fb8ce72c1d61b1c3e`.
These probes are diagnostic only and are not counted as real-SDAR acceptance
evidence.

## Real-SDAR authority expired before the aggregate scenario

Exact candidate `f3b13b5` passed Push and PR CI, the complete local regression
chain, source locking and the genuine model gate. Its first real-SDAR request
returned a terminal failed Task instead of an active binding. A read-only query
of the P13-dedicated SACS PostgreSQL proved that the request completed as a
`TASK` result and that SACS persisted the exact published failure: the requested
Exposure was not active, current, or ready. A subsequent public Agent Card read
confirmed that `io.sdar/naturalLanguageCapabilityAdmission` was absent. No
confirmation or execution occurred.

The same request had reached `INPUT_REQUIRED` immediately after the earlier
operator refresh, so this is an authority-window timing failure rather than a
SACS routing, persistence or A2A mapping regression. P13 now permits an explicit
two-command workflow for such deployments: first produce real-SDAR evidence
immediately after refresh, then let the complete gate revalidate and reuse only
that exact-candidate evidence while executing every other gate. The validator
checks the wrapper schema, gate identity, candidate and source SHAs, both active
Tasks, multi-Task isolation, ambiguous-mutation behavior, domain routing,
disconnect behavior, absence of direct SMPP/MCP access, timestamps, exit code
and zero required skips. Default aggregate behavior still runs the live SDAR
scenario directly.

The user explicitly directed the run to continue with SDAR process commit
`68e05ea` while remote main is `1d5aafd`; both have the exact same Git tree.
This deviation is disclosed and is not rewritten as exact process-SHA proof.
