# SACS v0.6 冻结 WSGS 消费者最终报告

## 结论

**结论：SACS_WSGS_FROZEN_WORLD_ANALYSIS_CONSUMER_DEV_READY。** C00–C06 已完成，REQUIRED **40/40 PASS**；最终交付源码回归 **521 tests / 42 suites** 全部通过，未跳过测试。该结论仅代表冻结消费者 L0/L1 开发验收，不代表真实数据库恢复、模型质量、上游联调、设备执行或生产发布就绪。

本次工作是 SACS 单仓内的冻结 WSGS 消费者开发集成：复用正常 Chat、AG-UI、Analysis Control、Grounding HTTP adapter 和持久化组合，补齐公开 Finding/Choice、不可变源 Revision、同源展示与非执行历史候选。未部署真实联调环境，也不以真实模型、真实 PostgreSQL 或真实上游验证代替本地源码证据。

## 实际变更

关键文件按职责分组如下；路径均相对 SACS 仓库根目录。完整基线变更清单见 [CHANGED_FILES.txt](CHANGED_FILES.txt)。

| 分组               | 关键文件                                                                                                                                                                                                                                          | 已实现内容                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 冻结公共依赖       | `dependencies/wsgs-world-analysis-v1/public/`、`packages/wsgs-geospatial-consumer/src/frozen-world-analysis.ts`                                                                                                                                   | 原字节导入公开闭包、锁校验、实际公共 validator、完整请求/结果与官方哈希校验；没有重新生成公开文件。                                                                    |
| 协商与来源生命周期 | `packages/wsgs-http-adapter/src/index.ts`、`packages/wsgs-analysis-adapter/src/grounding-job.ts`、`packages/analysis-runtime/src/grounding-source-runtime.ts`                                                                                     | 精确双 Header、capabilities 的 supported/available 区分、200/202/GET/cancel、原始结果和每个 Source 自有协议身份、实际终态与恢复观察。                                  |
| 正常入口           | `apps/server/src/v06-grounding-analysis.ts`、`apps/server/src/api/analysis-routes.ts`、`apps/server/src/api/openai-routes.ts`、`apps/server/src/chat/conversation-application-service.ts`、`apps/server/src/chat/sdar-chat-runner.ts`             | 正常 main 与测试共用 `createV06GroundingAnalysis`；Chat、AG-UI START/RECONNECT 和 Control 共用规划、来源与视图；内部持久化 principal 与外部 SDAR 用户身份明确分离。    |
| 选择与 Revision    | `packages/grounding-request-planner/src/frozen-request.ts`、`packages/analysis-control-runtime/src/grounding-source-control.ts`、`packages/persistence/src/analysis-development-repository.ts`、`packages/persistence/src/analysis-repository.ts` | 完整已授权源选择校验、显式 `GROUNDING_SOURCE_QUERY`、父 Revision CAS、命令幂等/围栏、HTTP 前保存 canonical request、原子绑定新 Revision/Run；不捏造 Native Plan/node。 |
| 持久化与历史隔离   | `migrations/0020_grounding_source_revision_control.sql`、`packages/persistence/src/grounding-repository.ts`、`packages/persistence/src/grounding-source-history.ts`、`packages/analysis-development-runtime/src/index.ts`                         | 仅扩展现有 command 约束/索引；紧凑 intent 保持 4 KiB 边界，不重复保存完整用户文本；旧源迟到仅更新历史 Run/append-only audit，不覆盖当前投影和新 Run。                  |
| 同源展示与交互     | `packages/world-explanation-runtime/src/frozen-analysis-view.ts`、`packages/world-explanation-runtime/src/analysis-view.ts`、`packages/analysis-client/src/frozen-world-analysis.ts`、`packages/analysis-client/src/index.ts`                     | 五类世界 Finding 与旧 geospatialFindings 共存；文本/地图/时间轴/Choice 同源；展示裁剪不改变原哈希与选择权威；Point/LineString 仅公开实际几何，历史行动明确无执行授权。 |
| 源码交付与证据     | `scripts/v06-frozen-tests.mjs`、`scripts/v06-frozen-phase-verify.mjs`、`tests/v06-frozen-*.test.ts`、`tests/helpers/frozen-wsgs-http.ts`、`tests/helpers/memory-frozen-analysis.ts`、`package.json`、`README.md`                                  | 四个源码测试命令、动态发现冻结套件与明确列出的受影响既有回归、正常本地 HTTP 组合、SQL driver 边界、稳定源码摘要与逐 AC 证据；依赖 pin 和 Apache-2.0 许可不变。         |

