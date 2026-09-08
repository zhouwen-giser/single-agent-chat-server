# SACS v0.6：冻结 WSGS 协议消费者 — Codex Goal 任务包

任务编号：`SACS-V06-FROZEN-WSGS-CONSUMER`  
任务包版本：`1.0.0`  
编制日期：2026-09-07（Asia/Tokyo）  
交付性质：**开发实施任务，不是实现完成报告，不是发布资格证明。**

## 单一目标

只修改 `zhouwen-giser/single-agent-chat-server`，复用现有 v0.6 实现，把 SACS 完整收敛为冻结 WSGS v0.2.4 公共协议的消费者：请求 → Job 观察 → 公共合同校验 → 文本/地图/时间轴 → 结构化选择 → 新一轮分析。

本包要求 Codex 实际补齐代码与测试，而不是只交付设计、接口占位或计划。新历史行动候选链路只到非执行性候选，不调用 SDAR、MCP 或设备。

## 使用方式

将本目录放在 SACS 工作区可读取的位置。在 Codex 打开 SACS 仓库，将 `CODEX_GOAL_PROMPT_CN.md` 全文作为 Goal 输入。Codex 先读仓库当前 `AGENTS.md`，再按本包执行 C00—C06。

| 文件 | 用途 |
|---|---|
| [CODEX_GOAL_PROMPT_CN.md](CODEX_GOAL_PROMPT_CN.md) | 可直接粘贴的 Goal 指令 |
| [GOAL_SPEC_CN.md](GOAL_SPEC_CN.md) | 目标、范围、冻结协议与功能要求 |
| [IMPLEMENTATION_PLAN_CN.md](IMPLEMENTATION_PLAN_CN.md) | C00—C06 实施步骤、依赖与阶段退出条件 |
| [ACCEPTANCE_MATRIX_CN.md](ACCEPTANCE_MATRIX_CN.md) | 可转成 Jest 测试的验收场景 |
| [SOURCE_REVIEW_CN.md](SOURCE_REVIEW_CN.md) | 已读源码中的现状、具体缺口和待查项 |
| [SOURCE_RUN_GUIDE_CN.md](SOURCE_RUN_GUIDE_CN.md) | 源码启动、离线合同验证和本地 HTTP 验证边界 |
| [source-baseline.json](source-baseline.json) | 来源分支、提交、冻结身份；不是部署 HEAD 门禁 |
| [task-manifest.json](task-manifest.json) | 机器可读范围与任务状态 |
| [acceptance/ledger.template.json](acceptance/ledger.template.json) | 初始全部 NOT_RUN 的证据台账 |
| [reports/](reports/) | ExecPlan、阶段报告、最终报告与 PR 模板 |
| [reference/SOURCES.md](reference/SOURCES.md) | 本次核对的源码与公共合同定位 |

## 四项明确排除

1. 不修改 WSGS、GOWM、GSAP、GDPS、SDAR、SMPP 或外部 UI 仓库。
2. 不启动真实上游/设备做跨仓库联调；不创建新的 SDAR/UGV 执行链。
3. 不引入 Native Analysis、生产发布门禁、部署编排、容器资格、压测或高可用项目。
4. 不要求先运行发布构建。按源码与现有测试工具运行；`pnpm build` 不是本包完成前置条件。

保留既有普通 Chat、Reference、地理查询和普通 SDAR A2A 功能，但本包只使用受控替身验证旧 A2A 路径，不调用真实 SDAR。

## 两个重要说明

**本 ZIP 不包含整份 WSGS 冻结消费者代码。** C00 从已核实的 WSGS 来源提交读取完整交接目录，验证后仅把需要的公共协议依赖导入 SACS。这样不把本包中的人工说明或节选误当成另一份权威 Schema。

**正常入口不等于无数据库部署。** 必需的 L0/L1 测试使用真实 SACS 组合工厂和真实 Grounding Job HTTP Adapter，可向既有持久化接口注入内存替身；这证明消费者功能，不证明真实 PostgreSQL 重启恢复。实际源码服务的数据库和模型配置需求仍按仓库现状保留，不为通过测试偷偷切换到内存生产模式。

## 完成标志

所有 REQUIRED 场景真实通过、正常组合路径已覆盖、报告完整后，才可记录：

`SACS_WSGS_FROZEN_WORLD_ANALYSIS_CONSUMER_DEV_READY`

该标志仅表示冻结协议消费者的开发就绪；不表示真实 WSGS、真实模型、数据库恢复、设备闭环或正式发布验收通过。
