# S06 — Multi-turn, Intervention, Revision and Cancel

## Dependency

```text
S05
```

## Objective

使用 WSGS priorGrounding、authorized selection 与新的 Grounding request 完成多轮继续分析、显式歧义选择、条件调整、取消和历史行动候选转接。

## Required work

1. 从 conversation/world focus 组装 prior Grounding ID、result hash、selected product IDs。
2. 支持 trajectory → last junction。
3. 支持 junction list → last item；本地直接选择仅限结果完整且可确定，否则重新 Grounding。
4. 支持 Top-K → Rank-N；若上游未返回该 Rank，重新 Grounding。
5. 把 WSGS ambiguity 转成 Analysis Intervention/Choice。
6. 用户选择必须匹配上游授权 candidate，防止任意 product/reference 注入。
7. 选择后创建新 Revision、新 Run、新 Grounding。
8. Phase Scope、阈值、时间范围、Top-K 修改均创建新 Revision。
9. Grounding Job mode 不调用 Native compileRevision。
10. Cancel 映射到 WSGS cancel endpoint，并处理未确认状态。
11. 处理 expected revision conflict、idempotency replay 和并发 mutation fencing。
12. 历史 action target 只生成候选，不调用 SDAR、路径规划或设备。
13. 如果 currentness operation 不可用，明确 currentness unknown/validation required。
14. 多轮所有读取保持 principal/thread scope。

## Required verification

- trajectory → last junction。
- list → LAST。
- Top-3 → second。
- metric series ambiguity → explicit choice。
- unauthorized choice rejection。
- phase scope revision。
- threshold revision。
- duplicate proposal idempotency。
- stale expected revision conflict。
- cancel and cancel replay。
- action target no SDAR/network call。
- currentness unavailable qualification。

## Required outputs

- Multi-turn coordinator。
- Choice/intervention resolver。
- Grounding Job revision implementation。
- S06 local E2E。

## Phase completion marker

```text
SACS_V06_WORLD_ANALYSIS_MULTITURN_READY
```

只有该 Phase 对应的全部 required acceptance rows 为 PASS 时才能写入该标志。

## Commit

Recommended semantic commit:

```text
feat(v0.6): add multiturn world analysis controls
```

提交前必须更新 Phase report 和 Acceptance Ledger。若远程可用，可推送当前阶段；不得 force-push。

## Fail-closed / stop condition

不得默认选择第一个 ambiguity candidate。不得在 SACS 本地裁剪旧结果来伪装重算。不得把历史目标直接转换为设备任务。
