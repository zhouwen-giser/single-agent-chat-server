# Goal 规格：冻结 WSGS 协议消费者

## 1. 任务定位

本包是 SACS v0.6 的续作，不是新建分析平台。交付对象是一个可从源码运行、具有真实请求/响应边界及多轮控制能力的消费者。WSGS 负责世界对象解析、Provider 编排、历史分析和公共结果权威；SACS 负责会话、协议消费、可解释展示和用户交互。

主要依赖顺序：

```text
自然语言/结构化交互
  → SACS 会话与请求规划
  → 冻结 WSGS Grounding Request 1.2
  → Grounding Job 生命周期
  → 公共合同校验
  → 统一 WorldAnalysisView
  → 文本 / 地图 / 时间轴 / Choice / 非执行候选
  → 选择或条件修改
  → 新 Grounding + 新 Revision
```

WSGS 的算法、T2/T3/T4 DAG、Gateway 数据结构、私有 source authority 和设备资源绑定均不进入 SACS。

## 2. 权威来源与版本

交接根目录为 `contracts/consumers/sacs-world-analysis-v1/`，公共协议在 `public/`。以公共 README、SEMANTICS、OpenAPI、JSON Schema、生成类型、校验器、锁文件和示例 manifest 为完整整体。[S02–S07]

合同选择为精确二元组：

```http
WSGS-Contract-Version: sacs-wsgs-grounding/1.2
WSGS-Result-Profile: wsgs-world-analysis-findings/1.0
```

请求、Result、Job 的 `schemaVersion` 仍为 `"1.0"`。`worldAnalysisFindings` 是合法 1.2 Result 的必有集合，允许空；`geospatialFindings` 可选且沿用其原地理 Profile。不要将产品版本 v0.2.4、协议 1.2、Profile 1.0 和 envelope 1.0 混成一个版本号。[S04]

来源提交只服务于可重现的交接导入，不是运行时要求 upstream HEAD 精确匹配的条件。不要求 WSGS 重新冻结，不在 SACS 中重新生成或修改冻结文件，不为本任务修改其他仓库。

`public/contract-freeze.json` 记录的是 W01 冻结时的候选状态，最终开发状态由独立 FINAL_REPORT 提供。不能因为冻结文件保留历史字段就擅自修改它；也不能把上游 DEV_READY 当成本仓已集成的证据。[S01, S05, S06]

## 3. 合同消费与完整性

建议把公共目录原样导入 `dependencies/wsgs-world-analysis-v1/public/`；消费者包装代码放入现有模块或一个很薄的 SACS 内部模块。公共包所需的运行依赖按 SACS pnpm 锁管理；不得将上游全部业务代码复制进来。

完整交接目录中的 `node verify.mjs` 可在只读来源的临时副本执行，验证原始包。项目内另需测试实际打包路径下的校验器可加载、引用闭包完整和公共示例通过。不要只执行上游 verify 就认定 SACS 已完成消费。

解码顺序：有界 JSON 读取 → 对应 envelope 的公共 Schema 与交叉字段语义检查 → 官方规则下的完整性校验 → SACS 投影。优先使用公共导出的校验/哈希能力；若某项未导出，先检查公开向量，再做最薄包装，不重写一套近似算法。

`findingSetHash` 按新合同覆盖 `{profile, findings, choices, gaps}`，不能沿用“只哈希 findings 数组”的旧算法。`resultHash`、请求幂等哈希、原始存储字节哈希、SACS view hash 是不同身份，不能相互替代。哈希只证明完整性，不提供用户/会话/数据访问授权。[S04]

外部数据必须先完成协议验证，再进入文本或视图。未知 schema、非法状态组合、非法引用或完整性错误不能通过形状猜测变成已确认事实。

## 4. 请求、Capabilities 与生命周期

### 4.1 请求构造

复用已有请求规划与会话上下文，当前用户原文、originalTextSha256、请求标识、引用锚点、时间和执行策略保持一致。不在 Chat、AG-UI、Analysis Control 各维护一份逐渐分叉的构造代码。若各入口语义确实不同，可使用同一构造器的显式参数，而不是暗中丢字段。

