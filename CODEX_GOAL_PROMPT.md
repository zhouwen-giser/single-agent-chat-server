# Codex Goal Prompt — single-agent-chat-server v0.1.0 (R2)

你正在一个新的或已有的 Git 仓库中，自主完成 `single-agent-chat-server` 项目。

目标：基于当前受维护的 LangGraph.js 项目模板，构建一个只服务于单个 SDAR Agent 的聊天入口服务，并让已经部署在 Docker 中的 Open WebUI 通过 OpenAI-compatible API 使用它。

```text
Open WebUI
  → OpenAI Chat Completions API
  → single-agent-chat-server
  → thin LangGraph Chat Graph
  → A2A 1.0 HTTP+JSON Client
  → one SDAR Agent
```

开始前必须阅读本任务包全部文件，尤其是：

```text
SINGLE_AGENT_CHAT_SERVER_CODEX_GOAL_TASK_PACKAGE_CN.md
SDAR_A2A_COMPATIBILITY_BASELINE.md
DESIGN_BASELINE.md
AGENTS.md
acceptance-matrix.json
```

SDAR 协议冻结基线：

```text
upstream: https://github.com/zhouwen-giser/skill-driven-agent-runtime
inspected main commit: 667146a3639eefdfed9b89c2417c08e1ac50e9a9
A2A spec patch: 1.0.1
wire version: 1.0
transport: HTTP+JSON / REST
SDK: @a2a-js/sdk@1.0.0-beta.0
Agent Card: /.well-known/agent-card.json
A2A endpoint: /a2a
```

只允许通过官方 SDK 的 `sendMessageStream`、`sendMessage`、`getTask`、`cancelTask` 与 SDAR 交互。不得实现旧式 `tasks/send` 等接口，不得优先使用 v0.3，不得自行升级 SDK。

向已有 Task 发送 Message 时必须生成合法的 `metadata.sdar_action`。支持值只有：`confirm_plan`、`reject_plan`、`revise_plan`、`patch_goal`、`cancel_goal`、`provide_input`、`pause`、`resume`。Follow-up metadata 只允许 `sdar_action`、可选 `input_request_id`、可选 `user_id`。

必须区分 `INPUT_REQUIRED` 的 `internalPhase`：计划确认、用户输入和 paused 不能使用同一处理。SDAR 的 A2A stream 是有界的；非终态结束后使用 `getTask()` polling，不得假设 event cursor 或任意 Task resubscription。

必须自主完成：仓库初始化、设计落库、代码实现、PostgreSQL 持久化、Open WebUI 对接、A2A Task 创建/查询/Follow-up/取消/有界流、断线恢复、测试、Docker、CI、阶段提交、GitHub Draft PR、真实 SDAR 端到端验收和最终发布证据。

必须遵守：

- 只服务一个固定 SDAR，不实现 Mesh、Registry、Agent Router 或 Capability Discovery；
- 不直接访问 SDAR 管理 API、PostgreSQL、ClickHouse 或 MCP；
- Chat Agent 不规划 Workflow、不选择 Skill、不调用 MCP、不修改 SDAR 内部状态；
- Open WebUI 是外部 UI，不在本仓库开发 UI；
- 固定 `@a2a-js/sdk@1.0.0-beta.0` 并隔离在 Adapter；
- 当前 SDAR A2A 无认证，只能部署在可信隔离网络；
- 支持显式 `SDAR_A2A_ENDPOINT_OVERRIDE` 解决容器 Agent Card 发布 `0.0.0.0`，禁止静默改写；
- 每个 Phase 独立 commit 并立即 push；不得 force-push、不得伪造测试；
- 所有 required 验收和真实 E2E 通过、PR Ready 后，才输出 `SINGLE_AGENT_CHAT_SERVER_GOAL_COMPLETE`；
- 未经用户授权不得合并 PR或修改 SDAR 上游仓库。

现在执行 Phase 0，不要停留在设计阶段。
