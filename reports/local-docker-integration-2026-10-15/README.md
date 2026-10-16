# 本机 Docker 集成部署记录

开始：2026-10-15；安装器阶段确认：2026-10-16（Asia/Shanghai）。

用户授权生成 SACS 部署包、完成本机集成部署，并复用 `wsgs-session` 已部署的模型配置。执行计划为 [EP-07](../../execplans/EP-07-local-docker-integration.md)。本报告随后补充冻结包身份与现场部署结果。

## 安装器适配 — PASS

- 显式支持 WSGS / SDAR 地址和同源 A2A endpoint override，适配 Card 公告主机回环地址的本机容器部署。
- 只将 SACS server 加入已有可信网络，独立 PostgreSQL 仍仅在 SACS backend；数据库默认地址限定为 `sacs-dev-postgres-1`，避免上游网络的同名 `postgres` 别名。
- `--refresh-model` 只刷新所选 WSGS 容器的六项模型配置，保留 SACS 身份和数据库凭据；严格验证 Chat Completions 模式及预算。默认重装继续使用保存的私有配置。
- 离线包携带全部 `SACS_` 模板默认值；不携带运行中的 `.env` 或模型密钥。
- 当保留的 release 存在而容器已移除时，先启动本项目数据库，再执行本项目的迁移前备份。没有卷的数据不宣称恢复为历史状态。

## 验证

| 检查 | 结果 |
| --- | --- |
| deployment-tooling.contract + development-anonymous.security | 2 suites / 11 tests PASS |
| TypeScript typecheck | PASS |
| 完整应用与 analysis web build | PASS |
| architecture | PASS，153 production files |
| Python 安装器语法 / 两个 MJS 语法 | PASS |
| 本次 TypeScript 与 MJS 作用域 lint | PASS，TypeScript 保留一项既有 non-null warning |
| format:check | PASS |

检查使用固定 `pnpm@11.13.1` 与 Node 22。本轮变更未改业务协议、依赖或上游服务。MJS 使用独立 ESLint 配置检查，因为现有 TypeScript ESLint project 不包含这些文件。

## 现场部署 — 待执行

冻结源码提交后生成包含 SACS 与 `postgres:16.9-alpine` 镜像的离线包，部署入口为 `127.0.0.1:18083`。安装器将核对 WSGS 1.2 能力、SDAR HTTP+JSON 1.0 Card，执行 SACS 迁移与真实模型 readiness。

已核实 WSGS 本机公开端口为 28080、容器端口为 8080；SDAR 本机与容器端口为 10999。当前 WSGS 模型名称为 `qwen3.7-flash-2026-07-15`，密钥仅在本机私有配置中保存。

部署验证不代表真实历史业务正样本、设备执行、生产容量或发布门禁验收。先前真实用例台账保持原状态，Draft PR #25 保持 Draft，main 合并由用户控制。