同一次提交的网络重试保持相同语义请求和幂等键；条件修改、Choice 选择或重新查询创建新的请求身份。幂等比较包括完整语义输入及合同选择，不只比较文本。重试不刷新 Choice TTL，不制造新候选身份。[S04]

### 4.2 Capabilities

按冻结 capabilities schema 区分 supported 与 available，区分协议支持、权限/快照导致的部署可用性、必需与可选能力。不因某个历史可选能力不可用而关闭所有 Chat、Reference 或无依赖地理能力。不将一次成功的 HTTP 响应、contractReady 或 nativeReady 当成全能力可用。

只保留公共允许的 reason code，不能泄露上游原始异常、payload、私有 URL、栈或认证信息。Native 仍为 deferred，但不得影响 Grounding Job 消费。删除新功能对旧 Native 交接目录/expected SHA 的错误依赖；不删除与本包无关的旧兼容逻辑。

### 4.3 传输与保存的合同身份

POST、GET、cancel 和 capabilities 使用公开路由和精确 Header。同步 200 Result 与异步 202 Job 分别校验，然后汇入同一消费路径。GET/cancel 的 envelope 和状态以 OpenAPI 为准，不凭经验猜测。[S03, S04]

保存每次 Source 的实际合同组合。恢复旧 Source 或取消它时使用该 Source 的组合，而不是进程最新全局配置。可以复用既有 JSON/元数据字段；若必须迁移，说明旧记录如何识别。无法可靠识别的记录必须显式报错，不能静默假设为 1.2。

406 不自动降级重发；409 不偷偷换键并当成功；403 不换 Profile 绕过。网络/观察窗口耗尽只表示本地观察受限，不等于 WSGS 已 FAILED；上游明确终态才可投影相应来源终态。

### 4.4 Job 与 Session 分离

| 来源状态 | Job 是否终止 | SACS 交互含义 |
|---|---|---|
| ACCEPTED / RUNNING | 否 | 有界观察，不虚构百分比 |
| COMPLETED | 是 | 展示完成结果；不等于真实世界任务完成 |
| PARTIAL | 是 | 保留有效独立结果和 Typed Gap |
| AMBIGUOUS | 是 | 停止该 Job 轮询，进入用户选择 |
| UNRESOLVED | 是 | 停止轮询，请求补充语义条件 |
| FAILED | 是 | 显示公开错误，不抹掉历史证据 |
| CANCELLED | 是 | 显示实际取消结果 |

`PARTIAL + HISTORICAL_PROJECTION_PENDING` 是这次请求的终态，不是继续轮询同一个 Job 的理由。重新查询是新请求。UNKNOWN/GAP 不能证明没有经过或真实值为零。[S04]

重复轮询结果不能重复生成用户结果/候选。继续利用已有请求 claim、source pump 和 Revision 绑定；旧 run 的迟到事件可保留历史，但不能覆盖当前 Revision。不要新造并行状态机或恢复服务。

用户关闭页面/断开观察不发送取消；明确取消才走公开 cancel。取消请求已记录不等于远端已取消；失败必须保留可查询的状态和安全原因，不能吞掉错误后伪报 CANCELLED。取消与完成竞争按实际返回/随后确认的来源终态处理。

## 5. 统一结果与展示

公共 Finding 仅使用五个实际 discriminator：

`HISTORICAL_TRACE`、`ROAD_ASSOCIATION`、`TEMPORAL_EVENT`、`METRIC_RANKING`、`ACTION_TARGET_CANDIDATE`。[S04]

SACS 内部可以继续使用适合 UI 的名称，但必须有明确的映射层，不能把旧 `HISTORICAL_*` 测试对象直接当作新线协议。文本、地图、时间轴、Choice 和行动候选应来自同一经过验证并可追溯的 Result；保留 `groundingId/resultHash/findingSetHash` 与实际 Finding/Choice/Candidate 身份。

每个有效 Finding 的 `evidenceIds` 关联本 Result 的 `evidenceItems[].evidenceProductId`；Evidence Item 内部上游 evidenceIds/receiptIds 不自动成为本地产品 ID。真实 ReferenceProduct、分析 Finding、Choice、Candidate、事件、路网局部 ID、H3 ID 分属不同命名空间。[S04]

### 5.1 五类 Finding 的显示要求

