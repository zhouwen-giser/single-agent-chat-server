# 08. Query Service & Task Authorization

支持：

```text
query_capabilities
query_active_task
query_task_status
query_task_result
query_task_history
list_conversation_tasks
query_previous_task
query_allowed_actions
query_capability_gap
```

来源：

- capability → 当前 SDAR Agent Card；
- task status/result/history → local authorized binding → A2A `getTask`；
- conversation list → local binding index，当前状态按需 A2A refresh；
- allowed actions → normalized Task phase + public interaction state；
- capability gap → SDAR 已公开 Task metadata。

禁止：

```text
user text taskId → direct getTask
```

必须：

```text
principal + internal thread + taskId → authorized binding → A2A
```

v1.4+ Agent Card 是公开 Capability/A2A Exposure 投影，SACS 不推断 Internal Skill。
Agent Card LKG 可用于降级查询，但不能冒充 Runtime Readiness。

明确 query 不能触发 Task submit/follow-up/cancel。
