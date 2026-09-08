# S00 — Source Lock and Baseline Reconciliation

## Dependency

```text
无
```

## Objective

锁定实际执行时的 SACS 与 WSGS 源码、合同和验证基线，确认 v0.5 已有能力完整存在，并创建 v0.6 工作分支。该阶段只允许必要的基线、报告、验证脚本与文档修正，不开始大规模实现。

## Required work

1. 在任务包根目录运行 `python3 scripts/verify_task_package.py`，记录输出和任务包 SHA-256。
2. 获取 SACS `main`、v0.5 分支、PR #18（若仍存在）及当前工作树状态。
3. 选择包含完整 v0.5 Analysis 实现的基线。若从 `main` 起步，必须证明 v0.5 组件已等价合入。
4. 创建 `codex/sacs-v0.6-wsgs-full-functional-integration`；不得覆盖现有同名远程分支，不得 force-push。
5. 获取 WSGS `main` 和相关 geospatial handoff 分支，锁定精确 SHA。
6. 按原始字节读取并校验 WSGS `contract-release-lock.json` 及其列出的 1.1 schema 工件。
7. 生成 `reports/v0.6/wsgs-full-functional-integration/SOURCE_LOCK.json`，记录仓库、分支、SHA、文件哈希、工具版本和环境限制。
8. 建立 v0.6 `ACCEPTANCE_LEDGER.json`，所有行初始为 `NOT_RUN`。
9. 更新过时的根级 `AGENTS.md`/`CODEX_GOAL_PROMPT.md` 产品边界：反映已有 AG-UI、WSGS Grounding 和 v0.5 Analysis，不得删除原有 SDAR 安全边界。
10. 运行最小基线测试，确认不是在损坏工作树上继续。

## Required verification

- 任务包自校验。
- v0.5 progressive contract/verification命令（按仓库实际脚本）。
- TypeScript typecheck。
- migration continuity。
- architecture check。
- 源码差异检查，确认仅有 S00 允许文件。

## Required outputs

- `SOURCE_LOCK.json`
- `PROGRESSIVE_STATUS.json`
- `ACCEPTANCE_LEDGER.json`
- S00 phase report
- 基线对比说明

## Phase completion marker

```text
SACS_V06_S00_BASELINE_READY
```

只有该 Phase 对应的全部 required acceptance rows 为 PASS 时才能写入该标志。

## Commit

Recommended semantic commit:

```text
chore(v0.6): lock SACS and WSGS integration baselines
```

提交前必须更新 Phase report 和 Acceptance Ledger。若远程可用，可推送当前阶段；不得 force-push。

## Fail-closed / stop condition

若 v0.5 关键组件不存在，不得假装继续；先恢复或正确选择基线。若 WSGS 1.1 工件缺失或哈希漂移，S00 可完成 SACS 源锁，但 1.1 集成必须标记 `BLOCKED_EXTERNAL`，不能用任务包内建议 Schema 代替。
