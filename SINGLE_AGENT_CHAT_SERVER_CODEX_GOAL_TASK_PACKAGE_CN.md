# single-agent-chat-server v0.1.0
## Codex Goal 模式自主开发任务包

> **文档状态：** Codex 可执行任务包  
> **目标项目：** `single-agent-chat-server`  
> **建议仓库：** `zhouwen-giser/single-agent-chat-server`  
> **目标版本：** `v0.1.0`  
> **执行方式：** Codex Goal 模式  
> **生成日期：** 2026-07-18  
> **任务包修订：** R2（按 SDAR 当前 A2A 1.0.1 实现校正）  
> **UI：** 已部署的 Open WebUI Docker 容器  
> **Agent 基座：** 受维护的 LangGraph.js 项目模板  
> **Agent 通信：** A2A 1.0 HTTP+JSON，固定 `@a2a-js/sdk@1.0.0-beta.0`  
> **目标 Agent：** 一个固定配置的 SDAR A2A Agent  
> **许可证：** Apache-2.0

---

# 0. 总 Goal

在不建设 Agent Mesh、不修改 SDAR Runtime、不开发新 UI 的前提下，自主完成一个可部署的 `single-agent-chat-server`：

```text
Open WebUI
  → OpenAI-compatible Chat API
  → single-agent-chat-server
  → thin LangGraph Chat Graph
  → official A2A Client
  → SDAR Agent
```

用户应当能够：

1. 在 Open WebUI 中进行普通对话；
2. 通过自然语言向 SDAR 发起 A2A Task；
3. 在当前响应中看到一段受限时长的实时执行进度；
4. 在任务长时间运行时结束当前 HTTP Stream，并在后续消息中继续查询；
5. 在 SDAR 返回 `INPUT_REQUIRED` 时，根据 `Task.metadata.internalPhase` 区分计划确认、补充输入和暂停状态，并发送合法 Follow-up；
6. 查询任务状态；
7. 取消任务；
8. 查看 SDAR 明确发布的 Task 状态、`phaseMessage` 和最终 Result Artifact；
9. 在服务或网络重启后恢复会话与任务绑定；
10. 防止 Open WebUI 重试导致重复创建 SDAR Task。

Codex 必须完成代码、测试、Docker、CI、文档、阶段提交、Draft PR、真实 SDAR 联调和最终验收，不得停留在设计或脚手架阶段。

---

# 1. 重要上游事实与技术修正

## 1.1 LangGraph 模板

早期 `langchain-ai/create-agent-chat-app` 仓库已经归档，不得作为生产基线。

当前使用：

```bash
npm create langgraph
```

或执行时官方维护的等价 JavaScript/TypeScript 模板。

要求：

- 保留 `langgraph.json` 和本地 Studio 调试能力；
- 生产服务不依赖 LangSmith Cloud；
- Open WebUI 不连接 LangGraph 原生 API，而连接本项目的 OpenAI-compatible API；
- 不引入 Agent Chat UI，因为当前 UI 已由 Open WebUI 提供。

## 1.2 SDAR A2A 协议冻结基线

本项目必须兼容当前 SDAR 仓库：

```text
https://github.com/zhouwen-giser/skill-driven-agent-runtime
inspected main commit: 667146a3639eefdfed9b89c2417c08e1ac50e9a9
```

冻结协议：

```text
A2A Specification patch baseline: 1.0.1
A2A wire protocol version:        1.0
Transport binding:                HTTP+JSON / REST
Official SDK:                     @a2a-js/sdk@1.0.0-beta.0
Agent Card:                       /.well-known/agent-card.json
Default A2A endpoint:             /a2a
Streaming:                        true
Push notifications:              false
SDAR A2A authentication:          none in current V1.1
```

依据文件：

```text
package.json
third_party/a2a-1.0.1-baseline.json
packages/a2a-adapter/src/compatibility.ts
packages/a2a-adapter/src/http-endpoint.ts
packages/a2a-adapter/src/task-service-executor.ts
packages/a2a-adapter/src/task-mapping.ts
apps/example-a2a-client/src/client.ts
scripts/verify-a2a-baseline.mjs
scripts/run-a2a-tck.mjs
```

禁止：

- 不得优先选择 A2A v0.3；
- 不得使用旧式 `tasks/send`、`tasks/get`、`tasks/update`、`tasks/cancel` 命名实现；
- 不得启用 JSON-RPC 或 gRPC 后假定 SDAR 已提供对应端点；
- 不得自行升级 `@a2a-js/sdk`，除非先证明 SDAR 已同步升级并更新协议契约、ADR 和 E2E；
- 不得把 SDK 的 protobuf/domain 类型泄漏出 `packages/a2a-sdar-client`。

