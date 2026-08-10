# 02. Product Scope & Non-Goals

## 定位

`single-agent-chat-server v0.2` = **Single SDAR Interaction Gateway**

```text
OpenWebUI --OpenAI-compatible--\
                                > Unified Interaction Runtime --A2A--> exactly one SDAR
AG-UI UI -----AG-UI/SSE--------/
```

## 必须完成

- v0.1 OpenAI-compatible 能力零回退；
- 标准 AG-UI 北向接口；
- 统一内部 typed event stream；
- A2A submit/status/result/history/follow-up/cancel；
- Agent Card capability query；
- State/Activity/Custom 映射；
- Input Required → Interrupt；
- Resume → A2A Follow-up；
- Principal/Thread/Task Binding；
- Request/Run 幂等和 restart recovery；
- 安全、脱敏、限流；
- real OpenWebUI E2E；
- official AG-UI Client real E2E；
- current SDAR real E2E；
- Docker/SBOM/release evidence。

## 明确非目标

禁止引入：

- multi-SDAR router / Agent Mesh；
- Hierarchical Organization Control Plane；
- Node Control API proxy；
- Telemetry Query / ClickHouse；
- SMPP Registry；
- SACS 业务路径中的 MCP Registry/Client；
- Skill / Capability 管理；
- 第二个 Agent Runtime / Workflow Runtime；
- A2A server；
- 浏览器直接访问 SDAR；
- SACS 直接访问 SDAR PostgreSQL/Redis。

## 权威

```text
SDAR = Goal/Plan/Task/Skill/Execution/Evidence authority
SACS DB = identity/thread/binding/idempotency/run/interrupt/safe LKG
OpenAI/AG-UI = interaction presentation protocols
```
