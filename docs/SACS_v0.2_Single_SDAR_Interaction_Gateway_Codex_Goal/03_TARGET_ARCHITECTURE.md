# 03. Target Architecture

## 双协议、单事件内核

```text
OpenAI Route ─────┐
                  ├─ InteractionRequest ─ InteractionRuntime ─ SdarInteractionEvent
AG-UI Route ──────┘                                      │
                                                        A2A
                                                         │
                                                         ▼
                                                       SDAR

SdarInteractionEvent ── OpenAI Renderer
                     └─ AG-UI Renderer
```

## 推荐模块

```text
packages/
  interaction-contract/
  interaction-runtime/
  interaction-query/
  openai-api-contract/          # 保留
  openai-interaction-adapter/
  ag-ui-api-contract/
  ag-ui-interaction-adapter/
  sdar-a2a-adapter/             # 保留并升级基线
  persistence/

apps/server/src/
  api/openai-routes.ts
  api/ag-ui-routes.ts
  interaction/interaction-runner.ts
  interaction/intent-resolver.ts
  interaction/query-service.ts
  auth/
```

实际目录可适应执行时 main，但必须保持依赖方向：

```text
protocol adapters → interaction application/domain → ports → A2A/persistence adapters
```

Interaction domain 不能 import Fastify、A2A SDK、AG-UI SDK。

## Run != Task

冻结语义：

- AG-UI Run / OpenAI Request：一次有界交互和观察；
- SDAR Task：可跨多个 Run/Request 的后台业务任务。

因此 HTTP/SSE 关闭、观察预算结束、`RUN_FINISHED` 都不能自动等同 Task completed/canceled。