客户端必须使用官方 SDK 能力：

```text
ClientFactory.createFromUrl / createFromAgentCard
client.sendMessageStream
client.sendMessage
client.getTask
client.cancelTask
```

初始任务 Message 至少包含一个 `text/plain` Part。第一版只向初始 Message metadata 写入：

```text
user_id
structured_input（仅在已有可靠结构化输入时）
```

Open WebUI Chat ID、Message ID、幂等键和相关 ID 保存在本项目数据库或请求头/Trace 中，不得塞入 SDAR Follow-up metadata。

### 1.2.1 Follow-up 严格合同

向现有 `taskId/contextId` 发送 Message 时，必须携带合法 `metadata.sdar_action`。当前 SDAR 支持：

```text
confirm_plan
reject_plan
revise_plan
patch_goal
cancel_goal
provide_input
pause
resume
```

Follow-up metadata 是严格对象，只允许：

```text
sdar_action
input_request_id（可选）
user_id（可选）
```

`provide_input` 可携带文本 Part 和最多一个 Data Part；Data Part 不得用于其他 Follow-up 动作。不存在通用 `updateTask()` 协议操作。

### 1.2.2 状态与流式边界

SDAR 当前将内部 Phase 映射为标准 A2A State：

```text
queued                                           → SUBMITTED
普通执行阶段                                     → WORKING
awaiting_plan_confirmation / awaiting_user_input → INPUT_REQUIRED
paused                                           → INPUT_REQUIRED
completed                                        → COMPLETED
canceled                                         → CANCELED
failed / invalidated / capability_gap             → FAILED
```

CAG 必须同时读取并保存受验证的：

```text
Task.status.state
Task.status.message
Task.status.timestamp
Task.metadata.internalPhase
Task.metadata.errorCode
Task.metadata.capabilityGap
Task.artifacts
```

`sendMessageStream()` 是有界流：SDAR 默认约 30 秒后可在 Task 仍为 `WORKING` 时结束本次流。流结束不等于任务结束。随后必须使用 `getTask()` 轮询；当前协议不提供可依赖的事件 cursor 或任意 Task 的重新订阅方法。

### 1.2.3 Docker Agent Card 地址修正

SDAR 当前可能把监听 Host 直接写入 Agent Card。当容器以 `0.0.0.0` 监听时，Card 可能发布不可调用的：

```text
http://0.0.0.0:9999/a2a
```

本项目必须支持显式配置：

```text
SDAR_A2A_BASE_URL=http://sdar:9999
SDAR_A2A_ENDPOINT_OVERRIDE=http://sdar:9999/a2a
```

Adapter 应先获取并校验 Agent Card；仅在显式配置 Override 时复制 Card 并替换对应 HTTP+JSON Interface URL，再调用 `createFromAgentCard()`。禁止静默重写或信任任意用户提供的 Endpoint。

当前 Agent Card 的应用版本可能是 `0.0.0`，不得将该字段作为协议兼容判断依据。兼容判断以 `supportedInterfaces[].protocolVersion`、`protocolBinding` 和契约测试为准。

## 1.3 Open WebUI

实现完整兼容的最小接口：

```text
GET /v1/models
POST /v1/chat/completions
```

同时支持：

```text
stream=false
stream=true
```

Open WebUI 连接配置必须记录到部署文档，并启用：

```text
ENABLE_FORWARD_USER_INFO_HEADERS=true
FORWARD_USER_INFO_HEADER_JWT_SECRET=<shared secret>
```

推荐通过自定义转发头携带：

```text
X-OpenWebUI-Chat-Id
X-OpenWebUI-Message-Id
X-OpenWebUI-User-Message-Id
X-OpenWebUI-User-Message-Parent-Id
X-OpenWebUI-Task
```

`X-OpenWebUI-Task` 表示 title/tag/follow-up 等后台请求时，禁止创建 SDAR Task。

---

# 2. Goal 模式执行规则

## 2.1 自主执行

Codex 自主完成：

- 仓库创建或初始化；
- 官方模板选择和版本固定；
- 设计文档与 ADR；
- 实现；
- PostgreSQL Migration；
- 测试；
- Open WebUI 配置；
- SDAR A2A 联调；
- Git 提交和推送；
- Draft PR；
- 最终验收。

不要为普通实现细节逐项询问用户。

## 2.2 仓库不存在时

目标远程仓库：

```text
https://github.com/zhouwen-giser/single-agent-chat-server.git
```

如果远程不存在：

1. 在当前工作目录创建项目；
2. 初始化 Git；
3. 添加 Apache-2.0、README、SECURITY、CONTRIBUTING、CODEOWNERS；
4. 若已拥有 GitHub 创建权限，创建同名仓库并推送；
5. 若没有创建权限，完成可提交的本地成果，生成 blocker，不宣称 Goal 完成。

