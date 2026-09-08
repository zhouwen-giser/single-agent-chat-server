# S07 — Production Composition, Configuration and Operations

## Dependency

```text
S06
```

## Objective

把 Grounding Job Analysis runtime 正式装配到正常 SACS server，提供受控 feature flags、分析能力状态、监控与安全日志，并完成开发轨全量验证。

## Required work

1. 在正常 `main.ts`/bootstrap 中创建 contract-aware WSGS client、Grounding Job adapter、Analysis runtime、analysisControl 与 `runAgUiV03`。
2. 复用现有 persistence runtime，不建立独立数据库连接池。
3. 实现配置 Schema、默认值、范围校验和 `.env.example`。
4. `GROUNDING_JOB` 为启用分析时的默认生产 transport。
5. `FIXTURE` 在 production fail-fast；`NATIVE` 无权威 bundle 时 fail-closed。
6. 提供 analysis capabilities/readiness 安全视图。
7. 高级可选能力不可用时，只影响对应请求，不使普通 Chat/Task/legacy Grounding 整体 unhealthy。
8. 增加 bounded telemetry counters/timers。
9. 确保日志与 public errors 不泄露 token、payload、geometry、user text、DB URL。
10. 防止一名用户创建无限 pump；复用 rate limiter/lease limits。
11. 更新 README、部署说明、版本与 changelog。
12. 添加 `test:v06:*` 与 `verify:v06:*` scripts。
13. 运行所有 DEVELOPMENT 必需验收并生成 source-bound evidence。

## Required verification

- production bootstrap with Grounding Job。
- production fixture rejection。
- native missing bundle failure。
- analysis disabled compatibility。
- optional capability isolation。
- config bounds。
- log/telemetry redaction。
- rate/pump bounds。
- full v0.6 focused tests。
- PostgreSQL/local listener E2E。
- migration/architecture/secrets/lint/typecheck/build。

## Required outputs

- Production composition。
- Config/env/docs。
- Development verification。
- `SACS_WSGS_FULL_FUNCTIONAL_INTEGRATION_DEV_READY`（仅全部开发行 PASS 时）。

## Phase completion marker

```text
SACS_V06_RUNTIME_WIRED
```

只有该 Phase 对应的全部 required acceptance rows 为 PASS 时才能写入该标志。

## Commit

Recommended semantic commit:

```text
feat(v0.6): wire WSGS analysis into production server
```

提交前必须更新 Phase report 和 Acceptance Ledger。若远程可用，可推送当前阶段；不得 force-push。

## Fail-closed / stop condition

若真实 WSGS 尚未运行，仍可完成 DEVELOPMENT，但不得输出真实集成标志。不得让 fixture 路径从正常 production main 被隐式选择。
