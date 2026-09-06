# SACS v0.6 × WSGS Full Functional Integration — Codex Goal 任务包

本任务包用于指导 Codex 在 `zhouwen-giser/single-agent-chat-server` 中完成 **SACS v0.6：完整接入 WSGS Grounding Job、增强世界分析会话、地图/时间轴呈现及多轮交互**。

## 直接使用

1. 解压本 ZIP。
2. 在任务包根目录执行：

```bash
python3 scripts/verify_task_package.py
```

3. 将 `CODEX_GOAL_PROMPT.md` 作为 Codex Goal 的入口指令，并让 Codex 可读取整个解压目录。
4. 目标代码仓库必须是 `zhouwen-giser/single-agent-chat-server`；WSGS、GOWM+、GDPS 与分析 Provider 仓库在本 Goal 中均为只读上游。

## 目标标志

开发轨完成：

```text
SACS_WSGS_FULL_FUNCTIONAL_INTEGRATION_DEV_READY
```

真实集成轨完成：

```text
SACS_WSGS_GROUNDING_JOB_REAL_INTEGRATION_READY
```

明确延期：

```text
SACS_WSGS_NATIVE_ANALYSIS_CONTROL_DEFERRED
```

只有开发轨与真实集成轨全部满足时，才能输出：

```text
SACS_V06_GOAL_COMPLETE
```

发布轨未经明确要求不得自动执行，也不得据此合并、打 Tag、Release 或部署。

## 任务包结构

- `CODEX_GOAL_PROMPT.md`：Codex 入口提示。
- `SACS_V0.6_WSGS_FULL_FUNCTIONAL_INTEGRATION_GOAL.md`：总任务与完成定义。
- `DESIGN_BASELINE.md`：架构与数据流基线。
- `ARCHITECTURE_DECISIONS.md`：不可被实现阶段静默改变的决策。
- `PRODUCT_BOUNDARY.md`：SACS、WSGS 与下游系统职责边界。
- `SOURCE_BASELINE.json`：生成任务包时观测到的仓库状态，仅用于比对；执行时必须重新锁定。
- `phases/`：S00—S09 阶段任务。
- `contracts/`：建议的接口、状态、持久化、展示与安全合同。
- `acceptance/acceptance-matrix.json`：逐条验收矩阵。
- `acceptance/e2e-cases.json`：本地与真实 WSGS 端到端场景。
- `acceptance/required-commands.json`：Codex 必须在仓库中提供或执行的验证命令。
- `schemas/`：证据与报告 JSON Schema。
- `templates/`：阶段报告、Source Lock、验收台账、最终报告和 PR 模板。
- `CHECKSUMS.json`：任务包内部文件校验。

## 重要约束

任务包是实现要求，不是修改其他仓库、合并 PR、发布或部署的授权。不得因为真实 WSGS 暂未提供某项高级能力，就把 Provider 逻辑复制进 SACS；必须将对应真实集成行标记为 `BLOCKED_EXTERNAL`，同时完成不依赖该能力的 SACS 开发工作。

生成时间：`2026-09-06T05:32:35Z`
