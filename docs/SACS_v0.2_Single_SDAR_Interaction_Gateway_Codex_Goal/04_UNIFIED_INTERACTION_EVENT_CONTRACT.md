# 04. Unified Interaction Event Contract

当前 v0.1 的 string-oriented 输出要提升为结构化事件脊柱：

```text
A2A → normalized A2A → SdarInteractionEvent → OpenAI/AG-UI Renderer
```

机器合同：`contracts/interaction-event.schema.json`。

冻结事件家族：

```text
run.started
task.bound
task.snapshot
task.status_changed
message.text
artifact.text
artifact.data
artifact.reference
input.required
capability.gap
allowed_actions.changed
observation.ended
run.finished
run.error
```

所有事件含 `eventId/eventType/occurredAt/runId/threadId/sequence/payload`；
Task 事件额外含 `taskId/contextId`。

约束：

- sequence 单 Run 严格递增；
- renderer 不能自行重算 Task 状态；
- artifact JSON 必须 bounded/redacted；
- technical error 不输出 stack/secret/internal endpoint；
- `message.text` 只允许公开文本；
- P02 采用兼容桥接逐步替换旧 string 路径，OpenAI contract 全绿后才移除重复实现。