## 公共合同来源

来源记录见 [SOURCE_IMPORT.json](SOURCE_IMPORT.json)，离线交接验证见 [handoff-verification.json](handoff-verification.json)。

- 仓库：`zhouwen-giser/world-semantic-grounding-service`。
- 交接提交：`75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5`。
- 冻结来源提交：`e05e6d4d5ac8de617857edc8e81b935e5efc7daf`。
- release lock：`sha256:45f027673834f3d9e654a889eea25eaf81522f594af8dddf6939b91a0dd4c41a`。
- 请求/响应协商 Header 精确为 `wsgs-contract-version: sacs-wsgs-grounding/1.2` 与 `wsgs-result-profile: wsgs-world-analysis-findings/1.0`；wire `schemaVersion` 仍为 `1.0`。

C00 的实际 SACS contract 命令及锁/漂移正反例通过，记录在 [C00.json](C00.json)。离线交接验证本身为 PASS，但只证明导入材料；交接包自报示例数量不计入 SACS 功能通过数量。本次不修改冻结合同和上游仓库，不追随上游 HEAD 重新生成公开字节。已经保存的旧 1.1 Source 仍按原协议读取；配置默认值变化不升级历史来源，未知协议组合安全拒绝。

## 验收台账与命令结果

正式记录为 [ACCEPTANCE_LEDGER.json](ACCEPTANCE_LEDGER.json)。40 个 REQUIRED 场景保持完整，ENVIRONMENTAL/EXCLUDED 不进入分母。阶段摘要不能替代退出码、测试日志与来源摘要。

| 阶段 | 当前实际结果                  | 证据及待回填项                                                                           |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| C00  | PASS；SACS 52 tests / 1 suite | [C00.json](C00.json)、`C00-command-*.txt`。                                              |
| C01  | PASS；154 tests               | [C01.json](C01.json)、[C01.md](C01.md)；AC-007/008 的正常入口闭环另由 C05 对账。         |
| C02  | PASS；195 tests / 12 suites   | [C02.json](C02.json)、`C02-command-*.txt`。                                              |
| C03  | PASS；358 tests / 23 suites   | [C03.json](C03.json)、[C03.md](C03.md)；包括 23 个正常入口 case。                        |
| C04  | PASS；110 tests / 6 suites    | [C04.json](C04.json)、[C04.md](C04.md)；初次超时日志保留，60 秒有界测试预算重跑 exit 0。 |
| C05  | PASS；116 tests / 9 suites    | [C05.json](C05.json)、[C05.md](C05.md)；正常组合两轮 HTTP 与兼容回归 exit 0。            |
| C06  | PASS；521 tests / 42 suites   | [C06.json](C06.json)、[C06.md](C06.md)；交付 all 源码入口、其余阶段检查均 exit 0。       |

已执行的 C03 正式命令为 `node scripts/v06-frozen-phase-verify.mjs C03`，退出码 0。其展开后的完整命令、各步退出码、输出 SHA-256、父 checkout SHA 与稳定源码树摘要均在 `C03.json`。C03 同时通过全量源码类型检查、137 个生产文件的架构检查、20 个 append-only migration 结构检查、diff 检查；ESLint 为 0 errors / 142 warnings，不宣称零警告。不同阶段回归有重叠，不累加为独立测试总数。

C04 首轮失败日志保留，台账没有因此前进。四个超时 case 为全部 Choice kinds、指代车辆文本、HTTP 400、HTTP 406 的正常入口测试。重跑仅将 entry suite 的有界测试预算由 Jest 默认 20 秒增加为 60 秒，以容纳重复完整 schema 校验及多轮交互；断言和生产 HTTP/观察/Choice TTL 限制均未改变。最终 C04 重跑 110/110 通过，源码类型/架构/迁移检查通过，lint 为 0 errors / 108 warnings；C05 的 116/116 也通过，lint 为 0 errors / 88 warnings。

阶段验证器只有在全部命令退出 0 且前后源码摘要一致时才更新台账。最终 C06 实际执行交付的 `node scripts/v06-frozen-tests.mjs all`，退出码 0；typecheck、架构、迁移结构与 diff 检查均为 0，lint 为 0 errors / 142 warnings。

