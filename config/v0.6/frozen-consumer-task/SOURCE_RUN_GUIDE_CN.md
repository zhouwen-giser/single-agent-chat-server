# 源码运行与本地验证说明

本文件是 Codex 需要落实的运行文档要求。现有命令和建议新增命令明确区分；它不是已经运行成功的日志。

## 1. 现有工具链

已读 package.json 使用 Node 22 系列、pnpm 与 Jest，并已有 `typecheck`、`dev:server`、v06 contract/unit/postgres/local-e2e 等脚本。[S14] C00 以当前 package.json、packageManager 和锁文件为准，不自行升级依赖生态。

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:v06:contracts
pnpm test:v06:unit
```

这些命令应在实际改造后验证。安装新增的最小协议校验依赖时允许按现有 pnpm 规则更新锁文件；之后继续用 frozen-lockfile 验证可重现安装。依赖下载失败应记录网络限制，不把锁不一致当理由直接删除锁文件。

`pnpm build` 可以作为自愿的附加编译检查，但本包不要求先生成 dist，不以其作为源码启动、开发功能验收或任务完成的前置。不得用发布聚合脚本带入真实联调/容器/SDAR 动作。

## 2. 获取独立冻结交接包

先定位已有 WSGS 仓库；只读其指定交接提交，不改工作区，不 checkout/rebase 上游，不运行上游服务。以下示例从本地 Git 对象提取完整交接目录到新临时目录：

```bash
set -euo pipefail
WSGS_REPO=/absolute/path/to/world-semantic-grounding-service
WSGS_REF=75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5
HANDOFF=contracts/consumers/sacs-world-analysis-v1
TMP_DIR=$(mktemp -d)

git -C "$WSGS_REPO" cat-file -e "$WSGS_REF^{commit}"
git -C "$WSGS_REPO" archive "$WSGS_REF" "$HANDOFF" \
  | tar -x -C "$TMP_DIR"
(
  cd "$TMP_DIR/$HANDOFF"
  node verify.mjs
)
```

执行时在失败即停止的 shell 中运行或逐条检查退出码，不能在 archive 失败后继续把空目录当成功。若已有仓库没有该 Git 对象，使用已授权的只读读取/下载方式取得该交接快照；不得把当前分支同名文件未经验证就冒充冻结包。

目录根 README 说明：Node 22+，验证无需安装/网络，包含所列校验运行依赖及许可证。[S02] 本任务包不复制这些依赖；Codex 必须取得完整根目录后才执行上述命令。

验证后，把 `public/` 原字节导入 SACS 约定依赖目录。完整交接 verify 的 vendored 依赖可以只留在临时验证副本；SACS 项目运行依赖按自身 pnpm 锁管理。验证来源与运行时模块解析都需测试，不要求把上游 node_modules 整棵纳入 SACS。

不要把上面的交接快照换成 W01 freezeCommit：冻结时报告中的原始合同路径与后来的消费者交接路径不同。冻结提交只用于来源追溯和原锁匹配。[S06]

## 3. 无 Docker 的核心本地 HTTP 验证

Codex 要新增或明确一个仅针对本包的本地 HTTP suite，例如：

```bash
# 建议的新脚本，交付时必须在 package.json 真正定义
pnpm test:v06:frozen-wsgs:http
```

该 suite 应：在 127.0.0.1 随机端口启动受控 WSGS wire server；使用真实 SACS Grounding Job adapter；通过 main 复用的组合工厂创建路由/处理器；向既有 repository 和 model ports 注入受控替身；用公共请求/响应校验器验证两轮请求和结果。

至少覆盖 Chat、AG-UI、Analysis Control、结构化选择、条件修改、取消与错误终态。结束时关闭 server、pump 与计时器；不读取真实 endpoint/token 环境，不发出真实 SDAR/设备调用。

核心测试不设置 `SACS_WSGS_ANALYSIS_TRANSPORT=FIXTURE`，不使用一个直接返回 WorldAnalysisView 的假 Source Adapter。替身只在清楚标识的外部边界，不能绕过本次实现。

现有 `test:v06:postgres` / `test:v06:local-e2e` 可能进入 PostgreSQL harness；`.env.example` 说明 TEST_DATABASE_URL 为空会启动容器。[S17] 不能把这两个旧命令误列为“无 Docker”必需步骤。

## 4. 普通服务的源码启动

现有 `dev:server` 从源码启动服务器。[S14] 完成本任务后，README/.env.example 应清楚展示下列相关配置：

```dotenv
SACS_WSGS_ANALYSIS_ENABLED=true
SACS_WSGS_ANALYSIS_TRANSPORT=GROUNDING_JOB
SACS_WSGS_ANALYSIS_CONTRACT_VERSION=sacs-wsgs-grounding/1.2
SACS_WSGS_ANALYSIS_RESULT_PROFILE=wsgs-world-analysis-findings/1.0
WSGS_BASE_URL=http://127.0.0.1:<local-fixture-port>
```

`<local-fixture-port>` 是说明占位符，实际脚本应输出真实端口。鉴权、模型和数据库等参数仍按当前配置 schema 设置，不把上面五行宣称为足够启动整个服务。

```bash
# 环境配置完成后，从源码启动；不先要求 pnpm build
pnpm dev:server
```

当前 main 实际初始化 persistence 和 conversation model 配置。[S08] 本包不要求部署 PostgreSQL，也不声称去掉了数据库依赖。无数据库环境下通过共享工厂的 L1 测试验证正常业务组合；有真实数据库的源码启动测试属于明确记录的环境扩展，不用静默内存 fallback 伪装它。

应更新旧分析配置注释，区分冻结 Grounding Job 开发消费与仍延期的 Native 控制。不新增“WSGS HEAD 必须完全相等才允许启动”的门禁。

## 5. 结果解释边界

| 验证 | 本包要求 | 可证明的内容 |
|---|---|---|
| 公共包离线 verify | 必需 | 所取得交接包可按其自带规则验证 |
| SACS L0 contract/unit | 必需 | 请求/解码/投影/控制逻辑正确 |
| SACS 共享组合 + 本地真实 HTTP | 必需 | 消费者经过实际网络边界的功能闭环 |
| 内存仓库重建 runtime | 在对应场景中必需 | 已保存身份/结果按 SACS 逻辑恢复，不证明真实 DB |
| 真实 PostgreSQL 持久化与进程重启 | 环境扩展 | 只有实际运行才能证明数据库恢复 |
| 真实模型自然语言质量 | 本包不要求 | 不得用受控模型替身宣称语义识别质量通过 |
| 真实 WSGS/Provider/设备/生产部署 | 不在本包 | 不主动启动或执行 |

真实环境没有运行的项目保留 NOT_RUN 或 OUT_OF_SCOPE。不要触发旧 release gate 去“补齐”它们。
