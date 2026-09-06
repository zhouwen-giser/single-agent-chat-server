# S05 — Text, Map, Timeline and AG-UI Projection

## Dependency

```text
S04
```

## Objective

让所有 outward channels 使用统一 View Model，提供真实、可解释、可恢复的文本、地图、时间轴与 AG-UI v0.3 展示，同时保持 OpenAI 与 AG-UI v0.2 兼容。

## Required work

1. 建立 `AnalysisAnswerProjection`，先确定事实/限定/选择，再允许受限语言润色。
2. 对 COMPLETED/PARTIAL/NO_DATA/INDETERMINATE/AMBIGUOUS 采用稳定措辞。
3. 将 WSGS world findings 和高级 findings 转成现有 MapLayerDescriptor。
4. 无 geometry 的道路结果不得伪造线；bounded preview 不得冒充完整轨迹。
5. off-network、data gap、paused、quality break、ambiguity 分开表达。
6. Temporal event 使用真实点/区间；unconfirmed LAST 明确限定。
7. Metric candidate 使用 representative visited position；H3 边界仅辅助。
8. Timeline source 支持 WSGS 派生分析，同时保留原证据 authority。
9. 扩展 AG-UI v0.3 handler：真实 Run/State/Activity/Tool Result/Interrupt。
10. Grounding Job 只显示一个粗粒度 `world-grounding` step，不显示假 Provider 节点/百分比。
11. Reconnect、delta gap、hash mismatch 触发完整 snapshot。
12. OpenAI-compatible 请求仍可返回终态文本。
13. AG-UI v0.2 事件和旧客户端保持兼容。
14. 地图渲染失败不得破坏分析 truth/persistence。

## Required verification

- Golden text projections。
- Map no-fabrication tests。
- timeline distinction tests。
- partial and unconfirmed LAST。
- H3 center non-target。
- AG-UI official event validation。
- snapshot-before-interrupt。
- reconnect full snapshots。
- stale run events ignored。
- v0.2/OpenAI regression。
- map engine failure isolation。

## Required outputs

- Text projector。
- Map/timeline projector。
- Production-capable AG-UI v0.3 Grounding Job handler。
- S05 report。

## Phase completion marker

```text
SACS_V06_WORLD_ANALYSIS_PRESENTATION_READY
```

只有该 Phase 对应的全部 required acceptance rows 为 PASS 时才能写入该标志。

## Commit

Recommended semantic commit:

```text
feat(v0.6): project world analysis to text map timeline and AG-UI
```

提交前必须更新 Phase report 和 Acceptance Ledger。若远程可用，可推送当前阶段；不得 force-push。

## Fail-closed / stop condition

不得把 SACS 自己的 Poll 次数、等待时间或内部阶段描述成 WSGS Provider 进度。不得通过文本润色提升确定性。
