# Codex Goal：完整实现 SACS 冻结 WSGS 公共协议消费者

你正在 `zhouwen-giser/single-agent-chat-server` 仓库工作。读取当前仓库 `AGENTS.md`，随后完整读取本任务包的 `README_CN.md`、`GOAL_SPEC_CN.md`、`SOURCE_REVIEW_CN.md`、`IMPLEMENTATION_PLAN_CN.md`、`ACCEPTANCE_MATRIX_CN.md`、`SOURCE_RUN_GUIDE_CN.md` 与 `source-baseline.json`。

## Goal

在现有 v0.6 实现上，实际完成 WSGS 冻结公共协议消费者闭环：

用户输入 → 同一会话的请求规划 → Grounding Job HTTP 提交/观察/取消 → 公共 Schema 与语义校验 → 统一文本、地图、时间轴和候选展示 → 用户结构化选择或条件修改 → 新请求与新 Revision → 可追溯的新结果。

只修改 SACS 一个仓库。WSGS 只读，合同不改。不要停在分析报告、任务清单、接口桩或“等待联调”。

## 已核实来源

- SACS 已读基线：`7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2`，分支 `codex/sacs-v0.6-wsgs-full-functional-integration`。
- WSGS 交接目录来源：`75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5`。
- WSGS 公共合同冻结提交：`e05e6d4d5ac8de617857edc8e81b935e5efc7daf`；这是来源信息，不是要求部署 HEAD 等于它。
- 交接根目录：`contracts/consumers/sacs-world-analysis-v1/`；公共协议在 `public/`；完整交接根目录的离线验证入口为 `node verify.mjs`。
- 精确协商：`WSGS-Contract-Version: sacs-wsgs-grounding/1.2` 与 `WSGS-Result-Profile: wsgs-world-analysis-findings/1.0`。
- wire `schemaVersion` 仍为 `"1.0"`。

先确认当前工作区是否已包含上述 v0.6 工作。若当前分支已有等价或更新实现，复用它，不回退到旧提交；有未提交用户改动时保留并隔离自己的工作。建议分支 `codex/sacs-v0.6-wsgs-frozen-world-analysis-consumer`；不要重做 v0.4/v0.5，也不要强推、自动合并或发布。

## 优先修复的真实缺口

1. `packages/wsgs-analysis-adapter/src/config.ts` 仍锁定 `1.1` 与旧地理 Profile；`grounding-job.ts` 也只接收 `1.1`。
2. `packages/analysis-control-runtime/src/grounding-source-control.ts` 的 `submitProposal`、`resolveIntervention` 仍指向返回 `GROUNDING_SOURCE_REVISION_NOT_READY` 的占位实现。
3. `apps/server/src/v06-grounding-analysis.ts` 的 AG-UI START 直接构造空的 `priorGroundings` 等上下文，需要与正常会话请求规划和选择回传接通。
4. `apps/server/src/main.ts` 已接入 `createV06GroundingAnalysis`。复用并补齐此组合，不另建一个只有测试能用的新入口。
5. 已有历史展示模型不等同于新公共合同。必须在公共校验成功后做字段映射，不再靠 safePayload 形状猜 Finding。

这些是已读基线中的事实；当前代码已修复的部分，提供证据后复用，不重复改造。

## 必须实现

- 完整导入并验证冻结公共包；使用其类型、Schema 闭包、校验器、语义和示例，不手写近似协议，不引用 Provider 私有代码。
- Capabilities、POST、GET、Cancel 使用一致的协商身份；已有记录按保存的身份恢复，禁止自动降级或把旧结果重投影成新协议。
- 消费五类公共 Finding、五类 Choice、Typed Gap，并与已有 geospatialFindings 共存。
- `analysisSelections` 严格使用 `priorGroundingId / priorResultHash / findingSetHash / choiceId / candidateId`，匹配 priorGroundings 锚点。参考产品 ID 与分析候选 ID 不混用。
- 在真实控制服务中补齐条件修改与选择解决；正确处理幂等、Choice 有效期、重复点击、上下文切换、旧 Revision 迟到事件、终态与取消竞争。
- 文本、地图、时间轴来自同一经过验证的结果；区分排名中位值与代表样本值，不跨 Gap 连线、不把 H3 中心当访问位置、不重算 FIRST/LAST 确认性。
- 新历史行动候选保持 `executionAuthorized=false`，三个后续要求均为 true；本次不转成 SDAR/MCP/设备调用。
- 正常 Chat、AG-UI 与 Analysis Control 复用同一消费者链路。禁止只让独立 Fixture App 通过。

## 执行方式

按 C00—C06 连续实施。创建并持续更新一个 ExecPlan；每阶段实现、测试、简短报告和语义提交。Git 推送/Draft PR 按仓库规则与现有权限执行；无法推送时保留本地提交和 PR 文案，如实记录，不伪称已创建。不要因旧任务文档中的 Native、跨仓库 REAL 或发布要求而扩展本包。

按源码运行，不以发布构建、Docker 或真实上游作为前置。复用 pnpm/Jest；建立无 Docker 的本地 HTTP 场景，使用真正的 Grounding Job Adapter 对接本地 WSGS wire fixture，不能将 SACS 业务 Adapter 改成 FIXTURE 来替代验证。测试替身只能位于持久化、模型、网络对端等明确边界；生产组合和测试组合共享实际实现。

保留已有范围/身份检查和协议校验，但不建设新的认证、版本注册平台、消息队列或通用多版本转换系统。数据库迁移只有在现有持久化确实无法保存必要信息时才新增；修改数据库代码就补测试，缺少真实数据库时明确记录持久化环境验证 NOT_RUN，不称恢复已经通过。

完成全部 REQUIRED 场景后，输出变更文件、命令及退出码、测试定位、实际结果、未执行项、源码启动说明与最终报告。模板初始状态全部 NOT_RUN；不得用计划、手写 PASS、伪造日志或上游测试报告代替 SACS 证据。

真实 WSGS/GSAP/GOWM、真实模型、真实数据库恢复、SDAR/UGV、生产部署与正式发布均不在本包验收范围。不要主动发起这些调用。存在阻塞时继续完成不依赖它的任务，交付 PARTIAL 和精确剩余项；不要虚构合同或将 REQUIRED 的 NOT_RUN 计入 DEV_READY。
