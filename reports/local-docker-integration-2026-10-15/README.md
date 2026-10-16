# SACS 本机 Docker 集成部署 — PASS

部署完成：2026-10-16T09:38:17.388344+08:00（Asia/Shanghai）。已部署冻结源码 `af36dd001e0db08354c38ef2ebe566ea25a3bdba`，复用 WSGS 正在运行的 `qwen3.7-flash-2026-07-15` 模型配置。真实普通对话、独立数据库持久化与两个上游连接验证通过。

## 交付与运行身份

| 项目 | 实际结果 |
| --- | --- |
| 本机 API | `http://127.0.0.1:18083`；OpenAI base URL 为 `http://127.0.0.1:18083/v1` |
| 对外模型 ID | `sdar-single-agent` |
| 离线部署包 | `/mnt/data/sacs-live/packages/0.6.0-af36dd001e0d/sacs-development.tar.gz` |
| 包大小 / SHA-256 | 205816430 bytes / `6f144abaa234399340abd38b962156e06fbe2a1ab27bd0d5d804bfd825f0ca5b` |
| 校验侧文件 | `/mnt/data/sacs-live/packages/0.6.0-af36dd001e0d/sacs-development.tar.gz.sha256` |
| SACS 镜像 | `single-agent-chat-server:0.6.0-af36dd001e0d` / `sha256:8ae751dd9e749bade918d10cecc7d8872576ba98b2ad053ef15c4a0fac737392` |
| 独立 PostgreSQL | `postgres:16.9-alpine` / `sha256:7c688148e5e156d0e86df7ba8ae5a05a2386aaec1e2ad8e6d11bdf10504b1fb7` |
| 当前 release | `/mnt/data/sacs-live/releases/a4d8c8adc56fa1d2` |
| previous release | `/mnt/data/sacs-live/releases/0f92d8ca4a9933ea`（源码 `34f741995b6e1b1ad8bfacd962368420f15ed729`） |
| 运行状态 | `sacs-dev-server-1`、`sacs-dev-postgres-1` 均 healthy |

离线包包含预构建镜像、安装器、环境模板、运行默认值及校验清单。私有模型密钥、SACS 身份密钥与数据库口令在 `/mnt/data/sacs-live/shared` 中，四个配置文件均为 0600；部署包中只有环境模板占位值。包内迁移文件与运行数据库的 20 项版本、校验和完全一致。

## 实际验证

| 验证 | 结果 |
| --- | --- |
| 模型、agent、部署、安全、配置与就绪测试 | 6 suites / 43 tests PASS |
| TypeScript 类型、应用 / analysis web 构建、作用域 lint、格式、Python / MJS 语法 | PASS；部署测试文件保留一项既有 lint warning |
| 架构检查 | PASS，153 production files |
| 包外 SHA-256、内清单、镜像身份、迁移清单 | PASS |
| `/health`、`/ready`、`/v1/models`、`/ag-ui/capabilities`、`/api/v1/analysis-capabilities` | 均 HTTP 200 |
| `/ready` 分项 | configuration=ok，postgres=ok，conversationModel=ok，wsgsGrounding=ready；本次耗时 3.592 秒 |
| WSGS 公开能力 | 1.2 / world-analysis profile ready；六项可选能力 AVAILABLE |
| SDAR 发现 | 官方隔离 SDK 的 HTTP+JSON 1.0 发现通过；现场 Card 为 14 skills |
| 真实普通对话 | HTTP 200，13.687 秒；当前对话的 user / assistant 两条消息已落库 |
| Open WebUI utility / SSE | 确定性标题 `Single SDAR chat`；SSE `[DONE]` 通过 |
| SACS SDAR Task 绑定 | 测试前后 0 → 0 |
| 上游资源 | 部署前的 69 个容器 ID、镜像、启动时间、网络 ID、挂载内容均保持一致；挂载按目标路径比较，不依赖 Docker 返回顺序 |

真实回答：

> 你好，我是SACS流程中的通用对话助手，很高兴能陪你进行轻松自然的日常交流。

