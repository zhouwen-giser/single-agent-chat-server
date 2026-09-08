# Codex Goal Prompt — SACS v0.6 × WSGS Full Functional Integration

你正在 `zhouwen-giser/single-agent-chat-server` 仓库中完成 SACS v0.6。

开始前必须完整阅读并校验本任务包，至少包括：

```text
README.md
SACS_V0.6_WSGS_FULL_FUNCTIONAL_INTEGRATION_GOAL.md
DESIGN_BASELINE.md
ARCHITECTURE_DECISIONS.md
PRODUCT_BOUNDARY.md
SOURCE_BASELINE.json
acceptance/acceptance-matrix.json
acceptance/e2e-cases.json
acceptance/required-commands.json
phases/S00_SOURCE_LOCK_AND_RECONCILIATION.md
contracts/*
```

先执行：

```bash
python3 scripts/verify_task_package.py
```

## 目标

将 SACS 从“可提交一次 WSGS Grounding 并等待文本结果”升级为：

```text
用户自然语言 / OpenAI API / AG-UI
  → SACS Turn Planning 与会话上下文
  → WSGS Grounding Job
  → WSGS 统一组织 GOWM+、GDPS、历史轨迹与分析 Provider
  → SACS 持久化 Analysis Session / Revision / Run / Projection
  → 文本、地图、时间轴、候选选择与多轮继续分析
```

默认真实传输必须是：

```text
SACS_WSGS_ANALYSIS_TRANSPORT=GROUNDING_JOB
```

不得等待尚不存在的 WSGS Native Analysis Plan/Event/Revision 接口才开始实现。现有 Native 五 Port、八件 Handoff Bundle 验证与 Fixture 能力必须保留，但仅服务于：

```text
SACS_WSGS_ANALYSIS_TRANSPORT=NATIVE
SACS_WSGS_ANALYSIS_TRANSPORT=FIXTURE
```

## 当前必须修正的关键点

1. SACS 必须消费 WSGS 权威 `sacs-wsgs-grounding/1.1` geospatial 合同，并发送精确的：

```text
wsgs-contract-version: sacs-wsgs-grounding/1.1
wsgs-result-profile: sacs-wsgs-geospatial-findings/1.0
```

只有经过权威 consumer lock 验证并获得服务主体授权时才允许启用；1.0 路径必须继续兼容。

2. 不得把 `groundingId` 假装为 `wsgsPlanId`。必须引入真实的 Analysis Source identity，至少区分：

```text
WSGS_GROUNDING_JOB
WSGS_NATIVE_ANALYSIS
FIXTURE
LEGACY_PLAN（只读迁移兼容，禁止新写）
```

3. Grounding Job 模式不得虚构 WSGS 内部 DAG、Provider 节点、Tool Call 或百分比进度。只投影真实可知状态：

```text
ACCEPTED
RUNNING
COMPLETED
PARTIAL
AMBIGUOUS
UNRESOLVED
FAILED
CANCELLED
```

4. 用户修改分析条件、选择歧义候选或调整 Top-K 时，Grounding Job 模式必须创建新的 SACS Revision 并提交新的 WSGS Grounding；不得调用不存在的 Native `compileRevision`，不得在 SACS 中直接修改 Provider 参数。

5. SACS 不直接访问 WSGS、GOWM+、GDPS、T2/T3/T4 数据库，不直接调用下游 Provider，不复制下游算法，不伪造 ReferenceKey、几何、证据或当前性。

## 工作流

- 从执行时实际存在且包含完整 v0.5 能力的基线创建：
  `codex/sacs-v0.6-wsgs-full-functional-integration`。
- 优先从 `codex/sacs-v0.5-observer-first-interactive-analysis` 起步；若该分支已等价合并到 `main`，可从 `main` 起步，但必须用证据证明 v0.5 功能未丢失。
- 若建立 PR，初始 base 应为实际承载 v0.5 的分支；若 v0.5 已合并，则 base 为 `main`。
- 每个 Phase 独立提交；已有远程分支不得 force-push 或重写历史。
- 可以创建或更新 Draft PR；不得合并、打 Tag、Release、部署或修改任何上游仓库。
- GitHub、Docker 或真实服务不可用时，继续完成可完成的代码和本地验证，并准确记录 `NOT_RUN` 或 `BLOCKED_EXTERNAL`，不得伪造 PASS。

## 三个独立门禁

```text
DEVELOPMENT
REAL_WSGS_INTEGRATION
RELEASE
```

开发轨不能因为发布证据缺失而被降级；真实集成轨不能用 Fixture 代替；发布轨未经用户明确要求保持 `NOT_REQUESTED`。

## 完成标志

满足所有 DEVELOPMENT 必需行后输出：

```text
SACS_WSGS_FULL_FUNCTIONAL_INTEGRATION_DEV_READY
```

满足所有 REAL_WSGS_INTEGRATION 必需行，且没有用 Fixture、Mock 或静态录制结果替代真实 WSGS 后输出：

```text
SACS_WSGS_GROUNDING_JOB_REAL_INTEGRATION_READY
```

只有上述两个标志都成立时，才输出：

```text
SACS_V06_GOAL_COMPLETE
```

无论完成程度如何，都必须明确保留：

```text
SACS_WSGS_NATIVE_ANALYSIS_CONTROL_DEFERRED
```

现在执行 S00，不要停留在设计说明，不要重复询问已经能从仓库和任务包确定的信息。
