# 07. A2A → AG-UI Mapping

## Adapter 策略

SACS `sdar-a2a-adapter` 继续承担实际 A2A 1.0 适配。

官方 `@ag-ui/a2a` 仅作为映射参考：设计参考版 0.0.6 标记 Experimental，且使用
`@a2a-js/sdk ^0.2.2`，不能无验证替换当前 SACS/SDAR `1.0.0-beta.0`。

官方参考有价值的模式：

- A2A Message text → AG-UI text；
- 只有显式 data `tool-call/tool-result` → Tool Events；
- 可识别 UI surface data → Activity；
- 未识别事件可 Raw fallback。

SACS 更严格：Raw 默认不外发。

## SDAR-specific mapping

详见 `contracts/a2a-agui-mapping.csv`。

核心：

```text
initial Task       → task.bound/task.snapshot → State + Activity snapshot
StatusUpdate       → task.status_changed      → State + Activity delta
status/message     → message.text             → Text events
Artifact text      → artifact.text            → Text
Artifact JSON      → artifact.data            → CUSTOM sdar.artifact.data
Artifact URL       → artifact.reference       → CUSTOM sdar.artifact.reference
capabilityGap      → capability.gap            → Custom + State
INPUT_REQUIRED     → input.required            → Interrupt
budget end         → observation.ended         → Custom + Run finish, Task continues
technical error    → run.error                 → RUN_ERROR
```

禁止映射 hidden reasoning、internal skill、MCP RPC、Node Control、Telemetry。
