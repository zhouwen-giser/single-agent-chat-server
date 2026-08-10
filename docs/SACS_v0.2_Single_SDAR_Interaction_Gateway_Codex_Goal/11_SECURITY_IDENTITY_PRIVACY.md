# 11. Security / Identity / Privacy

内部统一 Principal：

```text
issuer
subject
roles
tenant?   # future metadata, not authorization unless configured
```

OpenWebUI 与 AG-UI 身份解析只属于 protocol adapter。

OpenAI route 保持 v0.1 已验证的 service bearer + signed OpenWebUI user JWT。

AG-UI route 使用独立 service credential + signed principal identity（或执行时 ADR 证明的等价部署身份）。
禁止信任裸 `X-User-Id`。

如果 SDAR A2A 仍无用户级认证：

```text
SACS = external security boundary
```

SDAR A2A 只在可信私网。

必须覆盖：

- arbitrary taskId；
- cross principal/thread；
- run/request ID collision；
- forged/expired JWT；
- AG-UI state/forwardedProps injection；
- oversized message/artifact；
- URL part SSRF/use；
- hidden metadata/stack/secret leak；
- Raw event leak；
- CORS；
- rate limit；
- disconnect；
- duplicate/stale interrupt resume；
- unknown AG-UI type；
- Agent Card endpoint drift。

日志默认禁止 full prompt/JWT/token/full artifact/structured input/raw metadata/hidden reasoning。
