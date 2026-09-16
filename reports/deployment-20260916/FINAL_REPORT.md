# SACS 开发环境部署交付

部署已就绪：<http://17.26.1.20:18083>。独立 Compose 项目 `sacs-dev`，
仅新增 SACS 和专用 PostgreSQL，复用 WSGS、SDAR、kimi-k3 模型配置。
开发网内客户端共享固定用户身份，可调用全部现有能力，包括 SDAR 操作；
不具备生产鉴权或多租户隔离。未执行真实设备动作。

## 包与部署身份

- 源码提交：`0642f2cdf706726915d84101f2dd1583a012a629`。
- 本地归档：`.tmp/deployment/0.6.0-0642f2cdf706/sacs-development.tar.gz`。
- SHA-256：`ad897c9ee85bea03c528c4d19ce1fad716cda3ff180469c6c605dcadd50bf070`。
- 镜像：`single-agent-chat-server:0.6.0-0642f2cdf706`。
- 镜像 ID：`sha256:059bd0f5b74832ad415273fdb1e4d0b61d97737cbdc1a042a7e065365b1fb25e`。
- 远端归档：`/mnt/data/sacs-live/incoming/0642f2cdf706/sacs-development.tar.gz`。
- 当前发布：`/mnt/data/sacs-live/releases/e54c1c0b06a4cf56/`，`current` 指向此目录。

包内包含 SACS/PostgreSQL 固定镜像、Compose、安装工具、环境模板、说明、
迁移摘要及逐文件 SHA-256 清单，不包含实际配置或凭据。不需要远端源码构建。
旧包保留，交付和后续安装仅使用上述最终包；报告提交可以晚于镜像源码提交。

## 一键操作与配置

在 `sz-gowm` 重复安装当前成功包：

```sh
bash /mnt/data/sacs-live/current/deploy.sh install
```

首次解压安装、`preflight`、`status`、API curl 示例见 [操作说明](../../deployment/README.md)。
应用回滚命令：

```sh
bash /mnt/data/sacs-live/current/deploy.sh rollback
```

回滚只接受完全一致的迁移集合与数据库校验和，不执行数据库降级或恢复覆盖。
发布、回滚和重复部署有锁保护。更新前仅备份 SACS 数据库，现有三个备份非空。
专用数据卷为 `sacs-dev_data`，不执行 `down -v`。

远端私有主配置：`/mnt/data/sacs-live/shared/runtime.json`。
其派生 `runtime.env`、`postgres.env` 均为 `0600`；模型凭据仅在远端导入，
PG 环境文件不含模型密钥。重复部署未轮换配置、密钥或身份。
模型等待、WSGS HTTP、分析等待及业务请求预算均为 120 秒。

服务仅绑定 `17.26.1.20:18083`；PG 无宿主机端口。未部署 Open WebUI、公网域名
或修改防火墙。浏览器跨域仍须逐项配置，匿名模式不代表允许任意 CORS。

## 验收分层

| 层次                                         | 结果                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| 部署、健康、专用数据库                       | PASS；两个容器 healthy，20 项迁移                                         |
| 匿名 `/v1/models`、AG-UI、分析能力查询       | HTTP 200；六项高级能力 AVAILABLE                                          |
| WSGS 冻结 1.2、SDAR A2A 1.0 Agent Card       | PASS；不自动降级                                                          |
| 普通对话                                     | 单次 POST，HTTP 200，21 字符非空回复                                      |
| 历史只读分析传输                             | 单次 AG-UI POST，HTTP 200 / RUN_FINISHED，无 RUN_ERROR                    |
| 历史业务结果                                 | UNRESOLVED / TASK_CONTEXT_REQUIRED，0 Finding，不是轨迹正向 PASS          |
| 源结果与投影                                 | 公开结果哈希、Finding 集合与 SACS 投影一致；空地图/时间线不算正向展示验收 |
| Analysis Control 查询及重启持久化            | PASS；重启前后响应摘要、投影哈希一致                                      |
| 应用更新、兼容回滚、恢复最终版、同包重复安装 | PASS；数据摘要、行数和配置均保留                                          |
| SDAR 设备动作、非终态任务恢复、完整高级分析  | NOT_RUN；未扩大现场验证范围                                               |

原私有历史用例 `/tmp/sacs-v06-history-after-reference.env` 已不存在。
因此使用一次公开上下文发现请求，要求真实引用、重新验证、不猜测任务标识；
上游明确返回 TASK_CONTEXT_REQUIRED。没有复用旧租期或自动补发。
要完成轨迹正向验收，仍需当前有效的具体任务标识或私有用例文件。
部署就绪不等于 v0.6 全部业务验收完成。

本轮仅两个业务 POST（普通对话一次、只读历史分析一次）。数据库最终保留一个
Analysis Session、一个 Projection、一个 Grounding Execution；SDAR Task Binding 为零。
恢复、回滚、重复安装均未重复创建 Grounding Job。三个阶段快照哈希均为：
`sha256:dbd1a247563680568d83a58c0968929c3eb4636e7d6a95749eed94bb84619f9f`。

65 个既有容器的身份、镜像及启动时间与部署前一致。SACS 不连接上游数据库；
专用 PG、WSGS/SDAR 公开接口和模型是配置目标。瞬时连接观测不作为完整网络
隔离证明。未修改或重启共享服务，未删除共享数据。

## 自动化验证与证据

本地完整 `pnpm verify:ci` 两轮通过（独立临时 PG，已清理），覆盖类型、构建、
单元、契约、安全、PostgreSQL、迁移、替身 E2E、架构、许可证和秘密扫描。
部署工具额外 5 项测试覆盖配置保留、端口冲突、包损坏/缺失/多余/符号链接、
启动失败不切换成功标记以及应用回滚。真实部署未人为注入服务故障。

最初失败及修正见 [实施记录](IMPLEMENTATION.md)，未覆盖旧回执。
本地 Compose 单独检查因 Docker 网络池耗尽未运行成功，未清理他人网络；
GitHub 独立 runner 上 Compose、镜像与 SBOM 验证已通过。
最终部署包源码的 [完整 CI](https://github.com/zhouwen-giser/single-agent-chat-server/actions/runs/35073918656)
已通过 quality 和 container 两项检查。证据归档提交继续运行同一 CI，
不自动合并或打标签。

脱敏机器回执见 [ACCEPTANCE.json](ACCEPTANCE.json)：包与源码身份、命令退出码、
配置权限、数据库计数、公开结果哈希、快照一致性和明确未通过条目。
不含模型密钥、业务原始标识或轨迹正文。
