# 00. Waiting Gate 与启动基线

用户明确要求：必须等当前 SACS v0.1 Phase 13 完成并合并 `main` 后再启动 v0.2。

每次 Goal 启动只检查一次；不满足立即返回 Waiting，不在后台轮询。

## Gate A：工作区和远程

```bash
git status --porcelain
git fetch --prune origin
git rev-parse origin/main
```

不得自动丢弃操作者未提交修改。

## Gate B：v0.1 已合入 main

优先读取 PR #1：

```bash
gh pr view 1 --json state,isDraft,mergedAt,headRefName,headRefOid,baseRefName,mergeCommit
```

要求 `mergedAt != null` 且 merge commit 已位于 `origin/main`。若未来改用其他 PR，必须通过
Git history + Phase13 final evidence 证明替代关系并记录偏差。

若远程仍保留 `origin/feature/single-sdar-chat-entry-v0.1`，要求其最终 head 是 main 的 ancestor。

## Gate C：Phase13 正式终态

执行时最新 main 必须存在 Phase13 等价正式 evidence，通常包括：

```text
PROJECT_STATUS.md
reports/goal/13-final-acceptance.md
reports/goal/13-final-acceptance.json
```

禁止将 `IN_PROGRESS / BLOCKED / WAITING / PARTIAL / fixture-only / retained-old-E2E`
解释为完成。

## Gate D：最新 main 实验验证

```bash
git checkout main
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm verify
```

全部 REQUIRED gates 必须零 skip。环境不足则仍然 Waiting，而不是从旧 CI 猜测可用。

## Gate E：创建 v0.2 分支

仅 A-D 全通过：

```bash
git checkout -b feature/sacs-v0.2-agui-interaction-gateway
git push -u origin feature/sacs-v0.2-agui-interaction-gateway
```

若分支已经存在，则进入 Resume Policy，禁止重建或 force push。

## P00 输出

```text
reports/v0.2/p00/
  execution-baseline.{md,json}
  phase13-merge-proof.json
  sacs-source-intake.md
  sdar-source-intake.md
  agui-source-intake.md
  dependency-delta.json
  baseline-verification.json
reports/v0.2/goal-state.json
```
