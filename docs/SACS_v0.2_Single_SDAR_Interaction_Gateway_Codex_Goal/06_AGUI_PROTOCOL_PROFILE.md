# 06. AG-UI Protocol Profile

## 官方权威

执行时只使用精确锁定的 `ag-ui-protocol/ag-ui` official source/packages。

设计参考 `release/2026-08-07`：

```text
@ag-ui/core    0.0.57
@ag-ui/client  0.0.57
@ag-ui/encoder 0.0.57
```

P00 必须重新审计当日官方 release，代码由官方 `RunAgentInput/Event/Interrupt/ResumeEntry`
types 和 encoder 驱动，禁止手写“看起来像 AG-UI”的近似对象。

## Endpoint

建议：

```http
POST /ag-ui
Accept: text/event-stream
Content-Type: application/json

GET /ag-ui/capabilities
```

## v0.2 Profile

实现当日官方对应：

- Run lifecycle；
- Text；
- State Snapshot/Delta；
- Activity Snapshot/Delta；
- Custom；
- Interrupt/Resume；
- Run Error。

State Delta 使用官方 JSON Patch/RFC6902 语义。

## Tool / Raw

Tool Call 默认不发出；只有 SDAR A2A 明确公开了版本化 Tool Call data contract 时才能映射，
不能把内部 MCP/Skill 调用伪装成 Tool Call。

外部 `RAW` 默认禁用；诊断也必须 allowlist + redaction。

## Run boundary

Run 结束可能是 Task terminal、Interrupt、query 完成、观察窗口结束或技术失败。
`RUN_FINISHED` 不能统一解释为 SDAR Task completed。
