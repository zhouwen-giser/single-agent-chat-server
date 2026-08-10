# 01. Source Reference Policy

## SACS

`https://github.com/zhouwen-giser/single-agent-chat-server`

制作本包时观察值（只作为设计参考）：

```text
main         3e5be7150e959006d4d152ba6d0d32ebc93ab419
v0.1 feature 085e456c9802462c5d0c2a8c2310cadbfa760a96
PR #1        Draft/Open
status       IN_PROGRESS
Phase13      in progress
```

执行时必须重新读取最新 main 中至少：

```text
README.md
DESIGN_BASELINE.md
PROJECT_STATUS.md
package.json
docs/api/openai-chat-completions.md
docs/integrations/sdar-a2a.md
packages/sdar-a2a-adapter/src/client.ts
packages/sdar-a2a-adapter/src/normalize.ts
packages/chat-runtime/src/task-coordinator.ts
src/agent/classification.ts
migrations/*
tests/*
reports/goal/13-final-acceptance.*
```

## SDAR

`https://github.com/zhouwen-giser/skill-driven-agent-runtime`

设计参考：

```text
main         a9957c82c17ca01e77528f3817c03d86224aaf88
version      1.4.1
A2A SDK      1.0.0-beta.0
protocol     1.0
spec patch   1.0.1
binding      HTTP+JSON
Agent Card   /.well-known/agent-card.json
A2A endpoint /a2a
```

执行时锁定当日最新 main，并阅读：

```text
package.json
packages/a2a-adapter/src/compatibility.ts
packages/a2a-adapter/src/http-endpoint.ts
packages/a2a-adapter/src/task-service-executor.ts
packages/a2a-adapter/src/task-mapping.ts
packages/a2a-adapter/src/node-control-agent-card.ts
```

## AG-UI

`https://github.com/ag-ui-protocol/ag-ui`

设计参考锁：

```text
release        release/2026-08-07
commit         338708ca8b57deda9c82d0329f30944ab4b0dea6
@ag-ui/core    0.0.57
@ag-ui/client  0.0.57
@ag-ui/encoder 0.0.57
@ag-ui/a2a     0.0.6 (Experimental, reference only)
```

设计参考 `@ag-ui/a2a@0.0.6` 依赖 `@a2a-js/sdk ^0.2.2`，与当前 SACS/SDAR 的
`1.0.0-beta.0` 不兼容，因此默认不得直接替换 SACS A2A Adapter。

执行时 P00 必须查询官方最新 release，做 Source Intake，精确 pin 关键协议包；不允许
`latest`、关键包 `^` 或无审计自动升级。若 breaking change，先 ADR 和合同测试。
