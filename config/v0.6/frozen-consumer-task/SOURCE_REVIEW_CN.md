# 编制时源码核对

编制日期：2026-09-07。本文区分“已读代码中可见的事实”“本包要求的改造”和“执行时仍需核对”。没有在编制环境运行 SACS 或 WSGS 项目测试。

## 1. 已读来源

| 项目 | 已读快照 |
|---|---|
| SACS v0.6 功能分支 | `7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2` |
| 当时 SACS main | `a957cdaa60dec5a2b3d291f2a97a2ff96a72a182` |
| WSGS v0.2.4 交接分支 | `75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5` |
| 公共合同冻结提交 | `e05e6d4d5ac8de617857edc8e81b935e5efc7daf` |

功能分支与 main 的 SHA 不同，不足以仅凭此判断是否已等价合并。C00 应检查当前提交祖先/代码差异后选基线；不得直接丢弃现有 v0.6 工作。

冻结时的原始合同路径与后续消费者交接目录不是同一个路径：W01 报告指向 `contracts/wsgs-v0.2.4-world-analysis`；给 SACS 的后续交接位于 `contracts/consumers/sacs-world-analysis-v1/public/`。取交接目录应使用交接快照，不要假设冻结提交当天已经存在消费者目录。[S01, S06]

## 2. 具体发现

| 编号 | 已读事实 | 本包要求 |
|---|---|---|
| F01 | `config.ts` 的 contractVersion 是 1.1 literal，resultProfile 是旧地理 Profile literal；默认环境变量也是旧值。[S12, S17] | 增加/设置新消费者精确组合，保持旧记录按原身份读取，不只改 .env |
| F02 | `GroundingJobAnalysisSourceAdapter` 构造时拒绝非 1.1 客户端；已有 start/get/observe/cancel，revise/resolveChoice 委托 start。[S11] | 复用传输骨架，适配 1.2 与保存的版本身份；不要重写全套轮询 |
| F03 | `main.ts` 已创建 `createV06GroundingAnalysis` 并把 worldGrounding 注入 Chat/AG-UI。[S08] | 测试和完善既有正常组合，不宣称入口完全缺失 |
| F04 | v0.6 factory 的 AG-UI START 内联生成请求，knownWorldReferences/priorGroundings 等为空数组。[S09] | 共用会话请求构造，传入受控的前序结果与结构化选择 |
| F05 | 真实 Control 的 submitProposal 和 resolveIntervention 都指向 `unsupported`，返回 503 / `GROUNDING_SOURCE_REVISION_NOT_READY`。[S10] | 实现条件修改、选择解决、幂等保存及新 Revision/Source |
| F06 | Control 的取消路径已记录取消意图，但对 HTTP cancel 有 `.catch(() => undefined)`。[S10] | 检查后续 pump 的真实结果处理，补失败/竞争测试；不把“已请求”当成“已取消” |
| F07 | 现有世界分析视图测试使用本地 `HISTORICAL_ROAD_ASSOCIATION` 等历史类型，另有手写的历史样本。[S13] | 接受公共五类类型后显式映射；公共示例进入核心回归 |
| F08 | config 中 `maxSafePayloadBytes` 最大为 262144；新公共 Result 上限为 1048576。[S04, S12] | 审查这是 view 预算还是线协议预算，避免无意拒绝合法大响应；不是一律调大所有限制 |
| F09 | 仓库已有 pnpm/Jest 的 v06 contract/unit/postgres/local-e2e 入口；现有 postgres/local-e2e 命令依赖 PostgreSQL harness。[S14, S17] | 复用测试栈，增加可无 Docker 运行的真实 HTTP 消费测试入口；不把旧 harness 当本包必需命令 |
| F10 | AGENTS 已声明 WSGS 北向消费、持久化分析投影、地图/时间轴与非执行性历史候选为本仓职责。[S18] | 增量补齐，不设计新产品；遵守单 SDAR 和无 Provider/MCP 直连边界 |

F06/F08 是已发现的需审查风险点，不是仅凭一段代码就证明所有运行路径都出错。Codex 必须查看上下文和测试，修复实际缺口并保存反例。

## 3. 已核实的新公共协议要点

- 1.2 精确协商二元组，wire schemaVersion 仍 1.0；公共世界集合必有，地理集合可选。[S03, S04]
- 完整交接根目录可以 `node verify.mjs` 离线验证；公共包包含校验器、类型、示例和闭包。[S02]
- 新选择走 `analysisSelections`；官方完整请求示例的 priorGroundings 项含 groundingId/resultHash/selectedProductIds。[S07]
- 官方排名例中候选1的排名值为 -40、代表观测值为 -42；候选2的排名值为 -50、代表观测值为 -45。此差异可直接用于防混淆测试。[S15]
- 原始公共冻结记录保留 W01 的 `FROZEN_UNDISTRIBUTED_CANDIDATE` 和 OFFLINE 范围；独立最终报告记录 DEV_READY。这两份文件记录不同阶段，不应在 SACS 中“修复”冻结文件。[S01, S05, S06]

## 4. 不应重复建设的部分

保留已有 Grounding Job Source、会话/Revision/Run、world focus、请求 claim、来源 pump、正常组合工厂、AG-UI 与基础地理投影。对过时部分做显式替换或适配，不新增另一份平行分析实现。

不为本任务提升产品版本、更新所有依赖或替换框架。不要导入上游业务运行时，也不要为了生成行动候选读取 SDAR 私有 API。

## 5. C00 仍需核对的事项

检查当前分支是否已有修复、所有 AGENTS/局部规范、HTTP 客户端合同选择与恢复代码、持久化 schema/JSON 的封闭性、各入口的 request/proposal/selection DTO、版本持久化和 UI 已有扩展点。确认公共包实际校验导出、哈希向量、示例清单与依赖闭包。

这些属于正常实施前的仓库核对，不能成为要求用户再提供一份已公开合同或让上游再次改代码的理由。必要信息确实不可访问时，记录精确路径/权限/错误，并继续不依赖它的工作。

## 6. 证据层级

WSGS FINAL_REPORT 中的测试数量、DEV_READY 与未运行范围是上游报告内容，不是本次独立重跑。[S01] 本包只确认源码与文档内容，并对任务包本身做文件/链接/清单检查。执行后由 Codex 用本仓真实测试填充证据台账。

来源：见 [reference/SOURCES.md](reference/SOURCES.md)。