| 类别 | 必须保留 | 禁止推断 |
|---|---|---|
| HISTORICAL_TRACE | 任务/执行区分、请求/所选/活动/暂停/定义/排除/Gap 时段、完整性与 finalization | 跨 Gap 插值、ALL 执行拼接、把轨迹封存当指标采样完整 |
| ROAD_ASSOCIATION | 参考路网角色、道路访问、离网/歧义/质量与缺口、最后可确认项及范围 | 根据道路 ID 猜几何、把参考路网当历史真实道路、把“已确认最后”当绝对最后 |
| TEMPORAL_EVENT | 公开事件类型、完整来源时间窗、可选估计、FIRST/LAST 证明与阻塞区间 | 在 SACS 重算确定性、把未知时间窗缩成精确瞬时 |
| METRIC_RANKING | 原排名、系列/单位、MEDIAN 排名值、代表观测值/时间/位置、样本统计、时间完整性未知 | 代表样本值冒充中位值、混合系列重排、取绝对 RSSI、H3 中心替代访问点 |
| ACTION_TARGET_CANDIDATE | 来源 Finding/Candidate/Rank/Measurement、原始代表访问 Point、非执行标志 | 合成位置、当前可达性结论、直接转导航/任务 |

在地图上只画公开提供的实际几何；路网只有 ID 时可显示列表，不为补地图调用 Provider。稀疏位置 Preview 不自动连成轨迹；公开 line preview 不是导航路线。TimeRange 的时区信息与区间 bounds 保留在结构化状态中；界面转换时区不能改写来源时刻。[S04]

### 5.2 排名的两个数值

`rankingBasis.rankingValue` 是排序中位值；`representativeValue` 是代表 Measurement 的观测值。显示名称、排序依据和单位不得混淆。不要在前端根据代表样本值重新排序。

### 5.3 空集合、裁剪和缺口

合法 1.2 查询即使只有地理结果，也有空的世界分析集合；不能因此报错。允许 NO_DATA、PARTIAL、INDETERMINATE 与独立可用结果共存。

显示预算与公共 Result 上限分开：公共上限是 1 MiB，调用者更小 maxResultBytes 优先；SACS 现有 256 KiB safePayload/view 预算不能无意成为拒绝全部合法 1.2 响应的新线协议上限。[S04, S12]

验证完整 Result 后再进行 UI 裁剪，保留来源身份、选中项和必要引用闭包。裁剪不改变上游 resultHash/findingSetHash，也不擅自改写 confirmed。确实不能保留依赖时，隐藏依赖操作并明确本地展示受限。需要选择的候选可从已保存的合法原始结果读取，不能只按当前可见列表位置识别；无法取得权威来源时重新查询或澄清。

## 6. 结构化选择与多轮

公共 Choice 覆盖 `REFERENCE_SELECTION`、`TASK_SELECTION`、`METRIC_SERIES_SELECTION`、`RANKED_LOCATION_SELECTION`、`EVENT_SELECTION`。这些类型都需可展示、可定位且按冻结协议回传，而不只支持排名选择。[S04]

顶层 `analysisSelections` 每项严格为：

```text
priorGroundingId
priorResultHash
findingSetHash
choiceId
candidateId
```

最多 8 项；匹配 `contextCapsule.priorGroundings` 中的来源锚点。完整请求应从公共 `examples/request-selection.json` 学习，不照抄一个缺少必填字段的简略 JSON。该例的 priorGroundings 项还包含 `selectedProductIds: []`，不得将空数组“优化掉”而绕开正式校验。[S07]

`selectedProductIds` 只用于真实 ReferenceProduct ID。不能把 candidateId、rank、H3 ID、道路 ID 填进去。用户坐标、显示摘要或 rank 不是选择权威。

选择对象必须从本用户/会话保存的有效结果映射。按钮携带不可歧义的来源和候选身份；自然语言“第二个”只在一个唯一有效 Choice 内转换，不能跨列表猜测。有多个 Choice、文字与结构化选择冲突、上下文已切换或候选缺失时澄清，不默认选择第一项。保留既有范围隔离，不新建认证平台。

Choice 的 `validUntil` 是来源字段，受 60 秒窗口及来源有效性共同约束。GET/重试/恢复不能续期。已过期结果仍可阅读，但旧 Choice 操作不可继续复用；提供新查询入口。时间相关测试使用受控时钟，不改冻结样例时间或吞掉过期规则。

