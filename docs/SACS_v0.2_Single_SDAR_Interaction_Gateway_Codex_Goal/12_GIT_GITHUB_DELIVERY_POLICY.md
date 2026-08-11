# 12. Git / GitHub Delivery Policy

目标分支：

```text
feature/sacs-v0.2-agui-interaction-gateway
```

必须从 P00 验证通过的执行时 `origin/main` exact SHA 创建。

P00～P13 每阶段：

1. 更新 ExecPlan；
2. 实现；
3. 测试；
4. 保存失败证据；
5. 生成 `reports/v0.2/pXX-*`；
6. `git diff --check`；
7. commit；
8. push；
9. 验证 local HEAD == remote branch HEAD；
10. 更新 `goal-state.json`。

大型阶段建议 implementation commit + evidence commit；至少有一个明确 phase-boundary commit。

禁止：

```text
direct main push
force push
published-branch rebase
published commit amend
history rewrite
silent reset
delete failed required evidence
```

Goal Resume：

- fetch existing feature；
- 核对 remote HEAD 与 goal-state；
- 从最后完整 phase 继续；
- 未完成 phase 用追加修复 commit，不 rewrite。

P14 必须把最新 main 用 merge commit 合到 feature，不 rebase，然后重跑所有真实 release gates。
