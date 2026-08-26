# v0.3.0 release-candidate checklist

## Qualified source and product boundary

- [x] Latest main is included without rebase/force-push.
- [x] One fixed SDAR, A2A 1.0 HTTP+JSON and official SDK 1.0.0-beta.0 only.
- [x] Real configured model with no tools, endpoint selection or fallback.
- [x] OpenAI and AG-UI share durable context, Task Directory, Focus, authorization
      and strict TASK/MESSAGE results; mutable operations require a unique Task.
- [x] Unexpected southbound auth fails closed; northbound keys/JWT remain enforced.
- [x] No direct SMPP, MCP, Provider or SDAR management/database access.

## P13 qualification completed

- [x] All static, unit, contract, security, PostgreSQL and protocol gates; zero skips.
- [x] Genuine model multi-turn memory and strict Turn Decision.
- [x] Genuine SDAR two-active-Task, focus, precise read, ambiguity and disconnect.
- [x] v0.2 upgrade and SACS/PostgreSQL restart with context/result recovery.
- [x] Source and network boundaries; all five evidence documents aggregated.
- [x] Production Docker, hardened isolated Compose/cleanup and CycloneDX SBOM.
- [x] P13 completion/acceptance/publication and successful evidence-commit CI.

## P14 post-commit gate

These boxes are resolved in the **P14 exact-head publication receipt** on
[PR #14](https://github.com/zhouwen-giser/single-agent-chat-server/pull/14), not
pre-checked in a commit that has yet to run:

- [ ] Final SHA passes the full `verify:v03` command with zero required skips.
- [ ] Local HEAD, remote branch, PR HEAD and all real evidence identify that SHA.
- [ ] Both final-head Push and PR CI complete successfully, including containers.
- [ ] Final sanitized acceptance receipt and SBOM/log hashes are published.
- [ ] Actual PR state is Ready and verified after the transition.
- [x] Merge remains user-controlled; no tag, Release or production deployment.

See [qualification](release-candidate-v0.3.md),
[traceability](traceability-v0.3.md), and
[P14 publication](../reports/v0.3/P14-publication.md).