不要覆盖同名已有仓库。

## 2.3 持久化 Goal 状态

创建并持续更新：

```text
execplans/EP-01-single-sdar-chat-entry.md
reports/goal/sync-state.json
reports/goal/00-baseline.md
reports/goal/00-baseline.json
```

每个 Phase 更新：

- 当前 branch/HEAD/main SHA；
- 已完成内容；
- tests actually run；
- commit/push；
- Open WebUI 状态；
- SDAR Agent Card/协议状态；
- blocker；
- 下一步。

## 2.4 阶段提交

每个 Phase 必须：

1. 完成本阶段最小闭环；
2. 运行本阶段测试；
3. 更新报告和 ExecPlan；
4. 独立 commit；
5. 立即 push；
6. 更新 Draft PR。

禁止：

- force push；
- 已推送后 amend；
- 伪造测试；
- 删除失败测试；
- 多个 Phase 堆成一个大提交；
- 绕过 `main` 保护。

## 2.5 阻塞处理

仅以下情况允许停止：

- 无 GitHub 写权限；
- 目标仓库无法安全创建或恢复；
- 真实 SDAR A2A Endpoint 不可获得；
- SDAR Agent Card 不再满足冻结的 A2A 1.0/HTTP+JSON 合同，且无法通过显式、受测的 Adapter 兼容层解决；
- 未修改基线测试真实失败且不能安全归因；
- 无法保证用户/Chat/Task 隔离；
- Open WebUI 的必要认证信息缺失，或 SDAR 容器网络/Agent Card Endpoint 无法安全解析；
- 引入的依赖许可证不符合项目要求。

停止时必须写 blocker、commit、push、更新 PR，并给出恢复条件。

---

# 3. Git 和仓库治理

## 3.1 分支

```text
feature/single-sdar-chat-entry-v0.1
```

若新仓库：

- 先建立 `main` 初始治理提交；
- 再创建 feature branch。

若仓库已有：

- 从最新 `origin/main` 创建；
- 不覆盖现有未提交修改；
- 必要时使用 worktree。

## 3.2 PR

Phase 0 后创建 Draft PR：

```text
title: feat: build single SDAR chat entry server
base: main
head: feature/single-sdar-chat-entry-v0.1
```

PR Body 持续记录：

- Phase；
- latest commit；
- tests；
- SDAR protocol revision；
- Open WebUI integration；
- E2E state；
- blockers；
- remaining work。

最终所有 required checks 通过后标记 Ready for Review，但不得自动 merge。

## 3.3 保护建议

在权限允许时设置：

- `main` PR-only；
- required CI；
- linear history；
- squash-only merge；
- 禁止 force push/delete；
- release tag protection。

无法设置时记录为 repository-admin follow-up，不阻断代码完成。

---

# 4. 目录和模块基线

以官方模板生成结果为准，推荐演进为：

```text
single-agent-chat-server/
  apps/
    server/
      src/
        api/
        auth/
        composition/
        observability/
        bootstrap.ts
  packages/
    chat-graph/
      src/
        graph.ts
        state.ts
        nodes/
        prompts/
    a2a-sdar-client/
      src/
        client.ts
        agent-card.ts
        transport.ts
        mapping.ts
        stream.ts
    openai-api-contract/
      src/
        chat-completions.ts
        streaming.ts
        models.ts
    conversation-store/
      src/
        task-binding-repository.ts
        idempotency-repository.ts
        task-observation-repository.ts
    shared-contracts/
  infra/
    postgres/migrations/
    docker/
  schemas/
  tests/
    fixtures/
    integration/
    e2e/
  docs/
  reports/goal/
  execplans/
```

实际目录可按模板调整，但必须保持：

- API；
- Chat Graph；
- A2A Adapter；
- Persistence；
- Contracts；
- Observability；
- Tests；

边界清晰。

---

# 5. 关键运行模型

## 5.1 请求分类

```text
utility
normal_chat
new_sdar_task
task_status
task_follow_up
task_cancel
```

`task_follow_up` 必须进一步输出一个受限 Action：

```text
confirm_plan
reject_plan
revise_plan
patch_goal
cancel_goal
provide_input
pause
resume
```

优先确定性判断：

1. `X-OpenWebUI-Task` 非空 → `utility`；
2. 明确查询进度/状态 → `task_status`，不得作为 Follow-up 发给 SDAR；
3. 明确取消顶层 Task → `task_cancel`，调用标准 `cancelTask()`；
4. 存在 active Task 且为 `INPUT_REQUIRED` 时，先读取 `Task.metadata.internalPhase`：
   - `awaiting_plan_confirmation`：只有明确确认、拒绝、修改计划或修改目标时才映射对应 Follow-up；
   - `awaiting_user_input`：普通的实质性回答可映射为 `provide_input`；
   - `paused`：只有明确恢复时映射为 `resume`，不得把普通消息当输入；
