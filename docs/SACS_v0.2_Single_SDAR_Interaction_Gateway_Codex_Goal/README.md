# SACS v0.2 Single SDAR Interaction Gateway — Codex Goal 详细实施任务包 V1.0

本任务在 **SACS v0.1 Phase 13 完成并合并到 main 后**才允许启动，将
`single-agent-chat-server` 从单一 OpenWebUI 入口升级为单 SDAR 的双协议交互网关：

```text
OpenWebUI ── OpenAI-compatible ─┐
                               ├─ Unified Interaction Runtime ─ A2A ─ one SDAR
AG-UI Client ─ AG-UI/HTTP+SSE ─┘
```

## 当前观察状态（仅参考，不是未来执行基线）

- SACS main: `3e5be7150e959006d4d152ba6d0d32ebc93ab419`
- v0.1 feature: `085e456c9802462c5d0c2a8c2310cadbfa760a96`
- PR #1: Draft/Open
- `PROJECT_STATUS`: `IN_PROGRESS`
- Phase 13: in progress
- SDAR reference: `a9957c82c17ca01e77528f3817c03d86224aaf88` / v1.4.1
- AG-UI reference: `release/2026-08-07` / `338708ca8b57deda9c82d0329f30944ab4b0dea6`

因此现在运行本 Goal 时应返回：

```text
WAITING_FOR_SACS_PHASE13_MAIN
```

不得提前创建 v0.2 分支。

## 目标分支

Phase 13 未来合入 main 且 main 完整验证通过后：

```text
feature/sacs-v0.2-agui-interaction-gateway
```

P00～P13 每阶段必须 commit + push；P14 合入最新 main、重跑完整真实门禁、创建 PR，
满足保护规则后使用 Merge Commit 合入 main。任务不授权 tag、GitHub Release 或生产部署。

入口文件：`CODEX_MASTER_PROMPT.md`
