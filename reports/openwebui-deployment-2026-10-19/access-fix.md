# 本机访问修复 — PASS

用户反馈 `http://17.26.1.20:18084/` 访问失败后，检查确认访问路径存在问题。
Open WebUI 和 SACS 均 healthy；禁用代理直连首页与健康接口均为 200。
同一 IP 地址经过现有 `127.0.0.1:7890` 代理返回 502；实际 Codex 内置浏览器
导航该地址时报告 `net::ERR_BLOCKED_BY_CLIENT`。修复前 Docker 只绑定网卡
IP，`127.0.0.1:18084` 没有监听。上一轮测试使用绕过代理的独立 Chromium，
未覆盖用户当前内置浏览器的实际访问路径。

补上 `127.0.0.1:18084:8080`，本机浏览器使用 <http://127.0.0.1:18084/>。
保留原 IP 端口供有直接路由的设备访问。CORS 和 WebSocket 仅允许这两个明确
origin；没有改动主机或用户代理设置。部署器对两个绑定分别检查，避免旧容器
已占用网卡端口时遗漏新增回环端口的冲突。

实际重新创建的仅为 Open WebUI 前端容器，复用原镜像和数据卷。签名密钥、
管理员凭据文件字节均与备份相同，账号登录仍有效；既有聊天两条消息保留。
SACS 和 PostgreSQL 的容器 ID、镜像、启动时间、网络与挂载均保持一致。

| 验证           | 结果                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| 实际内置浏览器 | 回环地址跳转 `/auth?redirect=%2F`，完整显示「登录 Open WebUI」、电子邮箱、密码和登录按钮；已将可用页面交给用户 |
| 本机 HTTP      | 首页、健康检查 200；未登录模型列表 401                                                                         |
| 原账号 / 模型  | 登录 200，`/openai/models` 200，发现 `sdar-single-agent`                                                       |
| 既有聊天       | API 返回 200，原 user / assistant 两条记录保留                                                                 |
| WebSocket      | `transport=websocket`，回环及原 IP origin 均成功升级 101，并校验握手摘要；未允许 origin 返回 403               |
| 回归           | 部署 contract tests 1 suite / 6 tests PASS，含两种绑定升级 / 冲突场景                                          |
| 代码检查       | 作用域 ESLint、全仓 Prettier、secret-pattern、`git diff --check` PASS                                          |

运行配置已同步到 `/mnt/data/openwebui-sacs-live/deployment`；旧配置备份在
`/mnt/data/openwebui-sacs-live/backups/20261019-before-loopback` 私有目录。
初始密码仍在本机 `shared/admin-credentials.json`，没有进入仓库或诊断证据。
本机回环地址不作为远程机器或互联网入口；原 IP 通过外部代理的路由问题没有
被宣称为已修复。本次没有调用 SDAR 创建或修改业务 Task。

证据：[访问 / 数据保留](access-fix-proof.json)、[实际内置浏览器截图](login-fixed.jpg)。
