# S09 — Final Qualification and Draft PR

## Dependency

```text
S08
```

## Objective

整合开发轨和真实集成轨证据，执行不涉及部署的最终代码质量检查，更新 Draft PR 与最终报告。发布轨只有用户明确要求时才运行。

## Required work

1. 冻结最终 SACS source SHA 与 diff inventory。
2. 运行最终 DEVELOPMENT + INTEGRATION 验证命令。
3. 验证 empty/upgrade migrations、architecture、secrets、licenses、format、lint、typecheck、build。
4. 确认没有测试 fixture 被 production import/selected。
5. 确认没有直连 Provider/上游数据库或秘密信息。
6. 更新所有 acceptance 行；不得批量将未执行行改 PASS。
7. 生成 `PROGRESSIVE_STATUS.json`、`FINAL_REPORT.md` 与 digest。
8. 创建或更新 Draft PR，列出完成项、真实证据、外部阻塞、non-claims。
9. 不自动将 Draft 改 Ready，除非用户或任务执行环境明确授权。
10. 不合并、不打 Tag、不 Release、不部署。
11. `RELEASE` 轨保持 `NOT_REQUESTED`，除非用户另行明确启动。
12. 仅在两项主标志均成立时输出 `SACS_V06_GOAL_COMPLETE`。

## Required verification

- Source-bound worktree verification。
- Required command inventory。
- Acceptance ledger schema + evidence reference validation。
- Full in-scope regression。
- Git diff/secret/license checks。
- PR body evidence links check（若创建 PR）。

## Required outputs

- Final reports and digests。
- Draft PR update。
- Accurate completion/deferred markers。

## Phase completion marker

```text
SACS_V06_FINAL_EVIDENCE_READY
```

只有该 Phase 对应的全部 required acceptance rows 为 PASS 时才能写入该标志。

## Commit

Recommended semantic commit:

```text
docs(v0.6): publish source-bound integration evidence
```

提交前必须更新 Phase report 和 Acceptance Ledger。若远程可用，可推送当前阶段；不得 force-push。

## Fail-closed / stop condition

S09 不授权发布。若 S08 存在无效阻塞或未执行的无条件真实集成行，不能输出总完成标志。