[最终证据审计](FINAL_EVIDENCE_AUDIT.json) 已通过：8 份成功阶段回执的 43 条命令日志 SHA-256 全部匹配，40 项要求的 280 个原始语义字段未变，160 个证据引用及 145 个测试文件定位均存在。每项都有对应成功回执；历史行号按该阶段验证源码快照解释，测试名称仍可检索。最终源码摘要为 `sha256:4bd9bf7ef350de55e07bf995f905ceb3e292fac60887e213eead75f52a6c6cb5`，与 C06 完全一致。

## 功能闭环证据

以下关系来自 `tests/v06-frozen-entry.integration.test.ts` 的人工公开 fixture 派生数据、受控时钟、模型/持久化端口与真实 loopback HTTP 请求捕获，不是真实用户或真实上游返回的数据。

1. 正常首轮 Chat 或 AG-UI START 调用真实生产 HTTP adapter，保存第一份来源 `G0`、result hash `H0`、finding-set hash `F0`，绑定 Analysis `A` 的原 Revision/Run。200 内联与 202 后 GET 两种观察均有覆盖。
2. RECONNECT 从保存状态重发同一文本、地图、时间轴和 `G0/H0/F0`；仅展开卡片/聚焦地图也复用展示，不创建另一请求。Chat→AG-UI 与 AG-UI→Chat 都验证内部 principal/Analysis 上下文保持一致。
3. 用户选择通过正常已保存 Intervention resolve 路由提交：`{priorGroundingId: G0, priorResultHash: H0, findingSetHash: F0, choiceId, candidateId}`。服务端重新读取完整授权 raw result，校验 scope、父 Revision、真实候选与 TTL；不可只靠显示列表、排名、坐标或哈希鉴权。
4. 捕获到的第二份真实 HTTP body 携带五元组及匹配的 `priorGroundings`。只有真正 ReferenceProduct 候选可进入 `selectedProductIds`；五类 Choice 均有正常入口覆盖。第二个结果具有不同 Grounding ID `G1`，在同一个 Analysis 新建下一 Revision/Run，并保留 parent lineage。上述符号表示断言关系，不是线上 ID。
5. 重放/并发命令使用保存结果而非新建重复逻辑查询。条件变化创建新语义请求；`REPLACE` 清掉旧派生选择和锚点。展示裁剪后的隐藏合法候选仍能由完整来源校验；到期后可读/可重新查询，但不会延长旧选择 TTL。
6. 显式取消先保存本地意图，再调用 source cancel，终态以公开观察为准；观察者断连不发送取消。旧源迟到和 superseded 源恢复只记完整历史，不把远端状态伪造为 CANCELLED，也不覆盖新 Revision 的当前投影。

同一完整结果驱动五类 Finding、Choice、文本、地图与时间轴。排名中位值与代表样本值分开呈现，FIRST/LAST 证明不由显示顺序重算；时区 offset、时间 bounds、活动/暂停/定义/排除/Gap 原值保留。地图不由道路 ID 或 H3 中心合成位置，也不跨 Gap 连线。新增 LineString 专项断言保留两条不相接的公开线段坐标及独立图层、非导航标题和历史 Gap；未推断线段与时间 Gap 的对应关系。

## 执行隔离与兼容

普通 Top-K 不生成行动。只有公开 `ACTION_TARGET_CANDIDATE` 形成历史候选卡，并保留实际代表访问 Point 和四个不可变标记：`currentValidationRequired=true`、`routePlanningRequired=true`、`executionConfirmationRequired=true`、`executionAuthorized=false`。四项篡改负例均在客户端/投影测试中覆盖。

历史候选及指代车辆文本的正常入口测试，对实际 A2A client factory 和方法使用动态 spy，断言没有创建/调用 A2A 工作；不是仅检查返回文本。MCP/设备隔离证据是生产组合无相关端口与架构门禁，不虚报为动态 MCP/device spy。未加入 World→SDAR 执行绑定、导航参数、设备命令或 MCP 调用。

现有普通 SDAR 正向 adapter 回归仍运行，并未全局禁用 SDAR。C03 已执行正常 OpenAI Chat、predecessor、Reference client、Control、query service、World application 与 A2A 回归；C06 又通过交付的 all 入口执行了明确列出的受影响旧 geospatial/renderer/resolver 等套件，完整冻结及兼容回归为 521/521 tests、42/42 suites 通过。

## 源码运行

