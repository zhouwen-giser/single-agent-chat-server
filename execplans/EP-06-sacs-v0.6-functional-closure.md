# SACS v0.6 功能修复与验收方案

本方案先修复已复现的会话路由和默认部署缺陷，再交付浏览器中的世界分析展示、显式交互、进程恢复与真实 WSGS 验收。现有 Grounding Job、Analysis Session/Revision/Run、AG-UI 和 A2A 适配器继续复用。Native Analysis 与结构化 SDAR grounding 交接分别设置外部合同门槛。

R00 已交付方案、基线和验收清单。R01 已完成会话路由和执行前检查，R02 已完成默认部署配置及有界运行状态；后续阶段按验收清单继续推进，开发证据不代表真实联调或发布通过。

## 基线与范围

- 日期：2026-10-13，Asia/Shanghai。
- 分支：`codex/sacs-v0.6-wsgs-full-functional-integration`。
- 业务源码基线：`30dd9814de93acf7e3e24311b8b477cdbcac16c2`。
- 冻结 A2A：spec patch 1.0.1，wire 1.0，HTTP+JSON，`@a2a-js/sdk@1.0.0-beta.0`。
- 冻结世界分析：`sacs-wsgs-grounding/1.2` 与 `wsgs-world-analysis-findings/1.0`；已有 1.0/1.1 路径保留各自协议身份。
- 新验收清单：[acceptance-matrix.json](../config/v0.6/functional-closure/acceptance-matrix.json)。新阶段报告放在 [functional-closure](../reports/v0.6/functional-closure/)，旧任务包和验收记录保留原状。

当前本地开发主链已有验收证据。上一轮审查在该业务基线上复跑了类型检查、629 项冻结回归、17 项真实 PostgreSQL及本地 HTTP/SSE 测试，均通过。新增的 10 个受控语言场景中，7 个暴露了路由问题。这些测试没有调用真实 SDAR 或设备；它们证明执行入口的隔离不足，不代表已发生实际设备执行。

最新 Grounding presentation 台账为 G01–G12 开发 PASS、R01/R02 `BLOCKED_EXTERNAL`。历史轨迹另有一次受限正向记录；道路关联、排名、时序事件等尚缺对应真实成功验收。真实服务当前是否可用，应由后续公开接口预检确认，不能由历史报告推断。

## 缺口与完成条件

| 缺口                                         | 本次范围中的处理                           | 完成条件                                                                     |
| -------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| 历史候选相关执行表达漏过拦截                 | R01 增加授权上下文约束和执行前保底检查     | 各种改写均不能把历史候选送入 SDAR mutation；独立任务与只读任务查询保持可用   |
| 普通对话被世界续聊正则截走                   | R01 限制续聊入口，恢复正常 TurnPlan 分类   | 无有效世界上下文时，普通对话不创建 Grounding；有上下文时也不因通用词强制改道 |
| 根目录 Compose 丢失 WSGS 设置                | R02 对齐两种部署入口、配置与文档           | 开关、地址、协商身份和运行预算实际进入容器，开启与关闭均有可观察结果         |
| 只有无界面参考客户端                         | R03/R04 交付独立浏览器参考客户端           | 用户能查看地图、时间轴、证据、候选，并完成显式确认和范围再查询               |
| 运行中进程恢复和取消未真实验收               | R05 完成隔离进程故障测试，R06 补真实源场景 | SIGKILL、断库、双进程竞争和取消恢复保留身份与权威状态，无重复逻辑工作        |
| 真实正样本、选择和高级结果未闭环             | R06 扩展现有验收 runner                    | 每项都有真实公开结果、语义与投影断言；缺上下文的用例独立记录外部阻塞         |
| 状态入口和发布证据未对齐                     | R02/R07 更新状态与验收入口                 | 开发、真实集成、发布及条件扩展分别报告，不以历史 PASS 代替新代码验收         |
| Native Analysis 与 SDAR grounding 交接不可用 | N01/E01 条件阶段                           | 收到并锁定公开合同、实际实现证据和可用能力后，才接入生产适配器               |

## 实施顺序与交付

