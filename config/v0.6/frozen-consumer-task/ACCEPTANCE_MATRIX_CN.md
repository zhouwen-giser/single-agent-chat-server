# 验收场景矩阵

共 **40 个 REQUIRED 场景组**。可用参数化 Jest 用例合并实现，不要求 40 个测试文件，也不要求建设新的测试平台。每组都有独立的断言和证据定位；本表在编制时全部为 **NOT_RUN**。

完整机器可读台账见 [acceptance/ledger.template.json](acceptance/ledger.template.json)。运行后复制为报告台账，填入实际测试定位、命令、退出码和日志路径。不得把“实现了代码”“上游通过”或“计划测试”记为 PASS。

## REQUIRED

| ID / 阶段 | 场景 | 预期断言 | 证据 |
|---|---|---|---|
| AC-001 / C00 | **基线与单仓边界**：当前代码与已读 v0.6 基线比较；存在用户未提交改动。 | 记录实际起点和已完成项；保留用户改动；修改只落 SACS；不得因分支 SHA 不同重做历史工作。 | 基线报告、git diff/提交定位 |
| AC-002 / C00 | **冻结交接完整导入**：完整消费者根目录、public 闭包及其锁文件。 | 离线 node verify.mjs 真正通过；SACS 复制的公共字节与来源一致；冻结代码未被重生成；来源提交仅作追溯。 | verify 命令/退出码与公共导入清单 |
| AC-003 / C00 | **实际消费者校验器**：公共 manifest 中全部正反示例；篡改 Schema/引用/哈希。 | SACS 实际加载路径可运行公共校验器；正例接受、负例拒绝；不引用上游 runtime/Provider；不把 verify 上游独立运行当本仓消费完成。 | Jest contract 用例、模块边界检查 |
| AC-004 / C01 | **精确协商与配置**：启用 1.2，依次调用 capabilities/POST/GET/cancel；错配 Header。 | 两项 Header 精确且贯穿生命周期；wire schemaVersion=1.0；重复、缺失、错配不静默接受。 | 本地 HTTP 请求捕获与配置单测 |
| AC-005 / C01 | **存量 Source 合同身份**：保存 1.1 Source 后修改全局默认为 1.2并重建 runtime。 | GET/cancel 仍用该 Source 保存的组合；新 Source 用 1.2；不自动迁移结果；无法识别的历史记录显式失败。 | repository 替身 + 客户端实例/请求断言 |
| AC-006 / C01 | **Capabilities 局部可用性**：supported/available 的不同组合，可选历史能力不可用。 | 按公共 schema 解码；不把响应成功等同所有能力可用；普通 Chat/Reference 不受无关可选能力影响；理由仅公开安全码。 | capabilities contract/unit |
| AC-007 / C01 | **同步 Result**：POST 返回完整合法 200 Result。 | 完整验证后进入既有保存与投影；无虚构 JobId；不依赖必须先得到 RUNNING。 | 真实 HTTP adapter 测试 |
| AC-008 / C01 | **异步 Job**：POST 202，GET ACCEPTED/RUNNING，再给合法终态 Job。 | Job/Result envelope 分别验证，标识/状态一致；同一消费投影；重复快照不重复发布结果。 | HTTP 生命周期测试 |
| AC-009 / C01 | **失败协议不自动绕过**：403、406、409、畸形响应和不匹配的 request/grounding/job 身份。 | 拒绝错误；无降级、无换键掩盖冲突、无 foreign result 落入本会话；保留安全原因。 | 负例 contract 测试与请求次数 |
| AC-010 / C01 | **完整请求幂等**：重试同一次提交；修改语义或 Profile/selection 后再提交。 | 同一次重试 body/key 稳定；新语义新身份；完整语义参与比较；originalText 与摘要匹配。 | 请求构造/哈希与 HTTP 捕获 |
| AC-011 / C02 | **世界/地理结果共存**：地理+空世界集合、仅世界、两者都有、合法无数据。 | 合法 1.2 结果均正常消费；worldAnalysisFindings 缺失拒绝；空世界集合不误判失败。 | 公共样例投影测试 |
| AC-012 / C02 | **身份和证据引用闭包**：五类 Finding 的本地 evidenceProductId 链；上游 evidenceIds/receiptIds；悬空 ID。 | 命名空间不混用；悬空引用被公共校验拒绝；禁止从未知 safePayload 字段创造事实。 | schema/语义负例与证据投影测试 |
| AC-013 / C02 | **轨迹与时间语义**：活动/暂停/定义/排除/Gap、多执行、offset 和各类 bounds。 | 保留时段和执行身份；不跨 Gap 插值；不把 SEALED 当所有数据完整；时区展示不改变来源时刻。 | trace/time 投影单测 |
| AC-014 / C02 | **道路关联语义**：离网、歧义、质量缺口、无几何道路 ID、最后可确认道路。 | 保留参考模型角色与确认范围；没有几何就不补画；离网不等于错误运动；未知后缀不被省略。 | road 文本/地图/时间轴断言 |
| AC-015 / C02 | **事件与 FIRST/LAST**：所有公共事件种类；confirmed true/false，时间窗及裁剪。 | 保留上游证明和阻塞区间；不在 SACS 重算；独立完整证明不因其他显示项裁剪而被降级。 | event 投影参数化测试 |
| AC-016 / C02 | **排名值与代表样本**：官方 ranking.json，候选1 -40/-42，候选2 -50/-45。 | 排名中位值与代表值分别显示；原排名/系列/单位不变；metricTemporalCompletenessKnown=false 被保留；不取 RSSI 绝对值。 | 官方样例驱动排名断言 |
| AC-017 / C02 | **未知与部分数据**：NO_DATA、INDETERMINATE、独立有效 Finding 与 Gap 共存。 | 未知不补零/false；不把局部缺口扩大成全失败；明确样本与历史范围限制。 | 回答投影测试 |
| AC-018 / C02 | **wire 与 view 预算**：合法大于 256 KiB且在有效 wire 预算内的结果；超出请求预算。 | 合法线协议内容不被旧 safePayload 预算直接误拒；超线预算有界拒绝；先验证再裁剪；不改公共哈希。 | 边界大小/引用闭包/投影测试 |
| AC-019 / C03 | **正式选择请求**：从官方 ranking 与 request-selection 的关联生成下一轮请求。 | 五个 analysisSelections 字段正确；priorGroundings 锚点完整；selectedProductIds 仅真实产品；完整请求通过公共校验。 | 实际第二次 POST 的 body 断言 |
| AC-020 / C03 | **五类 Choice 完整支持**：REFERENCE/TASK/METRIC_SERIES/RANKED_LOCATION/EVENT 五种选择。 | 每类可显示、可从其公开身份定位并回传；不以 rank 或数组位置作为身份；不传 Provider 私有对象。 | 参数化 Choice 到请求测试 |
| AC-021 / C03 | **选择归属隔离**：异用户、异会话、异 Grounding/hash/findingSet 的选择。 | 仅使用本会话保存并验证的来源；拒绝错配/foreign selector；hash 不替代授权；错误不泄露其他会话内容。 | 现有 scope 边界单测 |
| AC-022 / C03 | **按钮选择走真实控制**：正常 resolveIntervention 入口提交已保存 Choice 的 candidate。 | 不返回 GROUNDING_SOURCE_REVISION_NOT_READY；经真实请求构造/Source/HTTP 调用产生新结果和 Revision。 | 共享组合控制入口 E2E fixture |
| AC-023 / C03 | **文本序数的唯一性**：“第二个”，分别有一个有效 Choice、多个 Choice、无 Choice。 | 仅唯一有效语境可以解析；其余明确澄清；不总选第一项、不跨列表猜测。 | 受控模型/选择解析与 HTTP 次数断言 |
| AC-024 / C03 | **文字与结构化选择冲突**：点击候选1但文字指定候选2；重复/冲突 choiceId；多于8项。 | 按公开语义拒绝或澄清；不偷偷优先某种输入；不发歧义操作。 | request semantics 与控制负例 |
| AC-025 / C03 | **Choice 有效期**：受控时钟在 validUntil 前后；GET、重试、重连；固定样例日期。 | 未过期可选择；过期仅可读并提示重查；不刷新 TTL/ID；正例不靠关闭时钟检查通过。 | 时间注入测试 |
| AC-026 / C03 | **重复点击与并发控制**：同一 command 重放、并行相同命令、冲突 proposal。 | 同一意图稳定重放，无重复逻辑 Grounding；冲突明确；使用既有 claim/幂等机制，不建新队列。 | command claim 与 HTTP 请求计数 |
| AC-027 / C03 | **条件修改与展示复用**：“排除暂停”“改查第二次任务/丢包率”与“展开卡片/聚焦地图”。 | submitProposal 真实执行新语义请求/Revision；展示操作不无谓重查；不把本地裁剪冒充重新分析。 | 正常控制入口 + request diff |
| AC-028 / C03 | **上下文切换使旧派生失效**：修改对象/任务/执行/阶段/指标/单位/系列/目标后再次选择。 | 旧不适用 selector/行动目标不被重新贴标签复用；必要时重查/澄清；来源历史可保留。 | 多轮上下文与目标失效测试 |
| AC-029 / C03 | **旧 Revision 迟到**：新 Revision 已建立后收到旧 source 的结果/观察事件。 | 旧事件不能覆盖当前投影或完成新 run；历史归属准确；跨 analysis 不串线。 | runtime 时序测试 |
| AC-030 / C01 | **来源终态与交互等待**：AMBIGUOUS、UNRESOLVED、PARTIAL+projection pending 等。 | 停止终态 Job 轮询；等待的是用户或新查询；COMPLETED 不被解释为设备任务完成。 | source terminal/Session 映射测试 |
| AC-031 / C01 | **观察终止不是远端失败**：本地超时、连续轮询失败、客户端断开、Abort。 | 保持实际已知来源状态；显示本地观察限制；不伪造 FAILED/CANCELLED，不因断开发送 cancel。 | 有界观察与 cancel spy |
| AC-032 / C01 | **真实取消与竞争**：明确取消、重复取消、cancel HTTP 失败、完成与取消竞争。 | 意图先记录但最终以来源状态为准；错误不静默变成功；重复命令一致；有限恢复查询可确认结果。 | Control+HTTP 取消场景 |
| AC-033 / C01 | **重连与运行重建**：RECONNECT、重复 poll、重建 runtime 并复用已保存内存仓库。 | 不重新 POST 已存在工作；按保存协议 GET；终态和选择过期不被刷新；报告不称这是真实 DB 恢复。 | 恢复逻辑与 HTTP 次数 |
| AC-034 / C04 | **文本地图时间轴同源**：同一 Result 的所有展示及不同 Entry 协议输出。 | 文本事实、图层、时间轴、Choice 引用相同 Finding/Result；不展示模型臆造的数值或完成状态。 | 投影/AG-UI 状态快照断言 |
| AC-035 / C04 | **几何不补造**：缺道路几何、H3 ID、稀疏预览、Gap、line preview。 | 地图只使用公开实际几何；不做道路补全/H3中心替代/跨 Gap 连线；预览不标作导航路线。 | 地图投影与调用边界测试 |
| AC-036 / C04 | **候选显示裁剪与权威保留**：UI 隐藏部分候选，但已保存原始合法来源；依赖项丢失。 | 可从保存的合法来源解析有效选择；只看显示数组不足；依赖缺失时禁用操作/重查；不重算公共哈希。 | 预算/引用/Choice 交互测试 |
| AC-037 / C04 | **行动候选准确且不授权**：普通 Top-K 与明确历史行动候选请求；篡改四个标志。 | 普通 Top-K 不自动行动；候选来源与访问 Point 一致；三个要求=true、executionAuthorized=false；非法放宽拒绝。 | 官方 action 样例与负例 |
| AC-038 / C04 | **新链零执行副作用**：“将第二个作为返回目标”等多轮；同时运行旧普通 SDAR 受控回归。 | 新链不调用 A2A任务/MCP/设备；只显示候选要求；不能全局禁用旧 SDAR 来蒙混此测试。 | A2A/MCP spy 和旧路径测试 |
| AC-039 / C05 | **正常组合的两轮 HTTP 闭环**：Chat、AG-UI START/RECONNECT、Analysis Control 到真实 HTTP fixture。 | 复用 main 的组合工厂，实际 Grounding Job adapter；START 带会话上下文；选择/修改驱动第二轮；不是另一个假分析 App。 | 完整 L1 集成 suite 与捕获请求 |
| AC-040 / C05/C06 | **兼容回归与源码可运行**：分析关闭/可选能力缺失；旧1.0/1.1、Chat/Reference/地理/A2A受控回归；配置脚本。 | 相关旧行为保持；Native deferred 不阻塞本次；核心 suite 无 Docker/真实上游/发布构建依赖；实际命令和未执行项记录完整。 | typecheck、focused regression、源码运行文档 |

