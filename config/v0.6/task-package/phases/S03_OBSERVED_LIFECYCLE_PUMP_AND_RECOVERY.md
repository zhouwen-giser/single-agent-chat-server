# S03 — Observed Grounding Lifecycle, Pump and Recovery

## Dependency

```text
S02
```

## Objective

把当前同步 `answerWorld()` 路径重构为 begin/observe/complete 生命周期，并将 Grounding Job 状态可靠地接入现有 Analysis Session、Run、Event 与 Projection。

## Required work

1. 提供 `beginWorldGrounding`、`observeWorldGrounding`、`completeWorldGrounding`。
2. 保留 `answerWorld` 兼容包装，避免破坏 OpenAI 普通文本路径。
3. 新增或重构 `WorldAnalysisCoordinator`：Grounding claim → WSGS submit/replay → Analysis bind → pump。
4. 将真实 Grounding ID/Job ID 与 Analysis revision/run 持久绑定。
5. 复用现有 Analysis repository、projection reducer 和 pump supervisor，改造成 Source-agnostic。
6. Grounding Job pump 只在语义状态/结果哈希变化时提交事件。
7. 实现 process-safe/durable lease、单 analysis pump 与过期 lease reclaim。
8. 重启时恢复 STARTING/RUNNING/CANCEL_REQUESTED。
9. 旧 revision/run 事件不得覆盖 active projection。
10. cancellation transport uncertainty 保持 CANCEL_REQUESTED 并继续观察。
11. 实现终态单调性、重复 source snapshot 幂等与结果 hash 校验。
12. 完整 principal/thread scope 隔离。
13. 输出 snapshot/activity 时继续满足 hash 与 revision 约束。

## Required verification

- Lifecycle unit tests。
- PostgreSQL binding/lease tests。
- duplicate poll deduplication。
- restart recovery。
- stale run/revision isolation。
- cancel ambiguous transport recovery。
- terminal monotonicity。
- source hash mismatch。
- concurrent ensure pump。
- OpenAI `answerWorld` compatibility。

## Required outputs

- Source-agnostic Analysis runtime。
- Grounding lifecycle API。
- Durable polling pump。
- S03 PostgreSQL verification。

## Phase completion marker

```text
SACS_V06_OBSERVED_GROUNDING_RUNTIME_READY
```

只有该 Phase 对应的全部 required acceptance rows 为 PASS 时才能写入该标志。

## Commit

Recommended semantic commit:

```text
feat(v0.6): add durable observed grounding lifecycle
```

提交前必须更新 Phase report 和 Acceptance Ledger。若远程可用，可推送当前阶段；不得 force-push。

## Fail-closed / stop condition

不得用内存状态替代关键 Grounding/Analysis 绑定。不得每次 Poll 都追加事件。不得在无法确认取消时直接写 CANCELLED。