| 阶段 | 目标                       | 前置阶段                 | 主要交付                                                             |
| ---- | -------------------------- | ------------------------ | -------------------------------------------------------------------- |
| R00  | 固定方案与审查基线         | 无                       | ExecPlan、验收矩阵、基线、方案阶段报告、Draft PR 更新                |
| R01  | 修复会话路由与候选执行隔离 | R00                      | 有上下文约束的续聊入口、执行前检查、普通对话与 A2A 兼容回归          |
| R02  | 接通默认部署和运行状态     | R01                      | Compose 设置、隔离启动预检、配置说明、状态入口与运维检查             |
| R03  | 交付可浏览的世界分析界面   | R02                      | 同源页面、认证接入、地图/时间轴/证据/候选展示及浏览器测试            |
| R04  | 接通显式候选和范围交互     | R03                      | 选择确认、局部范围草稿、再查询、取消与断线恢复                       |
| R05  | 验证进程级恢复与并发隔离   | R02、R04                 | 子进程故障 harness、真实隔离 PostgreSQL、锁竞争与重放断言            |
| R06  | 完成真实公开接口验收       | R01–R05                  | 真实结果、选择、高级历史、范围查询及恢复/取消的独立证据              |
| R07  | 汇总功能与交付资格         | R01–R06 的逐项结论       | 当前源码验证、CI、SBOM、运行指南、最终报告及 Draft PR                |
| N01  | 接入 Native Analysis       | 权威 Native 合同通过预检 | 隔离 HTTP adapter、真实 Plan/Event/Revision/Intervention/Cancel 消费 |
| E01  | 接入 SDAR grounding 交接   | SDAR 扩展合同与实现可用  | 通过 A2A 的结构化交接与严格授权验证，历史候选仍无执行授权            |

先按表中顺序推进；R06 的私有用例材料可在 R01–R05 实施期间准备。Native 或 SDAR 扩展暂缺，不阻止 Grounding Job 路径完成本地开发和适用的真实验收。总体报告持续列出尚未接通的扩展能力。

每个实现阶段使用小型语义提交，执行适合改动的测试，保存报告，正常 push 并更新现有 Draft PR #25。不 rebase、不 force-push；最终 merge 由用户控制。方案和实现阶段均不自动部署共享服务。

## R01 会话路由与执行入口修复

主要修改 `apps/server/src/v06-grounding-analysis.ts`、`apps/server/src/chat/conversation-application-service.ts`，以及必要的 SACS 会话上下文/决策类型。LangGraph 继续负责薄分类，WSGS 继续负责世界语义。

先加载用户和 Chat 授权的当前 Analysis/Revision/Source 上下文。候选续聊必须与当前公开候选、待处理 intervention 或显式来源命令有关。正则可帮助识别已绑定的窄命令，但不能单独把任意文本提升为世界分析。

“改为”“这个位置”“第一个”等通用表达不得在正常分类前强制改道。无有效上下文时交还既有 TurnPlan 分类；无法唯一确定候选时返回澄清，只有明确的世界新查询才能创建新 Grounding。已绑定的展示操作继续留在本地，结构化 Choice 确认继续复用既有 Control 路径。

在 SDAR mutable operation 的 dispatch 前再做来源检查。与历史候选绑定或无法排除历史目标引用的请求，保持只读分析或澄清；历史记录、模型输出和指代词都不能形成执行授权。明确独立且未绑定历史候选目标的新任务仍使用现有 A2A 流程，已有 Task 的只读状态查询保持可用。不能只扩充动词列表，也不能全局禁用 SDAR。

永久保留本次发现的语句回归，并覆盖中文、英文、混合表达、否定/引用、独立新任务、已有 Task follow-up、跨用户/Chat、旧 Revision 和 utility 请求。受控模型故意返回 `SDAR_TASK`，验证服务器保底检查仍有效。计数应同时覆盖任务 claim、A2A factory 和 adapter 方法，不能只检查回答文本。

验收：FC-01–FC-06。阶段测试重点为正常 OpenAI/AG-UI 入口、conversation application、候选与 A2A 兼容/安全边界；完整冻结回归在实现稳定后执行一次。

## R02 默认部署与运行状态

主要修改 `compose.yaml`、`.env.example`、部署预检和容器说明，复用 `deployment/compose.yaml` 已有的环境文件方式。修复根目录默认入口实际未传入任何 WSGS 设置的问题，保留默认关闭的明确配置，不隐式开启业务功能。

两种入口均应传入启用标志、WSGS URL/运输认证、精确合同/profile、轮询与等待预算、裁剪限制、pump 上限和兼容标志。检查使用隔离的虚拟设置，并仅输出键名和安全摘要，不打印真实 Compose 解析中的密钥。

开启后由实际公开 capabilities 确认合同、profile、required readiness 和 available operations；合同不匹配要明确失败。关闭后仍可使用普通聊天和 A2A，并明确不提供 v0.3 世界分析。预检和运行能力接口不能从 `supportedOperations` 推断实际可用性。