5. 明确暂停/恢复/修改当前任务时 → 合法 `task_follow_up`；
6. 其他使用结构化 LLM 分类。

LLM 输出必须经过 Zod Schema 校验和确定性状态 Guard，不允许任意路由或任意 `sdar_action`。

## 5.2 单任务约束

一个 Open WebUI Chat 同一时刻最多绑定一个 active SDAR Task。

若已有 active task，用户试图发起新任务：

- 默认解释当前任务并请求明确取消/完成后再新建；
- 不静默创建第二个任务；
- 未来多任务不属于 v0.1。

## 5.3 A2A 提交

用户消息通过 `SendMessageRequest` 作为 A2A `text/plain` Part 发送。

CAG 不应预先生成 SDAR Goal/Plan Schema。初始 Message metadata 在 v0.1 只允许：

```text
user_id
structured_input（可选，仅来源可靠时）
```

Chat ID、Open WebUI Message ID、幂等键、Locale 和 Correlation ID 属于本项目状态或 Trace，不写入严格 Follow-up metadata。SDAR 自己负责 Goal、Skill、Workflow 和执行规划。

## 5.4 A2A 状态和事件

当前 SDAR A2A Executor 确认发布：

```text
Task
TaskStatusUpdateEvent
```

最终结果位于终态 Task 的 `result` Artifact 中，包含 `text/plain` 与 `application/json` Part。Adapter 可以兼容标准 Artifact Update，但 v0.1 不得把增量 Artifact Update 作为 SDAR 必备能力或验收前提。

内部映射：

```text
task_created
status_changed
input_required
completed
failed
canceled
result_artifact
```

进度文本只能来自 `Task.status.message`/`phaseMessage` 和真实 Artifact 摘要。保留受验证事件摘要和 hash，不把 SDK 类型泄漏到 Graph，也不伪造 Skill、Workflow Node、MCP 或 Verification 时间线。

## 5.5 输入补充

当 SDAR 进入 `INPUT_REQUIRED`：

- 保存 `taskId`、`contextId`、`internalPhase`、状态消息以及可识别的 `input_request_id`；
- `awaiting_plan_confirmation` 必须请求用户明确确认、拒绝或修改，不得把任意下一条消息自动当确认；
- `awaiting_user_input` 时，下一条实质性回答可通过 `sendMessage()` 发送 `sdar_action=provide_input`；
- `paused` 时仅接受明确 `resume`、`cancel` 或状态查询；
- Follow-up 必须复用同一 `taskId/contextId`；
- Follow-up metadata 只能包含 `sdar_action`、可选 `input_request_id` 和可选 `user_id`；
- 发送成功后消费本次返回，并在非终态时继续 `getTask()` 查询。

## 5.6 取消

- 只允许取消当前用户/Chat 绑定的顶层 Task；
- 使用标准 `client.cancelTask()`，以 SDAR 返回的顶层 A2A Task State 为权威；
- 不把“顶层 Task 已取消”解释成底层远程 MCP Provider 已确定释放全部资源；
- v0.1 不读取 SDAR 内部 Remote Task Lifecycle，也不自行推断 Provider 取消确认。

## 5.7 过程解释

只展示：

- A2A status；
- SDAR 明确发布的消息；
- 终态 Result Artifact 的文本/结构化摘要；
- SDAR 明确发布并经 Adapter allowlist 验证的 metadata；
- 错误码和稳定说明。

禁止展示或推断模型隐藏思维过程。

---

# 6. PostgreSQL 模型

使用：

```text
@langchain/langgraph-checkpoint-postgres
```

并建立本项目自己的 append-only Migration。

建议业务表：

## `chat_thread_binding`

```text
thread_id
openwebui_chat_id
user_id
user_role
created_at
updated_at
```

唯一：

```text
(openwebui_chat_id, user_id)
```

## `conversation_task_binding`

```text
binding_id
thread_id
sdar_task_id
sdar_context_id
status
pending_input_json
last_status_timestamp
last_event_hash
created_at
updated_at
terminal_at
version
```

## `request_idempotency`

```text
idempotency_key
user_id
openwebui_chat_id
request_hash
result_task_id
status
lease_owner
lease_until
created_at
updated_at
```

## `a2a_event_cache`

```text
event_id
task_id
event_kind
event_hash
status
summary_json
occurred_at
received_at
```

规则：

