# 实施计划：C00—C06

阶段顺序是实现依赖，不是七个需要用户反复确认的审批点。每阶段完成后更新一个 ExecPlan 和简短报告，继续下一阶段。保持小型语义提交，不按文档段落机械拆提交。

## C00 — 基线确认与冻结交接导入

**目标：** 确认在完整 v0.6 基础上工作，取得实际可消费的公共合同。

读取仓库规范和本包，检查工作区、当前分支、已有提交及用户改动；创建或复用合适的续作分支。以 SOURCE_REVIEW 为线索逐项复核，不重复已完成的功能。

只读获取 WSGS 指定交接快照的完整 `contracts/consumers/sacs-world-analysis-v1/`，在临时副本执行其 `node verify.mjs`。验证公共文件及其冻结锁；将需要的 `public/` 原样导入 SACS `dependencies/wsgs-world-analysis-v1/public/`。只在 SACS 管理所需运行依赖；不得重建冻结类型或把 Provider 代码带入。

记录来源仓库、交接提交、冻结提交、协议组合、锁校验结果、导入清单。来源记录保持简单，不做新版本注册系统。建立 ExecPlan，并说明现有 DB 字段是否足够承载 Source 合同与 Choice 锚点。

**产出：** 公共依赖、薄加载入口/加载测试、基线报告、实际差异清单。

**退出条件：** AC-001—AC-003 通过；编制时缺口已映射到真实代码；公共合同可在 SACS 测试环境加载。不是只完成文档就结束整个 Goal。

## C01 — 1.2 客户端、配置与真实 Job 生命周期

**依赖：** C00。

修改现有 config、HTTP adapter、GroundingJob adapter 和必要请求/保存结构，支持精确 1.2/Profile 组合；使用公共 request/result/job/capabilities 校验器。

覆盖同步与异步 envelope；保存每个 Source 的合同选择；GET/cancel/恢复按保存的身份选客户端。区分请求哈希、公共 resultHash、findingSetHash、view hash。保留旧 1.0/1.1 行为，不自动降级。

复用轮询去重、身份检查和有界观察。将来源终态与本地观察超时/取消意图分开。检查当前取消错误被吞掉的后果，补充真实失败与完成竞争处理。区分可选可用性与必需能力，不把 Native deferred 当 Grounding 不可用。

**重点文件：** `packages/wsgs-http-adapter/`、`packages/wsgs-analysis-adapter/src/config.ts`、`grounding-job.ts`、既有 source 绑定与 world-grounding runtime。

**产出：** 实际 transport/config 变更、能力映射、身份保存、HTTP 合同测试和生命周期回归。

**退出条件：** AC-004—AC-010、AC-030—AC-033 通过；现有旧协议基本回归保持。

## C02 — 公共结果解码与统一视图

**依赖：** C01。

将公共五类 Finding、Choice、Gap 解码后投影到现有 WorldAnalysisView。保留并复用 geospatialFindings 消费；支持空世界集合和混合结果。删除/隔离将旧本地历史 schema 当线协议的路径，禁止 safePayload 形状猜测。

严格处理 TimeRange bounds、引用闭包、地图几何、FIRST/LAST 证明、采样完整性、排名中位值与代表观测值。保留来源哈希不被显示裁剪改写。区分 1 MiB wire 上限与较小 UI 预算，保存可供后续选择的完整合法源结果。

将确定性事实和限制语句放在投影层；语言模型可润色但不得补造数据。分别输出纯文本可理解的解释和结构化 UI 状态，不只返回一块原始 JSON。

**重点文件：** `packages/world-explanation-runtime/src/analysis-view.ts`、相关合同/投影模块、既有 AG-UI analysis projector。

**产出：** 字段映射、视图、文本及地图/时间轴测试。

**退出条件：** AC-011—AC-018、AC-034—AC-036 通过；官方排名例明确验证 -40 ≠ -42、-50 ≠ -45。

## C03 — 真实结构化选择与 Revision 闭环

**依赖：** C01、C02。

在 `createGroundingSourceAnalysisControl` 中实际实现 `submitProposal`、`resolveIntervention`，不再使用 unsupported 占位。优先复用现有命令 claim、mutation conflict、revision 与 source 记录。

统一请求构造：根据本用户/会话持久化的合法结果，生成 priorGroundings 锚点与 analysisSelections；原文、哈希、ID、协议和幂等策略保持一致。五类 Choice 均可通过公开类型回传；不依赖候选坐标或 Provider 参数。

实现有效期/上下文变化、点击或文本序数、冲突、重复命令、过期与重新查询。展示动作本地完成；新语义必须发新请求并产生新 Revision。旧 run 迟到结果不能覆盖新 Revision。新语义使旧派生行动目标失效。