保持 `/health` 为进程存活信号。`/ready` 报告数据库、模型及已启用世界分析的检查状态，并保留分项结果；WSGS 检查应有短超时和缓存，不在健康探针中创建 Grounding。下游故障不伪装成配置关闭，也不把一次失败记成永久能力缺失。

更新根 README、PROJECT_STATUS 和部署指南，清楚区分历史 v0.5/frozen consumer 记录、当前本地开发证据和本计划的未完成项。运维检查至少能识别源状态、取消待确认、恢复失败与预算耗尽；若启用 OpenTelemetry 导出，锁定依赖/许可并验证有效采集，默认日志继续使用安全字段。

验收：FC-07–FC-09。先做 Compose 解析及配置负例，再启动隔离容器验证真实进程收到设置；不更新现有共享部署。

## R03 浏览器中的世界分析展示

新增 SACS 自有的轻量浏览器参考客户端，例如 `apps/analysis-web/`，通过同源页面与后端桥接接入现有 API。复用 `HeadlessAnalysisReferenceClient` 和 `MapEngineAdapter`，不修改 Open WebUI 源码、不复制 AG-UI 框架、不新增世界事实计算。

页面提供分析目录和当前 Revision、源状态/Activity、最终文字、地图、时间轴、证据与候选卡。公开 Finding/feature/evidence/product/choice 的稳定关联驱动定位；地图只绘制源结果实际公开的几何，时间轴保留真实 Gap 和 PROVISIONAL 等限定，不连接轨迹缺口或从道路 ID/H3 补造位置。

第一版优先交付离线可用的公开几何展示。使用已有 map port 隔离浏览器渲染器，支持平移、缩放、fit、图层开关、定位与检查。若选用地图引擎或浏览器测试库，先核对官方接口、固定具体版本、记录许可并纳入构建；底图瓦片是独立、明确配置的展示依赖，不能成为 Grounding 可用性的前提。

认证作为该阶段的完成条件：同源后端桥接只能接受现有可信签名用户身份，服务密钥留在服务端，浏览器使用短期会话。会话到期不得超过身份有效期；cookie 需 HttpOnly/SameSite，HTTPS 下 Secure，并校验 Origin/CSRF。不能使用浏览器自报 userId 或自动匿名身份，也不能把服务密钥写入脚本、URL 或 localStorage。没有可信身份接入时页面入口保持关闭，该项不能记为完成。

所有网络访问进入明确的客户端 transport/后端桥接边界。若新增浏览器 transport，需要同步更新架构检查的精确目录许可，继续禁止向 WSGS 内部、Provider、上游数据库或任意用户 URL 发请求。页面以文本节点呈现公开文字，限制远程资源来源，避免原始 HTML 注入。

验收：FC-10–FC-13。必须在真实浏览器中检查绘制、关联、鉴权和错误呈现；无界面 reducer 测试不能替代浏览器完成标准。

## R04 显式交互与界面恢复

候选检查只改变本地检查焦点。确认按钮重新检查 Revision、intervention、selector 和 TTL，提交现有 `resolveIntervention`；成功后发起同一 Analysis 的新 Observation Run，只有权威 Snapshot 才更新当前共享视图。过期候选保持可读且禁用确认，并提供显式重查。

点、线、闭合面和 Circle 的绘制是本地草稿。提交显示确切范围与 CONTINUE/REPLACE 选项，使用 `GROUNDING_SOURCE_QUERY` 和既有几何/hash，等待新 Revision/Grounding。清除/重绘推进草稿 generation，过期确认不得提交新草稿。源服务未声明支持的空间语义，应保留其公开缺口，不能近似替代 Circle 或宣称空间查询成功。

页面断线保留最后视图，重连请求完整 State/Activity，恢复按钮不得重复 START。取消按钮展示 `CANCEL_REQUESTED`，只有源终态才显示已取消。用户双击、网络丢包后的显式同键重放保持幂等；过期身份需要重新认证，不能自动扩大 TTL。

验收：FC-14–FC-17。使用真实浏览器、真实本地 TCP/SSE 和隔离 PostgreSQL；断言导航/绘制/图层操作零后台 mutation，明确按钮才创建新工作。

## R05 进程级恢复与并发隔离

在脚本/测试 harness 中启动独立 SACS 子进程，通过实际 HTTP、隔离 PostgreSQL 和公开合同兼容的本地 WSGS peer 驱动故障。生产代码继续不依赖 child_process。故障点由有界测试通知确认，避免靠任意 sleep 猜测阶段。

