# Open WebUI 连接 SACS 部署 — PASS

后续访问修复：本机内置浏览器请使用 <http://127.0.0.1:18084>。
原 IP 地址经既有代理会返回 502，内置浏览器也拒绝该地址。
原因、修复和实际浏览器验证见 [访问修复记录](access-fix.md)。

局域网访问也已修复并实测：为 `192.168.1.210` 保存精确主机路由，解决前端
容器的跨网段回复进入 CordC 的问题。该设备的实际首页和配置 / 版本请求已
返回 200，见 [局域网修复记录](lan-diagnostics.md)。

2026-10-19（Asia/Shanghai）已新增独立 Open WebUI Docker 前端，连接现有
SACS 实例，浏览器登录、真实普通对话、刷新后聊天保留、代理 SSE 与 utility
隔离验证通过。

## 访问与登录

- 页面：<http://17.26.1.20:18084>。
- 账号：`admin@sacs.local`；随机初始密码保存在本机
  `/mnt/data/openwebui-sacs-live/shared/admin-credentials.json`，权限 0600。
- 登录已开启，自行注册已关闭。未登录请求 `/api/models` 返回 401。
- 当前提供绑定到服务器 IP 的 HTTP 入口；未配置互联网域名、TLS 或外部路由，
  也未宣称从公网验证连通。浏览器应能直连服务器；本机测试浏览器需要对
  `17.26.1.20` 绕过其既有代理。测试没有修改用户代理或主机网络配置。

## 运行身份与连接

| 项目 | 实际结果 |
| --- | --- |
| Compose project / 容器 | `openwebui-sacs` / `openwebui-sacs-openwebui-1`，healthy |
| 官方版本 | `v0.11.3-slim`；运行 `/api/version` 为 `0.11.3` |
| 镜像摘要 | `ghcr.io/open-webui/open-webui@sha256:bb3633af77b35d97783affc9cd8097d8a6dc89fedd5a410ce9a50d85556a870c` |
| 上游 OCI revision | `2a960a59fe1dbbd35282f0556b3666d81102e781` |
| 模型 | `sdar-single-agent` |
| SACS 连接 | `http://sacs-dev-server-1:3000/v1`，经现有 `sacs-dev_outbound` 网络 |
| Open WebUI 数据卷 | `openwebui-sacs_data`，仅挂载 `/app/backend/data` |
| 前端网络 | `openwebui-sacs_default`、`sacs-dev_outbound` |
| 运行目录 | `/mnt/data/openwebui-sacs-live/deployment` |
| 私有配置 | `/mnt/data/openwebui-sacs-live/shared`，目录 0700，三个文件均 0600 |
| 旧配置备份 | `/mnt/data/openwebui-sacs-live/backups/20261019-before-login`，私有目录 |

修正旧配置从容器访问主机 `17.26.1.20:18083` 的连接方式：现有 SACS 仅监听
`127.0.0.1:18083`，前端改为通过指定 Docker 网络连接容器端口。部署保留原有
镜像摘要和签名密钥，新建随机管理员。Open WebUI 不加入数据库、WSGS 或 SDAR
网络，SACS 的主机端口仍保持回环。

SACS、数据库、WSGS、SDAR 及另外的既有容器均保持运行身份；部署前记录的
79 个容器 ID、镜像 ID、启动时间、网络 ID、挂载类型 / 来源 / 目标均一致。
挂载按目标路径排序比较。SACS 仍运行之前冻结的 `af36dd0` 应用镜像，并保留
[原集成部署](../local-docker-integration-2026-10-15/README.md) 中复用 WSGS 的
模型配置。本站 SACS 仍使用共享开发身份；WebUI 登录保护入口，不新增 SACS
用户隔离。未把模型密钥复制到前端。

五个 Chat / Message / parent / utility 头模板均配置，后台标题、标签、后续问题
生成关闭，额外代码执行、搜索和图像生成功能关闭。代理预算为 180 秒。上游官方
[环境配置](https://docs.openwebui.com/reference/env-configuration/) 和运行镜像源码
均确认管理员 bootstrap 只在没有用户时创建账号；重复安装不会重置已有密码。
许可和镜像身份记录见 [依赖说明](../../docs/licenses/v0.6-openwebui-deployment.md)。

## 验证

| 验证 | 结果 |
| --- | --- |
| 部署 contract tests | 1 suite / 4 tests PASS：网络和挂载边界、默认登录与凭据保留、显式匿名兼容、后端 / 网络 / 端口异常停止 |
| HTTP / 登录 | `/health` 200，版本 0.11.3，登录 200，未登录模型列表 401，signup=false |
| 实际 Chromium 页面 | 登录后选择 `sdar-single-agent`，发送普通问候，获得真实回答 |
| 聊天保留 | 页面刷新后内容保留；两条 user / assistant 消息的 ID 和正文与 SACS PostgreSQL 完全一致 |
| 经 Open WebUI 发现模型 | `/openai/models` 200，发现 `sdar-single-agent` |
| 经 Open WebUI 流式请求 | `/openai/chat/completions` 200，`text/event-stream`，3 个 JSON data 帧及 `[DONE]` |
| utility 隔离 | `metadata.task=title_generation` 200；前后线程、消息、Task 绑定数量相同 |
| 真实流式请求持久化 | SACS 消息数量 6 → 8，新增一条线程；Task 绑定始终 0 |
| 重复安装 | 原容器继续 healthy，原密钥 / 镜像和管理员登录有效，浏览器聊天两条消息保留 |
| 代码检查 | 作用域 ESLint、全仓 Prettier、secret-pattern、`git diff --check` PASS |

浏览器回答：

> 你好！我是专为SACS流程服务的通用对话层，随时准备陪你轻松聊天或解答日常问题。

流式回答：

> 你好！很高兴与你交流，祝你今天一切顺利。

本次只验证前端接入和普通对话，没有执行设备任务或替代既有真实历史业务验收。
部署工具与测试已纳入当前 v0.6 分支；继续保留 Draft PR，main 合并由用户控制。

## 操作

```sh
python3 -B /mnt/data/openwebui-sacs-live/deployment/deploy.py status
python3 -B /mnt/data/openwebui-sacs-live/deployment/deploy.py install
```

重复安装使用已拉取的固定镜像，保留卷与凭据。登录后更改的密码以 UI 中的账号为准，
初始凭据文件不会自动同步新密码。部署参数与显式匿名兼容方式见
[安装说明](../../deployment/openwebui/README.md)。

证据：[HTTP / 登录](access-proof.json)、[实际浏览器与数据库](browser-proof.json)、
[SSE / utility](api-proof.json)、[运行资源](resources-proof.json)、[页面截图](chat.png)。