**重点文件：** `packages/analysis-control-runtime/src/grounding-source-control.ts`、既有请求 planner、context assembler、structured selection resolver、analysis runtime 与持久化接口。

**产出：** 可调用的修改/选择控制路径、命令幂等和二轮请求测试、必要持久化改造。

**退出条件：** AC-019—AC-029 通过；从控制入口到真实 HTTP Adapter 的二轮请求含正式选择字段，而不是直接调用 start 的单元示意。

## C04 — 交互展示与非执行行动候选

**依赖：** C02、C03。

补齐候选列表、明确的选项身份、过期状态、重新查询入口及可理解的部分结果说明。利用本仓现有协议/视图或预览，不开发外部前端产品。

地图只使用公开几何；时间轴不压掉 Gap 或边界；文本与卡片指向同一 Finding。只在实际合同提供行动候选时显示非执行候选及三个待完成条件。普通 Top-K 不自动生成行动。

对“将第二个作为返回目标”这类语言保持 WSGS 分析语义，不回落到旧 SDAR_TASK 执行路径。用 spy 验证新链无 A2A/MCP/设备执行副作用；保留普通 SDAR 既有受控回归。

**产出：** AG-UI/视图交互载荷、可用的选择与重查流程、候选非执行回归。

**退出条件：** AC-034—AC-038 通过；文本和结构化选择均能驱动 C03，而不是只有静态卡片。

## C05 — 正常服务入口与共享组合验证

**依赖：** C01—C04。

复用 `apps/server/src/main.ts` 及 `v06-grounding-analysis.ts`，补齐 AG-UI START 的会话上下文，核对 RECONNECT 不重复创建请求。Chat、AG-UI、Analysis Control 不维护各自独立的协议实现。

在需要时提取最小共享组合工厂，供 main 与测试共用；用内存 repository 与受控 model port 替身注入，但保持真正 Grounding Job adapter。测试从正常路由/处理器进入，跨实际本地 HTTP 网络到 fixture；不要把 source mode 改成 FIXTURE。

验证分析关闭/部分能力不可用不影响普通 Chat/Reference。记录模型替身的测试边界，不宣称真实模型识别质量已验证。保存结果恢复测试可重建 runtime 并复用内存仓库；这种测试不等于真实数据库重启。

**产出：** 正常组合接线、无需 Docker 的本地 HTTP 测试脚本、源码启动文档更新。

**退出条件：** AC-039—AC-040 通过，且 C03 选择/修改场景在正常组合层真实重放。

## C06 — 针对性回归、证据与交付

**依赖：** C00—C05。

执行 `pnpm typecheck`、更新后的 v06 contract/unit 测试、无 Docker 的新增本地 HTTP 测试，以及受影响的原功能测试。按当前仓库 lint/format 工具检查本次改动；不要为通过目标测试放宽协议规则、删除失败用例或默认 skip。

新增命令可命名为 `test:v06:frozen-wsgs:contracts`、`test:v06:frozen-wsgs:unit`、`test:v06:frozen-wsgs:http`，但这些是建议交付名，不是声称当前已存在。可以复用旧名称，必须在最终文档给出实际命令。核心 suite 不串入 PostgreSQL Docker harness、真实上游或发布脚本。

用台账记录每个 REQUIRED 场景的测试定位、命令/退出码和结果。提供源码运行示例、配置说明、变更清单、实际未执行项、一个简短最终报告。git 提交/push/Draft PR 按仓库规则和权限执行；不自动 merge/tag/release，不修改其他仓库。

**退出条件：** 所有 REQUIRED 为 PASS；ENVIRONMENTAL/EXCLUDED 不参与核心通过率，明确 NOT_RUN/OUT_OF_SCOPE；可记录指定 DEV_READY 标志。任一 REQUIRED 未完成则 PARTIAL，并给出可直接续作的剩余事项。

## 测试构造注意事项

公共完整示例、Job envelope 和选择链路优先复用原包及 manifest。测试需要修改 requestId/时间/内容时，构造独立的派生测试夹具并按公共哈希规则重新计算，再用完整校验器验证；冻结原件不得修改，也不能仅因为 JSON shape 通过就使用破坏了哈希的响应。

过期测试使用可注入时钟；示例中的日期是人工固定值，不能用测试执行当日的墙上时钟使所有正例过期，然后关闭过期检查。修改日期也会影响相应语义/哈希，不应绕开正常验证。

本地 HTTP fixture 只模拟公开 wire 行为，不实现真实 GSAP 算法或 Provider DAG。它应捕获请求、校验正式字段、提供确定的同步/异步/错误状态，并记录收到的选择与重复命令。上游身份/范围校验不能被客户端哈希代替。
