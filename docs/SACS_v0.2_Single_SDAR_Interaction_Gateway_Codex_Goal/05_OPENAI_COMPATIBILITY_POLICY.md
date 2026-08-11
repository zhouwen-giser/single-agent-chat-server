# 05. OpenAI / OpenWebUI Compatibility

保留且兼容：

```http
GET  /v1/models
POST /v1/chat/completions
```

必须继续支持：

- stream=false/true；
- 标准 SSE 与 exactly one `[DONE]`；
- service bearer；
- signed OpenWebUI user JWT；
- stable Chat/Message/User Message IDs；
- idempotency；
- `(principal, thread, task)` 授权；
- client disconnect 仅终止观察，不 cancelTask。

v0.2 增加 query intents：

```text
capabilities
active task
status/progress
result
history
conversation task list
previous task
allowed actions
capability gap
```

查询不能创建 Task；未授权 taskId 不能下发到 A2A。

P10 必须把执行时 main 的 Phase13 v0.1 最终场景作为 predecessor regression suite，
并在 exact v0.2 candidate SHA 上重新跑真实 OpenWebUI E2E。
