# S04 — WSGS Result Consumer and Unified View Model

## Dependency

```text
S03
```

## Objective

建立单一 WSGS 北向结果消费与归一化边界，将普通 Grounding、1.1 geospatial findings、Evidence、Typed Gaps 及可用的高级历史 finding 转换为确定性 `WorldAnalysisViewModel`。

## Required work

1. 建立 schema URI + schema hash 双键 registry。
2. 接入权威 1.1 world finding、source product 与 typed gap 合同。
3. 对未知/漂移 payload 输出 `UNSUPPORTED_FINDING_SCHEMA`，保留证据引用但不猜测。
4. 建立统一 `SacsWorldAnalysisFinding` union。
5. 支持历史道路关联、时空事件、指标排名、历史行动候选的内部模型。
6. 高级历史模型只绑定 WSGS 权威北向 Schema；不得直接依赖 Provider package。
7. 保留 status、confidence、unknowns、warnings、source products、evidence IDs 与 currentness。
8. 确定性排序、去重、canonical hash 与 size limits。
9. 过大/截断结果生成 typed gap 与 qualifier。
10. Action target 固定 `currentValidationRequired=true`、`routePlanningRequired=true`、`executionAuthorized=false`。
11. 无高级历史合同的源基线使用安全 unsupported 路径，并记录 external blocker。
12. 将 normalization 独立于文本/地图/AG-UI。

## Required verification

- authoritative 1.1 examples。
- every world finding kind。
- typed gap/source product。
- unknown URI。
- known URI wrong hash。
- dangerous/oversized payload。
- deterministic ordering/hash。
- road/off-network semantics。
- temporal LAST confirmed/unconfirmed。
- metric ranking representative position。
- action target non-execution flags。

## Required outputs

- Result registry与consumer lock。
- `WorldAnalysisViewModel`。
- Normalizer tests。
- S04 report。

## Phase completion marker

```text
SACS_V06_WORLD_ANALYSIS_VIEW_READY
```

只有该 Phase 对应的全部 required acceptance rows 为 PASS 时才能写入该标志。

## Commit

Recommended semantic commit:

```text
feat(v0.6): normalize WSGS findings into world analysis view
```

提交前必须更新 Phase report 和 Acceptance Ledger。若远程可用，可推送当前阶段；不得 force-push。

## Fail-closed / stop condition

不得为了通过高级历史测试而从 T2/T3/T4 仓库复制运行时类型或算法。Fixture 只能证明 SACS 归一化逻辑，不能证明 WSGS 真实集成。
