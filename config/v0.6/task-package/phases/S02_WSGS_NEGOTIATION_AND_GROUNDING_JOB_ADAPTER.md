# S02 — Authoritative WSGS Negotiation and Grounding Job Adapter

## Dependency

```text
S01
```

## Objective

升级现有 WSGS HTTP Adapter，使其能够基于权威锁精确协商 1.0/1.1 合同，并实现生产可用的 Grounding Job Analysis Source Adapter。

## Required work

1. 从 Source Lock 固定的 WSGS 工件生成/更新权威 SACS consumer lock，替换当前 provisional blocked lock。
2. 在 WSGS HTTP Client 中实现显式 contract selection；1.1 请求发送精确 header pair。
3. 校验响应 contract/profile headers，不允许静默降级。
4. 保持 1.0 请求、响应与现有普通 Grounding 行为兼容。
5. 实现 `GroundingJobAnalysisSourceAdapter`，复用现有 `WsgsHttpClient`，不得另写低层 HTTP 客户端。
6. 覆盖 200 同步结果、202 异步 Job、GET polling、cancel 与 safe errors。
7. 规范化 WSGS Job/Result 状态，不把 HTTP 完成等同于业务完成。
8. 使用稳定 canonical request hash 和 idempotency key；相同 key 不同 body 必须冲突。
9. 支持 AbortSignal、超时、poll 间隔、最大等待、最大响应字节与连续失败上限。
10. 建立 capability preflight/caching，按合同选择读取 capabilities。
11. `GROUNDING_JOB` 生产可用；`NATIVE`/`FIXTURE` 保持各自资格规则。
12. 不实现或猜测 WSGS Native routes。

## Required verification

- 1.0 request/response regression。
- 1.1 exact headers。
- duplicate/ambiguous/missing response header rejection。
- unauthorized 1.1 rejection。
- consumer-lock/hash drift rejection。
- sync 200。
- async 202 → GET terminal。
- all terminal statuses。
- idempotent replay与conflict。
- cancel。
- timeout/abort/response limit。
- capability optional-unavailable handling。

## Required outputs

- READY geospatial consumer lock（只有权威源验证通过时）。
- Contract-aware WSGS client。
- Grounding Job adapter。
- S02 verification/report。

## Phase completion marker

```text
SACS_V06_WSGS_GROUNDING_JOB_ADAPTER_READY
```

只有该 Phase 对应的全部 required acceptance rows 为 PASS 时才能写入该标志。

## Commit

Recommended semantic commit:

```text
feat(v0.6): integrate authoritative WSGS grounding job transport
```

提交前必须更新 Phase report 和 Acceptance Ledger。若远程可用，可推送当前阶段；不得 force-push。

## Fail-closed / stop condition

若当前 WSGS 主体未授权 1.1，必须保留 1.0 可用路径并准确标记 1.1 集成阻塞；不得在客户端伪造授权或绕过合同协商。