- 不复制 SDAR Goal/Plan/Skill/Action 数据；
- 同一 Open WebUI 用户消息重试不得重复提交 A2A Task；
- Checkpointer 使用独立 schema，例如 `langgraph_checkpoint`；
- Migration 只追加；
- 重启后可恢复 active binding。

---

# 7. API 和流式兼容

## 7.1 `/v1/models`

至少返回一个稳定模型 ID：

```text
sdar-single-agent
```

## 7.2 `/v1/chat/completions`

支持 OpenAI Chat Completions 最小字段：

```text
model
messages
stream
temperature
top_p
max_tokens / max_completion_tokens
stop
user
```

不支持或忽略的字段必须有兼容行为和测试。

## 7.3 Streaming

输出标准：

```text
data: <ChatCompletionChunk JSON>\n\n
...
data: [DONE]\n\n
```

事件进度以 Markdown 文本 delta 表达，例如：

```text
✓ SDAR 已接收任务
⏳ 正在规划
⏳ 等待远程执行结果
```

不得向 Open WebUI 注入未标准化自定义 SSE JavaScript 事件。

## 7.4 Bounded Stream

默认：

```text
CHAT_STREAM_MAX_DURATION_MS=120000
```

超过后：

- 输出当前 task ID/status；
- 提示任务仍在后台执行；
- 正常 `[DONE]`；
- 不取消 SDAR Task；
- 后续状态查询继续使用 binding。

## 7.5 Utility Requests

标题、标签、后续建议等 Open WebUI 后台调用：

- 使用本地 LLM 生成简短结果；或
- 按配置返回稳定简化文本；
- 永远不调用 A2A。

---

# 8. 安全模型

## 8.1 Open WebUI → Server

两层认证：

1. Open WebUI Connection Bearer Service Key；
2. Signed User Info JWT。

验证：

```text
iss=open-webui
sub
exp
iat
role
```

明文 `X-OpenWebUI-User-*` 不能单独作为可信身份。

## 8.2 Server → SDAR

当前 SDAR V1.1 A2A 端点无认证、无授权、无租户隔离，必须部署在 localhost 或隔离的可信 Docker/内网网络中。

v0.1 必须配置固定的：

```text
SDAR_A2A_BASE_URL
SDAR_A2A_ENDPOINT_OVERRIDE（仅解决显式的 advertised URL 问题）
```

不得把 SDAR A2A 端点直接暴露到公网。Bearer/mTLS 只保留为未来 Adapter 扩展点，不是当前 E2E 验收前提，也不得假装 SDAR 已验证这些凭据。

## 8.3 授权

- 每个 task 操作先验证本地 binding；
- 不允许按任意 task ID 查询/取消；
- user/chat 不匹配返回 404 或 403，避免泄漏存在性；
- 管理/调试接口独立权限。

## 8.4 输入边界

- request body limit；
- message count/length limit；
- Artifact size limit；
- response/event sanitization；
- Prompt injection 不可修改系统边界；
- 只允许单一配置 SDAR endpoint。

---

# 9. 分阶段开发计划

## Phase 0：仓库、模板和真实协议基线

**Commit：**

```text
docs: establish single SDAR chat server goal baseline
```

工作：

- 创建/检查仓库；
- 导入本任务包；
- 使用受维护 LangGraph JS 模板初始化；
- 确认 Node/pnpm 版本；
- 从真实 Agent Card 与 SDAR 源码确认 A2A 1.0.1/HTTP+JSON、SDK 版本、无认证现状及 Docker advertised URL；
- 确认 Open WebUI 版本/网络/连接方式；
- 运行未修改基线；
- 创建 ExecPlan、sync-state、reports；
- 创建 feature branch 和 Draft PR。

验收：

- 仓库和模板可运行；
- 协议冻结为 Spec 1.0.1 / wire 1.0 / HTTP+JSON / `@a2a-js/sdk@1.0.0-beta.0`，并记录 Agent Card hash；
- 无生产功能实现；
- commit/push/PR 完成。

---

## Phase 1：公共契约和 OpenAI API 骨架

**Commit：**

```text
feat: add OpenAI-compatible chat API contracts
```

实现：

- Fastify；
- `/v1/models`；
- `/v1/chat/completions` 非流/流骨架；
- ChatCompletion DTO/Zod；
- standard SSE encoder；
- health/readiness；
- config validation；
- static API key auth。

测试：

- OpenAI schema；
- stream chunks 和 `[DONE]`；
- invalid body；
- body limits；
- models discovery。

---

## Phase 2：LangGraph Chat Graph

**Commit：**

```text
feat: implement the thin single-agent chat graph
```

实现：

- State Schema；
- utility guard；
- active task guard；
- structured turn classification；
- general chat answer；
- response composition；
- no ReAct/MCP/Workflow planning。

