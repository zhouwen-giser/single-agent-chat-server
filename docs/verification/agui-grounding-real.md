# Live Grounding presentation acceptance

`scripts/agui-grounding-real.mjs` is separate from historical v0.6 evidence. It uses
normal local AG-UI/Analysis Control, the headless client and a dedicated ephemeral
PostgreSQL 17.10 container. It never accesses an upstream database or SDAR.

Create a private mode-0600 configuration file outside tracked source:

```dotenv
ALLOW_REAL_WSGS=YES
ALLOW_REAL_SELECTION=YES
WSGS_BASE_URL=http://17.26.1.20:18082
SACS_AGUI_QUERY_TEXT=查询最近一次任务的历史轨迹；若任务不明确，请返回可供选择的任务。
```

Use an authorized concrete query if known; do not put private identifiers in
tracked examples. The current entry supports the already-authorized anonymous
development endpoint, not production credential/multi-tenant acceptance.

Commit source, build it, then run:

```sh
pnpm build
SACS_AGUI_REAL_ENV=/absolute/private/case.env node scripts/agui-grounding-real.mjs
```

To check only the isolated database/migrations/server startup without any WSGS
request, add `--local-startup-only`. Its evidence mode is LOCAL_STARTUP_CHECK,
not REAL, and it cannot pass R01/R02. Readiness probes TCP rather than the image's
temporary initialization Unix socket. Failures record stage and code locations,
never error messages that could contain credentials or private data.

The default output is a new UUID directory under the current goal's `real/`
evidence area. `SACS_AGUI_REAL_OUTPUT` may specify a new directory; existing
`EVIDENCE.json` is never overwritten. Request text, raw results, precise positions,
task IDs and generated credentials stay in memory. The evidence keeps command
exit code, commit, contract/entrypoint hashes, HTTP statuses, source/UI status,
counts, assertion outcomes and content/identity hashes.

The fixed request and HTTP budget is 120 seconds. One initial analysis request is
allowed. If it returns an unexpired public Choice and an intervention, explicit
read-only confirmation may create exactly one more Grounding. Inspection itself
must create none; no business failure is automatically retried. The selector
sent to WSGS must exactly match the published candidate. A fresh Observation Run
then checks the new Revision/Grounding and authoritative snapshot. The script
reopens its local SACS composition and DB pools and verifies the same projection
without more upstream requests; this is not an OS process crash experiment.

The shared `verifyGroundingObservation` oracle is tested against normal and
PARTIAL public fixtures, including rejection of wrong result hashes and altered
final text. Live acceptance additionally checks every Activity source status
against real WSGS responses. HTTP 200 alone is not a PASS. R01 positive evidence
requires a valid Finding with COMPLETED/PARTIAL source status and all projection
assertions. R02 requires a real Choice -> Control -> new Revision/Grounding ->
snapshot. Missing choices are recorded as a context-specific external gap, not
as proof that the whole upstream service lacks selection support. No completion
marker is emitted by this harness.

Exit 0: both live cases passed. Exit 2: observations completed but required
positive/selection evidence is missing. Exit 1: assertion/runtime failure. The
finally block closes only this invocation's local resources and stops its named
temporary PostgreSQL container. It never changes shared deployments or cancels
shared tasks; submitted read-only upstream tasks follow their normal lifecycle.
