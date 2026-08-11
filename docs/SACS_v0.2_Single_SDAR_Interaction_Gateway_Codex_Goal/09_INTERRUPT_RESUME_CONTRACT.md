# 09. Interrupt / Resume Contract

执行时重新从 SDAR 当前 A2A mapping 验证 Follow-up 动作。设计参考：

```text
confirm_plan
reject_plan
revise_plan
patch_goal
cancel_goal
provide_input
pause
resume
```

## Interrupt

`awaiting_plan_confirmation`：

```text
reason = sdar.plan_confirmation
allowed = confirm_plan | reject_plan | revise_plan | patch_goal
```

`awaiting_user_input`：

```text
reason = sdar.input_required
inputRequestId = exact published id
responseSchema = public interaction schema if SDAR publishes it
```

`paused`：

```text
reason = sdar.paused
allowed = resume | cancel_goal
```

## Persist-before-finish

在向客户端发送终止本 Run 的 Interrupt 前，`agui_interrupt_binding` 必须 durable 保存：

```text
interrupt_id
principal_id
thread_id
task_id
context_id
input_request_id
reason
response_schema_hash
status
expires_at
resolved_at
resolution_hash
```

## Resume

必须由执行时官方 `ResumeEntry` / `RunAgentInput` 类型解析。

每个 Resume 验证：

1. principal 相同；
2. thread 相同；
3. Task Binding 相同；
4. interrupt open 且未过期；
5. inputRequestId 一致（若适用）；
6. payload 通过 schema；
7. same resolution replay 幂等；
8. same identity different payload 冲突；
9. 多 interrupt 遵守官方完整响应语义。

采用 durable resolution claim → A2A Follow-up → resolved commit，保证 crash restart 不重复副作用。