测试：

- utility；
- normal chat；
- new task intent；
- status/input/cancel classification；
- invalid model output；
- prompt injection against architecture boundary。

---

## Phase 3：A2A SDAR Client Adapter

**Commit：**

```text
feat: integrate the official A2A SDAR client
```

实现：

- 固定 `@a2a-js/sdk@1.0.0-beta.0`；
- 获取并校验 `/.well-known/agent-card.json`；
- 只选择 `protocolBinding=HTTP+JSON`、`protocolVersion=1.0` 的 Interface；
- 显式 `SDAR_A2A_ENDPOINT_OVERRIDE` 支持，禁止静默 Endpoint 重写；
- `ClientFactory.createFromUrl()` 或校正 Card 后的 `createFromAgentCard()`；
- `sendMessageStream()` 创建任务并消费有界流；
- `sendMessage()` 发送严格 Follow-up；
- `getTask()` 查询非终态 Task；
- `cancelTask()` 取消顶层 Task；
- 初始 metadata 与 Follow-up metadata allowlist；
- `internalPhase`/`phaseMessage`/错误/Capability Gap/Result Artifact 映射；
- timeout/abort；
- 稳定内部 DTO，SDK 类型不越过 Adapter。

测试：

- A2A 1.0 HTTP+JSON Mock Server；
- Agent Card binding/version 校验；
- `0.0.0.0` advertised URL + 显式 Override；
- Task/Message/Status 响应；
- bounded stream 在 `WORKING` 时结束；
- `getTask()` polling fallback；
- 严格 Follow-up action/metadata；
- `provide_input` 文本/Data Part；
- `cancelTask()`；
- Result Artifact text+JSON；
- Capability Gap；
- malformed event；
- SDK/protocol drift fail-closed。

---

## Phase 4：PostgreSQL Persistence 和 Idempotency

**Commit：**

```text
feat: persist chat checkpoints and SDAR task bindings
```

实现：

- Postgres Checkpointer；
- migrations；
- thread mapping；
- task binding；
- idempotency claim/complete/recovery；
- event cache、状态时间戳和 event hash；
- startup setup/reconciliation。

测试：

- empty/upgrade migration；
- concurrent same message；
- same hash retry；
- different hash conflict；
- process restart；
- user/task binding isolation。

---

## Phase 5：Open WebUI 身份与会话集成

**Commit：**

```text
feat: integrate Open WebUI identity and chat continuity
```

实现：

- service key；
- signed user JWT；
- Chat ID 映射 thread_id；
- custom message identifiers；
- utility task header；
- Open WebUI connection deployment docs；
- Docker network examples。

测试：

- valid/expired/forged JWT；
- missing headers；
- two users same chat ID；
- utility requests do not call A2A；
- Open WebUI real connection smoke。

---

## Phase 6：Task Submit、状态和 Bounded Streaming

**Commit：**

```text
feat: submit SDAR tasks and stream bounded progress
```

实现：

- 用 `sendMessageStream()` 创建新 Task；
- 从 Task 事件持久化 `taskId/contextId`；
- 将真实 `status.message`/`phaseMessage` 映射为 Markdown delta；
- SDAR 流正常结束但 Task 仍为 `WORKING` 时，切换到有界 `getTask()` polling；
- Chat HTTP bounded stream 结束后 Task 继续运行；
- 后续状态查询只使用已授权 binding；
- 终态 `result` Artifact 文本与 JSON 摘要；
- 不承诺不存在的 Skill/MCP/Workflow 节点实时流。

测试：

- immediate Task/Message response；
- SDAR 约 30 秒流边界；
- long Task；
- phaseMessage progress；
- final Result Artifact；
- stream timeout without cancellation；
- client disconnect + later `getTask()` recovery；
- duplicate submit prevention。

---

## Phase 7：Input Required、Cancel 和终态解释

**Commit：**

```text
feat: handle SDAR input, cancellation and terminal outcomes
```

实现：

- `INPUT_REQUIRED` + `internalPhase` 判别；
- `confirm_plan`、`reject_plan`、`revise_plan`、`patch_goal`；
- `provide_input` + 可选 `input_request_id` + 最多一个 Data Part；
- `pause`、`resume` 和可选 `cancel_goal` Follow-up；
- 顶层 Task 使用标准 `cancelTask()`；
- 严格 Follow-up metadata allowlist；
- completed/failed/canceled/Capability Gap 解释；
- sanitize errors/artifacts。

测试：

- awaiting plan confirmation 不自动确认；
- confirm/reject/revise plan；
- awaiting user input；
- wrong phase/action；
- extra Follow-up metadata rejected locally；
- input rejected；
- paused/resume；
- cancel returned state；
- completed result；
- Capability Gap；
- business failure；
- protocol failure。

