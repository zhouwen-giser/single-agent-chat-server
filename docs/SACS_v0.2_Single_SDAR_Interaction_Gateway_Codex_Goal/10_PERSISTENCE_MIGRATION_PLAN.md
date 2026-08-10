# 10. Persistence Migration Plan

继续使用 SACS PostgreSQL，不新增第二套状态库，也不读取 SDAR DB。

从执行时 v0.1 schema 增量演进，推荐：

```text
conversation_thread
client_thread_binding
interaction_request
interaction_run
agui_interrupt_binding
agent_card_snapshot
```

保留/适配已有 conversation task binding、A2A event cache、request/submission lease。

`client_thread_binding`：

```text
client_type = openwebui | ag_ui
external_thread_id
principal_id
internal_thread_id
UNIQUE(client_type, principal_id, external_thread_id)
```

`interaction_request` 统一 OpenAI message 与 AG-UI run 的 durable idempotency claim：

```text
protocol
external_request_id
principal_id
thread_id
request_hash
lease_owner
status
result_task_id
```

`interaction_run` 是交互窗口，不复制 SDAR Task。

`agent_card_snapshot` 仅 Safe LKG：

```text
content_hash
protocol/binding/version
safe skills projection
observed_at
source_url_hash
```

不得作为 Runtime Readiness 权威。

Migration 每次验证：fresh、v0.1 upgrade、ledger/idempotency、rollback strategy、restart、
no orphan binding、active uniqueness、principal isolation。禁止以删库重建作为 v0.2 升级方案。