覆盖发送前、上游已接受但响应丢失、Job ID 已保存但 Analysis 尚未绑定、RUNNING 时 SIGKILL、终态保存后投影写入失败，以及取消意图已保存但回执丢失。重启后从持久化 canonical request/合同身份恢复；已保存 Job ID 使用 get/poll，发送不确定窗口仅按相同 canonical bytes 和 idempotency key 恢复。

短时断库和两个 SACS 进程竞争同一工作必须验证租约、claim fencing 与唯一约束。旧 Revision 的迟到结果仅进入历史记录，不能覆盖当前 Revision。当前实现含 180 秒租约及 30 秒恢复 tick；验收记录这些实际参数和恢复耗时，恢复界限由租约、tick、启动和轮询预算计算，不能承诺即时恢复。

先完成消费者本地故障证明，再在 R06 对允许的真实、由本次运行创建的 read-only Job 进行适用场景验收。应用实例恢复通过不等于 PostgreSQL HA、跨地域切换或生产压测通过，后者独立列为发布/容量资格。

验收：FC-18–FC-22。证据包含独立进程 PID 生命周期、数据库 reopen、上游调用计数、身份/hash、权威终态和清理结果；内存重建和模拟异常不替代 OS 进程终止。

## R06 真实公开接口与高级历史验收

复用 `scripts/agui-grounding-real.mjs` 和 `verifyGroundingObservation`，按用例扩展 runner。公开 capabilities 预检验证 1.2/profile 和所需 AVAILABLE 能力，再通过正常 SACS Chat/AG-UI/Control 链路执行。

需要当前有效、已授权的私有用例文件：可唯一解析的主体/任务、可查询的历史上下文、确实能返回 Choice 的歧义输入，以及高级历史和空间范围的有效公开输入。每个输入提供预期结果种类/限定和最大提交次数，敏感标识与几何留在私有文件。通过公开接口取得/验证引用，不读取任何上游数据库，不用过期私有文件，不补造 task ID 或 ReferenceKey。

| 用例                        | 真实完成断言                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------- |
| FC-23 正常或 PARTIAL 正结果 | 至少一个合法 Finding，公开状态、文字、地图/时间轴、identity/hash 与持久化一致         |
| FC-24 候选确认              | 真实未过期 Choice 经显式 Control 生成新 Revision/Grounding，selector 精确、无重复工作 |
| FC-25 历史轨迹              | 实际 HISTORICAL_TRACE 的主体、时间限定、PROVISIONAL/Gap 与公开几何同源                |
| FC-26 道路关联              | 实际 ROAD_ASSOCIATION 保留源道路关系/几何缺口，不推导路由或补造道路位置               |
| FC-27 时序事件              | 实际 TEMPORAL_EVENT 保留公开时序及限定；请求的停车/穿越子类型逐项报告                 |
| FC-28 指标排名              | 实际 METRIC_RANKING 保留原排序、单位、数值及缺口，展示裁剪不改变权威候选              |
| FC-29 历史行动候选          | 实际 ACTION_TARGET_CANDIDATE 保留验证/规划/确认要求和 executionAuthorized=false       |
| FC-30 范围再查询            | 显式公开 geometry/hash 形成新 Revision；验证源声明支持的空间语义与返回投影            |
| FC-31 真实恢复与取消        | 本次专有 Job 的进程恢复无重复逻辑工作；取消只有公开权威终态才通过，两个子检查都需证据 |

每次运行限目标 origin 和公开路径，读取专有配置，固定公开 120 秒 request/HTTP 预算；提交数量由各用例先行声明。扩展取消 runner 时只允许取消本次创建且持久化归属已验证的 Job，不操作共享或他人任务。观察窗口可以覆盖明确的租约恢复等待，但不能修改上游模型或业务 deadline。

HTTP 200、RUN_FINISHED、capability advertising 和空结果不等于正向验收。缺少有效输入/能力的用例记录 `BLOCKED_EXTERNAL`，运行断言失败记录 `FAILED`，未执行记录 `NOT_RUN`；不自动改换等价输入反复发起业务查询。各 Finding 用例独立通过，不能由一次轨迹成功推定道路/排名/事件也通过。

补充有界真实模型意图验收，记录 ordinary/world/task/clarification 的预期和实际路由、超时与结构化输出失败；它只验证 SACS 消费者入口，不建立评估平台。模型无法判断目标来源时，R01 的确定性执行检查仍须生效。

## R07 最终验证与交付

新增本计划自己的 development/integration/release 检查入口，命令名称和实际执行在对应阶段提交时一起交付。现有 `verify:v05:integration`、`verify:v05:release` 保留历史范围说明，不能改成无条件成功，也不能让它们冒充 v0.6 验收。

