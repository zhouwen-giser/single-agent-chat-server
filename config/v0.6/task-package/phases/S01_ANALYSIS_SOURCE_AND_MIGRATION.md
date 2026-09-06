# S01 — Analysis Source Abstraction and Truthful Persistence

## Dependency

```text
S00
```

## Objective

将当前以 WSGS Native Plan 为中心的分析模型扩展为可承载 Grounding Job、Native Analysis、Fixture 与 Legacy 只读行的统一 Source 抽象，并完成向后兼容的 PostgreSQL 迁移。

## Required work

1. 新增 `AnalysisSourceMode`、`AnalysisSourceIdentity`、`AnalysisSourceSnapshot`、`AnalysisSourceEvent` 与 `AnalysisSourceAdapter`。
2. 将现有 Native 五 Port 适配到新抽象，避免删除已有实现。
3. 将 Fixture 适配到新抽象；生产环境仍必须拒绝 Fixture。
4. 增加 `LEGACY_PLAN` 只读兼容类型。所有新建接口必须拒绝该类型。
5. 发现当前最新迁移号并追加下一连续迁移，不得硬编码任务包推测的编号。
6. 增加真实 source kind/id/hash/revision 语义，保留旧列用于迁移读取。
7. 从 v0.5 数据库升级并回填旧行；不伪造其为 Grounding Job。
8. 更新 Analysis contract、repository 映射、hash/canonicalization 与 API projection。
9. 对现有 v0.5 fixture/native 测试做兼容修正，不建立第二套 Analysis 表。
10. 为新抽象建立严格 Zod/TypeScript 合同和边界测试。

## Required verification

- Analysis Source contract tests。
- Legacy row parse/read。
- New Grounding Job identity round-trip。
- `LEGACY_PLAN` write rejection。
- Fixture production rejection。
- Empty DB migration。
- v0.5 → v0.6 upgrade migration。
- Existing v0.5 focused and PostgreSQL regression。

## Required outputs

- 新 Source contract/package。
- 连续追加的迁移。
- Repository mapping。
- S01 phase report与验收更新。

## Phase completion marker

```text
SACS_V06_ANALYSIS_SOURCE_READY
```

只有该 Phase 对应的全部 required acceptance rows 为 PASS 时才能写入该标志。

## Commit

Recommended semantic commit:

```text
feat(v0.6): add truthful analysis source abstraction
```

提交前必须更新 Phase report 和 Acceptance Ledger。若远程可用，可推送当前阶段；不得 force-push。

## Fail-closed / stop condition

不得把 `groundingId` 写进仍名为/仍语义为 WSGS Plan 的字段来绕过迁移。不得删除旧列或重写旧事件历史，除非升级测试证明完全兼容且任务包要求已满足。
