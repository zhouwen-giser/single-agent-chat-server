# Necessary Source References

## SACS

Repository: `https://github.com/zhouwen-giser/single-agent-chat-server`

任务包制作时：

- main `3e5be7150e959006d4d152ba6d0d32ebc93ab419`
- feature `085e456c9802462c5d0c2a8c2310cadbfa760a96`
- PR #1 Draft/Open
- Phase 13 in progress

必要执行时阅读：
`README.md`, `DESIGN_BASELINE.md`, `PROJECT_STATUS.md`, `package.json`,
`docs/api/openai-chat-completions.md`, `docs/integrations/sdar-a2a.md`,
`packages/sdar-a2a-adapter/src/client.ts`, `normalize.ts`,
`packages/chat-runtime/src/task-coordinator.ts`, `src/agent/classification.ts`,
`migrations/*`, `reports/goal/13-final-acceptance.*`.

## SDAR

Repository: `https://github.com/zhouwen-giser/skill-driven-agent-runtime`

设计参考：`a9957c82c17ca01e77528f3817c03d86224aaf88`, v1.4.1。

必要执行时阅读：
`package.json`, `packages/a2a-adapter/src/compatibility.ts`, `http-endpoint.ts`,
`task-service-executor.ts`, `task-mapping.ts`, `node-control-agent-card.ts`.

## AG-UI

Repository: `https://github.com/ag-ui-protocol/ag-ui`

设计参考：
`release/2026-08-07` → `338708ca8b57deda9c82d0329f30944ab4b0dea6`

必要文件：
`sdks/typescript/packages/core/package.json`,
`client/package.json`, `encoder/package.json`,
`client/src/interrupts/index.ts`,
`integrations/a2a/typescript/README.md`,
`package.json`, `src/utils.ts`.

执行时必须重新获取最新稳定 release，不能假设这些设计参考仍是最新。