DEVELOPMENT 要求 FC-01–FC-22、FC-32/33 和当前源码的必要回归通过；REAL_WSGS 要求 FC-23–FC-31 逐项通过；发布候选再要求 FC-34 及适用的部署/网络/负载资格。R01–R04 的 FC-01–FC-17 已有直接 PASS 证据，其余新行仍为 `NOT_RUN`。任一真实必需项外部阻塞时，开发报告可单独完成，但整体真实集成保持待完成。

最终稳定代码执行一次冻结回归、相关 PostgreSQL/本地 E2E、浏览器回归、安全/架构/迁移/许可检查和 build；候选提交运行 CI 质量与容器 Gate。新改动、失败或未解决疑点才扩大或重复检查。R00 仅为方案文档，检查格式、链接、矩阵、基线一致性；不为文档改动重复执行此前已通过的 629 项业务测试。

维护逐项台账和当前状态入口，报告测试命令/退出码、候选源码 SHA 或业务源码摘要、合同/依赖 hashes、私有输入摘要、实际失败和证据路径。原始请求、坐标、身份与凭据不进入仓库/PR。发布资格必须绑定最终候选，历史 CI 或旧版本部署不能自动继承。

更新 Draft PR 的最终实现范围、证据与剩余依赖。可部署候选包、SBOM、启停/恢复指南和经验证的运行设置准备完成；共享服务部署、main merge 和真实设备操作不作为该源码交付的自动步骤。

## N01 Native Analysis 条件阶段

先收取 WSGS 公开权威 consumer bundle：consumer lock、Plan、Event、ToolInteraction、Revision Control、Cancel、Intervention schema locks 和 CHECKSUMS 共八项。验证字节哈希、来源提交、公开 endpoints、状态、顺序/幂等/恢复语义和实际 AVAILABLE 能力；不把当前 Grounding Job 内部处理解释成 Native DAG。

合同通过后实现 `HttpWsgsAnalysisAdapter`，只访问锁定 endpoints，消费真实 Plan/Event/Revision/Intervention/Cancel，执行严格身份、事件顺序和重放验证。只有实际发布的 tool lifecycle 才生成对应 AG-UI tool events。新路径以明确开关组合，Grounding Job 路径独立保留。

验收：EXT-01/02。合同未满足时继续提供明确的不可用原因；本仓不实现 WSGS Native API、不改上游合同。

## E01 SDAR grounding 交接条件阶段

先获得 SDAR 当前公开扩展 schema、Data Part media type、Agent Card 能力声明、handler/validator 证据及可验证的消费语义，重新锁定来源；不能据旧 UNAVAILABLE 锁推断当前上游永久不支持。

合同通过后，仅经既有 A2A adapter 发送严格结构化 OperationalGroundingBundle。引用须公开、当前验证有效、用户目标明确且 Task 授权正确；历史候选展示本身始终不产生授权。扩展拒绝/未知时明确失败，不能丢掉 Data Part、转成自由文本或降级创建无 grounding Task。既有 Task Message 继续携带允许的 sdar_action 和严格 metadata。

EXT-03 的离线验证/组合工作可在合同到位后完成；EXT-04 的真实消费需专有、安全的授权请求，并与 read-only WSGS 验收分开。设备控制、Provider 执行与 SDAR 内部 Goal/Plan 状态仍由上游负责。

## 当前进度

- R00：已交付方案，格式与一致性检查通过，提交 `f7e57a6` 已推送。
- R01：FC-01–FC-06 PASS，677 项完整冻结回归、类型/架构/build 通过，见 [R01 报告](../reports/v0.6/functional-closure/R01.md)。
- R02：FC-07–FC-09 PASS，105 项定向及 13 项隔离 PostgreSQL 测试通过，五项隔离容器场景通过，见 [R02 报告](../reports/v0.6/functional-closure/R02.md)。
- R03：FC-10–FC-13 PASS，12 项浏览器/身份检查、71 项安全/API 回归和 4 项 PostgreSQL 检查通过，见 [R03 报告](../reports/v0.6/functional-closure/R03.md)。
- R04：FC-14–FC-17 PASS，12 项浏览器回归、4 项 Chromium/PostgreSQL 控制场景及 79 项 client/entry/link 回归通过，见 [R04 报告](../reports/v0.6/functional-closure/R04.md)。
- R05–R07：尚未完成，对应验收行为 `NOT_RUN`。
- N01/E01：条件扩展，合同与真实可用性待后续预检；不宣称功能完成。

下一步为 R05 进程 SIGKILL、数据库中断与并发恢复。
