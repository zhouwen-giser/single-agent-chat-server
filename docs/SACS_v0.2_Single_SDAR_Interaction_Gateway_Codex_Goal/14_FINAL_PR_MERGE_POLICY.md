# 14. Final PR / Merge

P00～P13 全部 PASS 且已 push 后：

```bash
git fetch --prune origin
git checkout feature/sacs-v0.2-agui-interaction-gateway
git merge --no-ff origin/main
```

解决冲突后重新跑 full release gate + 三套 real E2E。不能复用 merge 前 evidence。

最终生成：

```text
reports/v0.2/final/
  release-report.{md,json}
  source-lock.json
  phase-history.json
  test-summary.json
  real-e2e-openwebui.json
  real-e2e-agui.json
  real-e2e-sdar.json
  security-review.md
  migration-report.json
  sbom.cdx.json
  known-limitations.md
  rollback-plan.md
  pr-body.md
```

commit + push，然后创建/更新：

```text
feature/sacs-v0.2-agui-interaction-gateway → main
```

只有 PR mergeable、required checks/reviews 满足、无 blocking review、feature 含最新 main、
final evidence exact 才允许 Merge Commit。

禁止 `--admin` 绕过保护。需要人工审批时状态 `AWAITING_PROTECTED_REVIEW`。

合并后 fetch main，证明 final candidate 是 `origin/main` ancestor，并做 post-merge smoke/consistency，
才允许 `COMPLETED`。

本任务不授权 tag、GitHub Release 或生产部署。