详见 [SOURCE_RUN.md](SOURCE_RUN.md)。使用仓库 pin 的 Node 22 / pnpm 11 及已安装依赖，不要求先 `build`、Docker 或 release gate：

```sh
pnpm typecheck
pnpm test:v06:frozen-wsgs:contracts
pnpm test:v06:frozen-wsgs:unit
pnpm test:v06:frozen-wsgs:http
pnpm test:v06:frozen-wsgs
node scripts/v06-frozen-tests.mjs all --list
```

正式阶段命令依次为 `node scripts/v06-frozen-phase-verify.mjs C04`、`node scripts/v06-frozen-phase-verify.mjs C05`、`node scripts/v06-frozen-phase-verify.mjs C06`。这些命令需要测试宿主允许本地 Node 子进程与 `127.0.0.1` 监听；沙箱 EPERM 属于宿主权限失败，应在获准本地测试环境重跑，不能记为应用通过。测试入口清理真实 endpoint/credential 环境并跳过开发者 `.env`，不启动 PostgreSQL 或任何真实上游。

普通源码服务仍通过 `pnpm dev:server` 或 `pnpm exec tsx apps/server/src/main.ts` 启动，需要已有、另行授权的数据库、认证、模型和 WSGS 配置；本次没有配置或验证这些真实服务，也没有新增生产 memory fallback。冻结消费配置为：

```dotenv
SACS_WSGS_ANALYSIS_ENABLED=true
SACS_WSGS_ANALYSIS_TRANSPORT=GROUNDING_JOB
SACS_WSGS_ANALYSIS_CONTRACT_VERSION=sacs-wsgs-grounding/1.2
SACS_WSGS_ANALYSIS_RESULT_PROFILE=wsgs-world-analysis-findings/1.0
```

其余 URL/认证键名以 `.env.example` 为准，密钥仅保存在授权配置，不进入报告或 PR。Migration 0020 在真实环境可用时由正常 migration runner 应用；本报告没有将结构检查宣称为已执行真实数据库迁移。

## 未执行项目

| 编号    | 范围                                          | 状态与限制                                                                                                                      |
| ------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ENV-001 | 真实 PostgreSQL 持久化、迁移与进程重启恢复    | **NOT_RUN**。已做真实 repository 的受控 SQL driver 断言和 memory 恢复测试；它们不是 PostgreSQL 约束、锁竞争或数据库重启的实证。 |
| EX-001  | 真实模型自然语言识别质量                      | **OUT_OF_SCOPE；真实调用 NOT_RUN**。受控 model port 不证明线上识别质量。                                                        |
| EX-002  | 真实 WSGS/GOWM/GSAP/GDPS 与 Provider 跨仓联调 | **OUT_OF_SCOPE；真实联调 NOT_RUN**。仅读取冻结协议并使用本地 HTTP peer，不启动或修改上游。                                      |
| EX-003  | 真实 SDAR/UGV/MCP/设备执行                    | **OUT_OF_SCOPE；真实执行 NOT_RUN**。新历史候选链保持零执行副作用。                                                              |
| EX-004  | Native、生产发布、部署编排、HA、压测          | **OUT_OF_SCOPE；发布/部署 NOT_RUN**。未调用旧 release 聚合入口，没有 Docker、tag、release 或自动合并。                          |

这些项目不计入本冻结消费者开发 REQUIRED 通过率，但不得省略，更不能据开发检查宣称生产就绪。

## 交付

沿用分支 `codex/sacs-v0.6-wsgs-full-functional-integration`，起点为 `7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2`。已存在的语义提交为 C00 `e870717`、C01 `46cc2c3`、C02 `867c4fe`、planner `072cc64`、C03 `a02cc39`；C04 `bd14e79`、C05 `fe2fa99` 均已推送；C06 回归与证据审计已完成，验证时 checkout 为 `fe2fa9956db1809293703b10e29b1f025bfacce8`；最终报告、台账及日志由本报告所在的 C06 交付提交统一保存，源码摘要保持不变。

沿用 [Draft PR #19](https://github.com/zhouwen-giser/single-agent-chat-server/pull/19)，不自动合并，不创建 tag/release；最终合并由用户决定。本次 REQUIRED 无剩余项。已完成逐行台账、日志摘要、源码匹配与分阶段报告；真实环境和生产范围仍按上表明确排除。PR 保持 Draft，最终提交和远端同步状态由交付时核对，不自动合并、强推、打标签或发布。