---

## Phase 8：恢复、并发和一致性

**Commit：**

```text
fix: harden chat task recovery and consistency
```

实现：

- startup active binding scan；
- bounded A2A stream completion后的 `getTask()` 恢复；
- A2A `getTask()` polling fallback；
- one active task per chat；
- optimistic versioning；
- safe shutdown；
- in-flight request lease recovery。

测试：

- server restart；
- Postgres restart；
- SDAR temporary outage；
- A2A stream drop/正常有界结束；
- concurrent turns；
- duplicate cancel/input；
- stale task event；
- terminal task cannot be reopened。

---

## Phase 9：Observability、安全和运维

**Commit：**

```text
feat: add secure observability and operational controls
```

实现：

- Pino JSON logs；
- OTel spans/metrics；
- correlation IDs；
- API/LLM/A2A latency；
- active task and stream gauges；
- redaction；
- rate limits；
- readiness dependency checks；
- no prompt/artifact secrets in logs。

测试：

- redaction；
- high-cardinality guard；
- telemetry unavailable；
- rate limit；
- graceful shutdown；
- readiness behavior。

---

## Phase 10：Docker、CI 和仓库治理

**Commit：**

```text
chore: add container deployment and CI quality gates
```

实现：

- multi-stage Dockerfile；
- Compose for server + PostgreSQL；
- external Open WebUI network docs；
- `.env.example`；
- migration command；
- Makefile/scripts；
- GitHub Actions；
- dependency/license/SBOM checks；
- security/governance files。

测试：

- image build；
- non-root；
- healthcheck；
- compose up/down；
- clean database startup；
- CI local-equivalent commands。

---

## Phase 11：真实 SDAR 和 Open WebUI E2E

**Commit：**

```text
test: verify the Open WebUI to SDAR A2A vertical slice
```

必须使用真实已部署 Open WebUI 和真实 SDAR A2A Server 验证：

1. Open WebUI model discovery；
2. 普通聊天；
3. A2A 1.0 HTTP+JSON Agent Card discovery；
4. 创建 SDAR Task；
5. `phaseMessage` 实时进度；
6. SDAR 有界 stream 结束后 `getTask()` 查询；
7. 计划确认/拒绝/修改；
8. `provide_input`；
9. pause/resume；
10. 顶层 `cancelTask()`；
11. completed + Result Artifact；
12. failed + Capability Gap；
13. restart recovery；
14. 用户隔离；
15. utility request 不创建 Task；
16. Docker advertised URL Override。

生成截图/日志/请求响应摘要，但不得保存凭据或隐私数据。

没有真实 E2E 证据不得标记本 Phase 完成。

---

## Phase 12：对抗性审查和修复

**Commits：**

```text
test: add adversarial single-agent chat coverage
fix: harden the single-agent chat boundary
```

主动寻找：

- Chat Server 变成 Planner；
- 直接访问 SDAR 内部 API/DB；
- 任意 task ID 越权；
- Open WebUI header spoofing；
- duplicate task submission；
- utility requests 触发任务；
- stream hanging；
- output injection；
- artifact/script injection；
- hidden reasoning leak；
- unbounded messages/events；
- A2A 协议/SDK drift 或错误 Transport；
- 任意下一条消息被错误映射成 Follow-up；
- Follow-up metadata 注入额外字段；
- `INPUT_REQUIRED` 未区分 plan/input/paused；
- 将顶层取消误述为 Provider 已确定停止；
- active task overwrite；
- stale terminal overwrite；
- auth token logging。

发现问题必须修复并加回归测试。

---

## Phase 13：最终验收和 v0.1.0 发布证据

**Commit：**

```text
docs: publish single-agent-chat-server v0.1.0 acceptance
```

更新：

- README；
- architecture；
- decisions/ADR；
- Open WebUI setup；
- operations/troubleshooting；
- API contract；
- A2A compatibility；
- security；
- CHANGELOG；
- PROJECT_STATUS；
- traceability；
- release checklist。

