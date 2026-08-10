# 13. Test / Evidence / Release Policy

## 层级

Unit：
interaction event、intent/query、renderers、AG-UI mapping、interrupt、redaction、idempotency。

Contract：
OpenAI predecessor、official AG-UI types/events、A2A adapter、Agent Card、JSON Patch、Custom catalog。

PostgreSQL Integration：
v0.1 upgrade、principal/thread isolation、claims、run、interrupt、crash/restart。

Real E2E 必须分开：

```text
OpenWebUI → SACS → SDAR
official AG-UI Client → SACS → SDAR
```

fixture 不可替代。

## P12 Current SDAR

执行时锁定 exact：

```text
repository + SHA + package version + A2A SDK + Agent Card hash
```

真实验证 Agent Card/capability exposure/new task/stream/getTask(history)/result/
plan confirmation/provide input/pause-resume/cancel/capability gap/long observation。

同一 Task：

```text
OpenAI interpretation == AG-UI public state == normalized A2A source
```

## P13 exact candidate gate

至少：

```text
format/lint/typecheck
unit/contract/security
native PostgreSQL integration
OpenAI fixture + AG-UI fixture
real OpenWebUI E2E
real official AG-UI Client E2E
real current-SDAR E2E
migrations/architecture/source-lock/licenses/secret
build/smoke
Docker build/Compose clean start/container hardening
SBOM
```

全部在 exact candidate HEAD 上执行。任何 required skip = release blocker。
