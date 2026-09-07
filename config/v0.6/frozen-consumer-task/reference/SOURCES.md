# 来源索引

所有源码引用固定到编制时已核实提交。链接是定位证据，不是要求服务运行时 HEAD 与其相等。正文中的 [S01] 等编号对应本索引。编制时没有运行仓库测试。

| 来源 | 已读快照 |
|---|---|
| SACS | `7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2` |
| WSGS 消费交接 | `75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5` |
| WSGS 原始冻结提交（追溯） | `e05e6d4d5ac8de617857edc8e81b935e5efc7daf` |

Git blob SHA 是内容寻址信息，不是 SHA-256 字节校验值；导入检查应使用公共包真实锁与校验规则，不能直接拿 Git blob SHA 与 release SHA-256 比较。

## S01 — WSGS 最终开发报告

路径：`reports/wsgs-v0.2.4-stable-world-analysis-service/FINAL_REPORT.md`

[固定提交源码](https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5/reports/wsgs-v0.2.4-stable-world-analysis-service/FINAL_REPORT.md)

记录 DEV_READY、冻结提交和真实环境未运行范围。仅视为上游报告，不视为本次重跑。

## S02 — 独立消费者交接 README

路径：`contracts/consumers/sacs-world-analysis-v1/README.md`

[固定提交源码](https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5/contracts/consumers/sacs-world-analysis-v1/README.md)

说明 Node 22+ 的 node verify.mjs、public/ 与校验运行依赖。

## S03 — 公共协议 README

路径：`contracts/consumers/sacs-world-analysis-v1/public/README.md`

[固定提交源码](https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5/contracts/consumers/sacs-world-analysis-v1/public/README.md)

精确协议二元组、公共校验器、人工示例与生成规则。

## S04 — 公共协议 SEMANTICS

路径：`contracts/consumers/sacs-world-analysis-v1/public/SEMANTICS.md`

[固定提交源码](https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5/contracts/consumers/sacs-world-analysis-v1/public/SEMANTICS.md)

选择、身份、时间、排名、行动非授权、hash、状态与大小等规范。

## S05 — 公共包内 W01 冻结状态

路径：`contracts/consumers/sacs-world-analysis-v1/public/contract-freeze.json`

[固定提交源码](https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5/contracts/consumers/sacs-world-analysis-v1/public/contract-freeze.json)

记录冻结时候选状态；不能当运行时进度字段去修改。

## S06 — W01 独立冻结报告

路径：`reports/wsgs-v0.2.4-stable-world-analysis-service/W01/contract-freeze.json`

[固定提交源码](https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5/reports/wsgs-v0.2.4-stable-world-analysis-service/W01/contract-freeze.json)

记录真实 freezeCommit、原始合同路径和报告中的 release lock hash。

## S07 — 官方完整选择请求样例

路径：`contracts/consumers/sacs-world-analysis-v1/public/examples/request-selection.json`

[固定提交源码](https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5/contracts/consumers/sacs-world-analysis-v1/public/examples/request-selection.json)

完整 1.2 请求、priorGroundings.selectedProductIds 和五字段 analysisSelections。

## S08 — SACS 正常启动 main.ts

路径：`apps/server/src/main.ts`

[固定提交源码](https://github.com/zhouwen-giser/single-agent-chat-server/blob/7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2/apps/server/src/main.ts)

本次读取前210行：已有 v0.6 组合注入、persistence 与 model 配置。非全文件审查。

## S09 — SACS v0.6 组合工厂

路径：`apps/server/src/v06-grounding-analysis.ts`

[固定提交源码](https://github.com/zhouwen-giser/single-agent-chat-server/blob/7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2/apps/server/src/v06-grounding-analysis.ts)

正常 Source/Control/AG-UI 组合；START 内联空上下文。

## S10 — 真实 Grounding Source 控制

路径：`packages/analysis-control-runtime/src/grounding-source-control.ts`

[固定提交源码](https://github.com/zhouwen-giser/single-agent-chat-server/blob/7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2/packages/analysis-control-runtime/src/grounding-source-control.ts)

submitProposal/resolveIntervention 尚为503占位，已有取消实现。

## S11 — Grounding Job Source Adapter

路径：`packages/wsgs-analysis-adapter/src/grounding-job.ts`

[固定提交源码](https://github.com/zhouwen-giser/single-agent-chat-server/blob/7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2/packages/wsgs-analysis-adapter/src/grounding-job.ts)

此前同一已核实基线读取：1.1限制、start/get/observe/cancel、revise/resolveChoice委托。

## S12 — 分析配置 Schema

路径：`packages/wsgs-analysis-adapter/src/config.ts`

[固定提交源码](https://github.com/zhouwen-giser/single-agent-chat-server/blob/7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2/packages/wsgs-analysis-adapter/src/config.ts)

1.1与旧Profile literal、显示/观察限制和Native deferred。

## S13 — 现有历史视图测试

路径：`tests/v06-world-analysis-view.unit.test.ts`

[固定提交源码](https://github.com/zhouwen-giser/single-agent-chat-server/blob/7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2/tests/v06-world-analysis-view.unit.test.ts)

此前同一基线读取：本地历史类型、手工历史样例和地理集合投影。

## S14 — SACS package.json

路径：`package.json`

[固定提交源码](https://github.com/zhouwen-giser/single-agent-chat-server/blob/7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2/package.json)

此前同一基线读取：pnpm/Jest、typecheck、源码dev:server、v06相关测试入口。读取工具脚本部分，不声明完整依赖审计。

## S15 — 官方排名 Result 样例

路径：`contracts/consumers/sacs-world-analysis-v1/public/examples/ranking.json`

[固定提交源码](https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5/contracts/consumers/sacs-world-analysis-v1/public/examples/ranking.json)

人工数据：候选中位排名值与代表样本值不同；Choice 与选择请求锚点关联。

## S16 — 公共 Metric Ranking Schema

路径：`contracts/consumers/sacs-world-analysis-v1/public/metric-ranking.schema.json`

[固定提交源码](https://github.com/zhouwen-giser/world-semantic-grounding-service/blob/75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5/contracts/consumers/sacs-world-analysis-v1/public/metric-ranking.schema.json)

公共 discriminator、所选系列、候选与 coverage 等模型。

## S17 — SACS 环境配置示例

路径：`.env.example`

[固定提交源码](https://github.com/zhouwen-giser/single-agent-chat-server/blob/7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2/.env.example)

现有变量名、WSGS_BASE_URL 与 PostgreSQL harness 说明；不包含真实凭据。

## S18 — SACS AGENTS.md

路径：`AGENTS.md`

[固定提交源码](https://github.com/zhouwen-giser/single-agent-chat-server/blob/7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2/AGENTS.md)

产品/架构边界和分支、提交、Draft PR规则。

## 交接导入时必须额外读取的内容

公共 OpenAPI、全部 schema 引用闭包、validator.mjs、生成类型、示例 manifest、CHECKSUMS 和 release lock 必须作为整体取得。此索引不是完整交接文件清单；本包只提供任务与已读证据，不冒充冻结消费者代码包。

## 检索与执行范围

源码经 GitHub 连接读取。通用网页搜索没有提供额外可用证据，任务规格未采用非官方解读。没有在编制环境运行 pnpm/Jest 或上游 node verify；执行记录由 Codex 在目标工作区填充。
