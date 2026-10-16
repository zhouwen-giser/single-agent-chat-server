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

### 首个冻结包的现场发现

`ee87217d0a3d5bd08af00da9e07510cb59009281` 离线包的内外 SHA-256、两个镜像身份及 20 个迁移文件均校验通过，包内没有站点私有 runtime。两个早期安装尝试停在预检前，输出不足以归因；增加本机诊断后，WSGS 1.2 / SDAR 发现均通过，专属 PostgreSQL 与 SACS 容器启动，随后 `/ready` 返回 503：`postgres=ok`、`conversationModel=ok`、`wsgsGrounding=unavailable`。

公开 capabilities 的独立只读实测为容器内 3.747 秒、本机端口 5.220 秒，超过旧 5 秒上限。现场适配保持默认 1500 ms，将可显式配置的有界上限改为 30000 ms，本机使用 15000 ms；仍执行公开能力、数据库与真实模型检查。

现场此前没有 SACS 容器和数据卷，仅有旧 release / private 配置。旧 release 的镜像已不存在，原安装器的自动应用回退尝试 registry，96.896 秒后失败；本轮补充 `--pull never`，使安装及回退符合离线包约束。成功标记未被失败尝试替换，专属新卷保留，未执行数据库恢复。新增安全的就绪分项输出，避免将来只看到通用失败。

修复后 deployment tooling、anonymous security、analysis config、frozen readiness 共 4 suites / 26 tests PASS，包括部分就绪阻止发布、输出脱敏、有界配置及离线回退策略。TypeScript 类型、构建、Python 语法及本次 lint 另行复核。首个包作为失败尝试的证据保留，不作为最终交付包。

### 冷能力探针的最终预算

`a2279b3` 的 15000 ms 本机预算仍发生预检失败，单独诊断随后通过。进一步只读测量表明 DNS 为 0–7 ms、SDAR Card 为 21 ms，而 WSGS capabilities 的冷调用超过 45000 ms。读取 WSGS 的公开路由实现确认：capabilities 先等待 readiness，readiness 在 60000 ms 模型成功缓存过期后执行真实模型探针，再获取调用者范围的发现快照。SACS 的请求取消不会取消已开始的上游模型探针。

最终将 SACS 可显式配置的预算上限与原有 `WSGS_OPERATION_TIMEOUT_MS` 的 120000 ms 上限对齐，本机配置 120000 ms；默认 1500 ms 不变，安装器预检总限 180 秒、模型就绪总限 150 秒不变。没有更改上游缓存、模型、容器或安全条件，也没有用过期能力声明成功。两个早期包均保留为诊断证据，最终包另行记录。

最终预算修改后重新执行 4 suites / 26 tests、TypeScript 类型、应用构建及 Python 语法检查，均 PASS。

冻结源码提交后生成包含 SACS 与 `postgres:16.9-alpine` 镜像的离线包，部署入口为 `127.0.0.1:18083`。安装器将核对 WSGS 1.2 能力、SDAR HTTP+JSON 1.0 Card，执行 SACS 迁移与真实模型 readiness。

已核实 WSGS 本机公开端口为 28080、容器端口为 8080；SDAR 本机与容器端口为 10999。当前 WSGS 模型名称为 `qwen3.7-flash-2026-07-15`，密钥仅在本机私有配置中保存。

部署验证不代表真实历史业务正样本、设备执行、生产容量或发布门禁验收。先前真实用例台账保持原状态，Draft PR #25 保持 Draft，main 合并由用户控制。