运行配置的模型 endpoint、name、key、timeout、retries、response format 六项均与当前 WSGS 容器一致；仅记录比较结果，不记录密钥。既有 SACS 身份、PostgreSQL 凭据及认证模式保持一致。现场原本没有 SACS 容器或数据卷，本次使用专属新卷，未宣称恢复旧聊天数据。

## 连接和操作

SACS server 加入既有 WSGS / SDAR 可信 Docker 网络，连接 WSGS 容器端口 8080 和 SDAR 10999。SDAR Card 公告主机回环地址，SACS 使用同源显式 `/a2a` endpoint override。独立 PostgreSQL 仅在 SACS internal backend、没有公开端口，连接名限定为 `sacs-dev-postgres-1`。

本站保留既有共享匿名开发模式，固定监听回环；OpenAI 请求使用 `sdar-single-agent`。本站操作带上固定入口参数：

```sh
bash /mnt/data/sacs-live/current/deploy.sh status \
  --root /mnt/data/sacs-live --bind 127.0.0.1 --port 18083
```

新机器安装和模型刷新命令见 [部署说明](../../deployment/README.md)。`--refresh-model` 才重新导入模型；普通重装继续使用保存的私有设置。没有安装 Open WebUI 前端或启用需要独立认证配置的 browser reference client。

## 已修复的现场问题与 CI

1. 现有容器网络、Card 回环地址、旧模型配置与多个项目的 `postgres` 别名需要明确适配。安装器增加显式网络 / 连接 / 模型刷新，只操作 SACS 资源；先启动独立数据库再备份，支持保留 release 而容器已移除的现场。
2. WSGS capabilities 在模型成功缓存过期后会等待真实模型探针。实测冷模型约 36–43 秒，能力请求曾超过 45 秒。最终显式配置 120000 ms 的有界预算，与既有上游 operation 上限一致，默认 1500 ms 保留；能力、真实模型和数据库的失败仍阻止发布。
3. 首次真实普通对话的模型分类多填了 `clarification`，被本地语义校验正确拒绝。分类提示现明确路由相关字段的省略规则及合法普通对话示例。保留本地严格语义校验，没有删除不合法字段后放行任务。
4. 早期旧应用镜像不存在时的回退曾尝试 registry。安装 / 回退现使用 `--pull never`；已保留旧 release、迁移前备份及私有配置备份，未执行数据库恢复。没有现场执行应用回滚演练。
5. [已部署源码的 CI](https://github.com/zhouwen-giser/single-agent-chat-server/actions/runs/38835344991) 的 quality / container 通过，functional-v06 在 browser-postgres 的取消场景失败。夹具在持久化取消意图展示后过早模拟终态，可能尚未收到真实上游取消 POST。修复测试同步后，4 个浏览器 / HTTP / PostgreSQL 场景本地复测通过，类型与 lint 通过。后续提交仅涉及测试与报告，完整 CI 重新触发；本报告不将尚未完成的新 CI 记为通过。

早期 `ee87217`、`a2279b3`、`34f7419` 的包及诊断保留在本机，最终交付以本报告的 `af36dd0` 包为准。源码冻结后追加的报告 / 测试提交不改变已部署应用代码。

报告提交 `4d319fa` 的两份新证据 JSON 曾使 CI 在格式检查阶段提前失败。现已按 Prettier 规范格式化，并按最终字节重算证据清单；应用源码和离线包身份保持不变，完整 CI 再次触发。

## 验收范围

本轮完成部署与连接、真实模型普通对话、持久化和协议 smoke。没有提交真实历史正样本或设备任务验收；`businessAcceptance=NOT_RUN`，`nativeReady=false`。先前 v0.6 真实用例 / release 门禁仍按其独立台账处理，不以能力广告代替历史结果。[Draft PR #25](https://github.com/zhouwen-giser/single-agent-chat-server/pull/25) 保留 Draft，main 合并由用户控制。

证据：[包身份](package-proof.json)、[API / 对话 / SSE](api-proof.json)、[资源 / 模型比较](resources-proof.json)、[安装](install.txt)、[43 项检查](tests.txt)、[浏览器复测](browser-tests.txt)、[CI 原失败](ci-browser-postgres-failure.txt)。
