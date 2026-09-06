# S08 — Real WSGS Integration

## Dependency

```text
S07
```

## Objective

使用锁定源码构建或经批准的真实 WSGS 服务，验证 SACS → WSGS Grounding Job → WSGS 执行/持久化 → SACS projection 的完整闭环。不得使用 Fixture、Mock、录制响应或静态 JSON 替代。

## Required work

1. 重新记录 SACS/WSGS exact HEAD、工作树和合同哈希。
2. 启动隔离 PostgreSQL、WSGS API/worker 和 SACS，或使用经明确批准的隔离部署。
3. 验证 1.0 legacy capabilities/grounding。
4. 验证 1.1 exact negotiation、capabilities 与 geospatial result profile。
5. 验证 200 sync 或 202 async（至少实际覆盖 WSGS 支持的模式；另一模式用真实 backend 测试或明确记录不可触发）。
6. 验证真实 GET polling 和 terminal result。
7. 验证 cancellation，不把客户端断开当作 cancel。
8. 验证普通 world grounding 与 geospatial finding。
9. 对 WSGS 实际广告并具备权威 Schema 的高级历史能力执行真实 Road/Temporal/Metric/multi-turn。
10. 对 WSGS 明确未提供的能力生成 `BLOCKED_EXTERNAL`，附 capability/contract证据。
11. 验证 SACS 没有到 Provider/数据库的非法直连。
12. 记录 HTTP 状态、业务状态、Grounding ID 的不可逆摘要、结果 hash、证据 IDs 和投影 hash；不记录敏感 body。
13. 清理本 Goal 创建的临时容器/进程/数据库，不影响共享服务。
14. 生成 `INTEGRATION_EVIDENCE.json` 和更新 ledger。

## Required verification

至少执行 `acceptance/e2e-cases.json` 中 REAL 模式且前置条件满足的场景。真实证据必须包含命令、退出码、源 SHA、服务身份/端口的安全摘要和每个 acceptance ID 的映射。

## Required outputs

- Real integration evidence。
- Integration decision。
- `SACS_WSGS_GROUNDING_JOB_REAL_INTEGRATION_READY`（只有条件满足时）。

## Phase completion marker

```text
SACS_WSGS_GROUNDING_JOB_REAL_INTEGRATION_READY
```

只有该 Phase 对应的全部 required acceptance rows 为 PASS 时才能写入该标志。

## Commit

Recommended semantic commit:

```text
test(v0.6): qualify real SACS WSGS grounding integration
```

提交前必须更新 Phase report 和 Acceptance Ledger。若远程可用，可推送当前阶段；不得 force-push。

## Fail-closed / stop condition

禁止为了制造 PASS 修改 WSGS、GOWM+、GDPS 或 Provider。禁止把 WSGS capability `available=false` 的功能伪装为可用。禁止操作非隔离生产/共享数据库。