运行完整：

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm test:security
pnpm build
pnpm smoke
pnpm verify:migrations
pnpm verify:architecture
pnpm verify:openai-api
pnpm verify:a2a
pnpm verify:openwebui
pnpm verify
```

生成：

```text
reports/goal/13-final-acceptance.md
reports/goal/13-final-acceptance.json
```

全部通过后：

- push；
- PR Ready；
- 不自动 merge；
- 输出：

```text
SINGLE_AGENT_CHAT_SERVER_GOAL_COMPLETE
```

---

# 10. 验收矩阵摘要

| ID | 场景 | 结果 |
|---|---|---|
| AC-01 | Open WebUI 获取 `/v1/models` | 显示 `sdar-single-agent` |
| AC-02 | 普通聊天 | 不调用 SDAR |
| AC-03 | 新任务 | 只创建一个 A2A Task |
| AC-04 | A2A 状态流 | 只把真实 status/phaseMessage 转成 OpenAI SSE 文本 |
| AC-05 | 长任务 | SDAR 有界流结束后用 `getTask()`，Chat stream 结束时 Task 继续运行 |
| AC-06 | 后续进度查询 | 使用已有 binding，不创建或 Follow-up 新 Task |
| AC-07 | 计划确认 | 按 `internalPhase` 发送合法 `confirm_plan/reject_plan/revise_plan` |
| AC-08 | 补充输入 | `provide_input` 复用 Task/Context，metadata 严格受限 |
| AC-09 | cancel | 使用 `cancelTask()` 并显示 SDAR 返回的顶层状态，不推断 Provider |
| AC-10 | completed | 展示 `result` Artifact 的 text+JSON 摘要 |
| AC-11 | failed/capability gap | 区分失败类型且不泄漏内部数据 |
| AC-12 | Open WebUI 重试 | 幂等，不重复提交 |
| AC-13 | 服务重启 | 恢复 thread/task binding |
| AC-14 | A2A stream 中断/有界结束 | `getTask()` polling 恢复 |
| AC-15 | utility task | 不提交 SDAR Task |
| AC-16 | 用户隔离 | 无法查询/取消其他用户 Task |
| AC-17 | header 伪造 | JWT 验证失败 |
| AC-18 | SDAR 不可达 | 清晰错误，可恢复，不丢失本地状态 |
| AC-19 | 架构边界 | 无 SDAR DB/内部 API/MCP 依赖 |
| AC-20 | A2A 基线 | 固定 1.0.1/HTTP+JSON/SDK beta.0，错误 Transport fail-closed |
| AC-21 | Docker Agent Card | 显式 Endpoint Override 可用，禁止静默改写 |
| AC-22 | Follow-up 合同 | 只允许受支持 action 和严格 metadata |

---

# 11. Definition of Done

项目只有在以下全部满足时完成：

## 11.1 产品

- Open WebUI 可使用；
- 普通聊天；
- A2A Task 创建；
- 状态查询；
- bounded 实时进度；
- plan confirmation / provide_input / pause-resume；
- top-level cancelTask；
- terminal explanation。

## 11.2 架构

- 单 SDAR；
- A2A-only；
- thin LangGraph；
- 无 Mesh/Registry/MCP；
- 不复制 SDAR 状态；
- Open WebUI 与 Server 分离。

## 11.3 可靠性

- PostgreSQL Checkpoint；
- Task binding；
- Idempotency；
- restart recovery；
- bounded stream + getTask polling recovery；
- one active task per chat；
- safe shutdown。

## 11.4 安全

- service key；
- signed user identity；
- task authorization；
- redaction；
- size/rate/time limits；
- no hidden reasoning；
- no credential logging。

## 11.5 工程

- Apache-2.0；
- CI green；
- migrations pass；
- all tests pass；
- Docker passes；
- real Open WebUI + SDAR E2E passes；
- reports truthful；
- feature branch pushed；
- PR Ready；
- no required blocker。

---

# 12. 明确禁止扩展

本 Goal 禁止建设：

```text
Agent Mesh
A2A Gateway
Agent Registry
Capability Discovery
multi-agent routing
PMS
Skill Center
MCP Client/Provider
AG-UI/CopilotKit
ClickHouse/Evaluation
custom Web UI
multiple active tasks per chat
second Workflow Runtime
```

任何此类需求只能记录在 `docs/future-roadmap.md`，不得进入 v0.1 生产代码。

---

# 13. Goal 恢复协议

每次重新启动：

1. `git fetch --tags origin`；
2. checkout feature branch；
3. `git pull --ff-only`；
4. 读取 ExecPlan、sync-state、最新报告和 blocker；
5. 检查 Draft PR；
6. 验证最后完成 commit；
7. 运行必要 smoke；
8. 从第一个未完成 Phase 继续；
9. 不重做已完成 commit；
10. 不重写历史。

---

# 14. Codex 每次停止/完成输出

## Current state

- repository；
- branch；
- HEAD；
- PR；
- last completed phase；
- SDAR A2A protocol revision；
- Open WebUI connection state；
- tests summary。

## Commits pushed

列出本次新 commit。

## Completed

只写真实完成内容。

## Blocked or remaining

写准确 blocker 和恢复条件。

## Resume

写下一 Phase 和命令。

## Final completion

只在 Phase 13 完成时输出：

```text
SINGLE_AGENT_CHAT_SERVER_GOAL_COMPLETE
```