### 6.1 修改分析不是本地重算

展示展开、地图聚焦和查看已返回细节可以本地完成。更换任务/执行/对象/阶段/指标/单位/系列/目标或要求新的分析结论，必须生成新语义请求、新 Revision 和相应新 Source，不是裁剪旧结果后改标题。

已选择但未过期的身份也不应无条件跨新语义范围复用；按新请求重新确认。新的条件使旧行动目标失效，不能在新标题下继续展示为当前目标。

`submitProposal` 与 `resolveIntervention` 必须走上述真实执行路径，移除仅返回未就绪的桩。处理 request/command 幂等、并发修改冲突、持久化归属、旧结果保留和新投影发布。不得只修改 Adapter 的 `revise()` 方法就宣称控制闭环完成。

## 7. 行动候选与执行隔离

新候选只支持公共模型中的非执行性 MOVE_TO_LOCATION 意图，并保持：

```text
currentValidationRequired = true
routePlanningRequired = true
executionConfirmationRequired = true
executionAuthorized = false
```

普通 Top-K 查询不自动变成行动。用户明确要求把历史候选作为目标时，通过 WSGS 新请求形成候选，显示三个待完成条件。本包不增加 World→SDAR 绑定、Grounded UGV DataPart、执行确认卡、导航参数或任务创建。[S04]

不能因原文含“让车返回”就把这一世界派生候选绕回旧 SDAR_TASK 路由产生副作用。用受控 A2A spy 证明新链路没有执行调用，同时以既有测试证明普通 SDAR 对话功能没有被全局禁用。

## 8. 正常入口、持久化与兼容

正常入口 `main.ts` 已使用 `createV06GroundingAnalysis`；优先修补其公共客户端、请求构造、控制服务及投影。AG-UI START 的空上下文必须补齐；RECONNECT 不能新建 Grounding；两种协议入口的结果语义一致。[S08, S09]

只在需要时提取最小共享组合工厂，以便生产启动和测试复用。测试可以替换数据库/模型/对端，但不能通过另一套逻辑绕开正常入口。不要新建外部 Web UI；交付本仓已有 AG-UI/状态视图、接口载荷及现有本地预览能力。

复用已有 Session/Revision/Run、claim、pump、幂等与保存结果。保存完整经过验证的原始来源与足够选择锚点；只存裁剪 View 不够。先确认现有 JSON/结构化字段能否承载，不能为了几项版本/选择字段先建新数据库平台。

不破坏 1.0/1.1 的已支持读取与存量路径，不自动升级旧结果；不新建通用多版本转换框架。普通 Chat/Reference 在可选分析关闭或能力不可用时继续可用。将旧文档中的“必须真实联调/发布构建后才可开发使用”等本任务冲突说明改为准确的开发范围，不重写历史验收报告。

## 9. 测试与完成条件

L0：公共合同、领域逻辑、投影、请求构造、配置及控制单测。

L1：本地 HTTP 对端 + 真正 SACS HTTP 客户端/Source Adapter + 共享组合工厂 + 正常 Chat/AG-UI/Control 路由。持久化和模型可用明确的受控替身，不能将整个 SACS 分析 Adapter 设为 FIXTURE。

所有 REQUIRED 场景需 PASS，并有测试文件/用例名/命令/退出码/来源定位。重复运行与针对性故障回归应真实执行。若本地依赖或权限阻塞某个 REQUIRED 场景，结论为 PARTIAL，不把 NOT_RUN 改 PASS。

已有真实 PostgreSQL 测试与真实模型质量评估不属于本包完成门槛；改动相关代码必须补测试，环境未具备则记录明确限制。真实 WSGS、GOWM/GSAP/GDPS、SDAR/UGV、生产部署/发布一律不主动执行，不以其缺席阻塞本包开发就绪。

最终交付源码、测试、必要文档、单仓提交/可用时 Draft PR、短阶段记录、最终报告。上游 72/72 或 954 测试等是上游自报证据，绝不复制为 SACS 测试结果。[S01]

文中来源编号见 [reference/SOURCES.md](reference/SOURCES.md)。