## 环境扩展与排除项

| ID | 范围 | 初始状态 | 是否决定本包 DEV_READY |
|---|---|---|---|
| ENV-001 | 真实 PostgreSQL 持久化/进程重启。已有可用隔离测试库时可验证本次相关改动；不要求部署数据库或 Docker。缺席不证明真实恢复；修改持久化仍需补测试。 | NOT_RUN | 否 |
| EX-001 | 真实模型自然语言识别质量。核心测试允许受控 model port，不得据此宣称真实模型质量通过。 | OUT_OF_SCOPE | 否 |
| EX-002 | 真实 WSGS/GOWM/GSAP/GDPS 跨仓库联调。只读取冻结协议，不启动上游服务，不修改其他仓库。 | OUT_OF_SCOPE | 否 |
| EX-003 | 真实 SDAR/UGV/MCP/设备执行。不主动调用；新行动候选链必须零执行副作用。 | OUT_OF_SCOPE | 否 |
| EX-004 | Native、生产发布、部署编排、HA、压测。不是本包开发验收门槛，不调用旧 release 聚合入口。 | OUT_OF_SCOPE | 否 |

## 判定规则

所有 REQUIRED 通过，且每项可追溯到实际 SACS 测试，才可使用 `SACS_WSGS_FROZEN_WORLD_ANALYSIS_CONSUMER_DEV_READY`。任何 REQUIRED 为 FAIL/BLOCKED/NOT_RUN，最终结论为 PARTIAL 或 BLOCKED，不使用完整就绪标志。

REQUIRED 的分组可以在实施中增加明确子用例，不得未经说明删除语义要求。既有实现已通过某项时直接复用测试并补证据，不重复改写。

真实 PostgreSQL 环境缺席不会阻止本包消费者开发就绪，但报告必须保留该限制；真实模型、上游与设备不主动测试。受控模型决策不等于真实自然语言理解质量，内存 repository 不等于真实 PostgreSQL 恢复。

纯包文件校验只能证明任务包完整，不能计入任何 SACS 功能测试通过率。
