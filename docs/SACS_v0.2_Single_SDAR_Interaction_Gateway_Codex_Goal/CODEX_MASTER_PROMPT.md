# Codex Goal Master Prompt

你负责 `zhouwen-giser/single-agent-chat-server` 的 v0.2 完整升级。

## Goal

只有 SACS v0.1 Phase 13 已完成并合并至执行时最新 `origin/main` 后，才从该 main 建立
精确基线并创建 `feature/sacs-v0.2-agui-interaction-gateway`。

v0.2 必须成为 **Single SDAR Interaction Gateway**：

- 保留 OpenAI-compatible `/v1/models` 与 `/v1/chat/completions`，继续服务 OpenWebUI；
- 新增标准 AG-UI HTTP/SSE 北向接口；
- 两种协议使用同一个内部 `SdarInteractionEvent` 事件流；
- 南向只允许 A2A，且只连接 exactly one configured SDAR；
- 支持 Task 下发、状态/结果/历史查询、Follow-up、Input Required、Cancel；
- 安全映射 A2A 公开事实到 AG-UI Run/Text/State/Activity/Interrupt/Custom；
- PostgreSQL 只保存 Principal、Thread、Task Binding、Idempotency、Run、Interrupt、必要 LKG；
- SDAR 保持 Goal/Plan/Task/Skill/Execution/Evidence 唯一权威。

## Mandatory reading order

完整阅读根目录 00～14、`TASK_INDEX.md`、`references/*`、`contracts/*`、P00～P14。

首先执行：

```bash
bash <task-package>/scripts/preflight-wait-gate.sh
```

### 未通过

若状态为 `WAITING_FOR_SACS_PHASE13_MAIN` 或 exit 75：

- 不创建 v0.2 branch；
- 不修改产品代码；
- 不提交、不 push；
- 不代替当前项目补做 v0.1 Phase 13；
- 准确报告等待原因并结束本次 Goal。

### 通过

才执行 P00：

1. fast-forward 到执行时最新 main；
2. 在 main 上运行完整 `pnpm verify`，零 required skip；
3. 锁定 SACS main SHA/tree/package/migrations/Phase13 evidence；
4. 锁定 SDAR 最新 main exact SHA、版本、A2A/Agent Card 合同；
5. 锁定 AG-UI 官方最新稳定 release/source 与 exact package versions；
6. 做依赖兼容审计；
7. 创建并 push v0.2 分支；
8. 顺序完成 P00～P14。

## Source priority

1. 执行时 SACS 最新 main + 已合并 Phase13 evidence；
2. 执行时 SDAR 最新 main 的 A2A public contracts；
3. 执行时精确锁定的 AG-UI 官方 source/packages；
4. 本任务包的产品语义与边界；
5. 本任务包内 current snapshot 只解释设计来源，不覆盖执行时真值。

Breaking change 必须先 Source Intake + ADR + contract tests，不允许凭记忆修协议。

## GitHub authority

允许 fetch/pull、创建 feature、每阶段 commit+push、创建/更新 PR、在保护规则满足后 Merge Commit。
禁止 direct main push、force push、已发布分支 rebase/amend/history rewrite、绕过 review/protection。
不授权 tag/release/deploy。

## Terminal states

- `WAITING_FOR_SACS_PHASE13_MAIN`
- `IN_PROGRESS`
- `BLOCKED_ENVIRONMENT`
- `AWAITING_PROTECTED_REVIEW`
- `FAILED`
- `COMPLETED`

Fixture/Mock 永远不能冒充真实 OpenWebUI、AG-UI Client 或 SDAR E2E。
