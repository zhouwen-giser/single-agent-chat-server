# SACS v0.6 功能修复开发交付

截至 2026-10-14（Asia/Shanghai），R01–R05 功能修复和 R07 开发验收已完成，24 项开发行 PASS。当前决定为 `SACS_V06_FUNCTIONAL_DEVELOPMENT_READY`。真实 WSGS、发布资格和条件扩展仍待完成，整体主线没有标为全部功能完成。

| 验收范围               | 当前结果              | 剩余工作                                         |
| ---------------------- | --------------------- | ------------------------------------------------ |
| DEVELOPMENT            | 24/24 PASS            | 本轮开发交付已收口                               |
| REAL_WSGS              | 9 项 BLOCKED_EXTERNAL | 当前授权真实输入、逐项高级 runner 扩展及执行证据 |
| RELEASE                | 1 项 BLOCKED_EXTERNAL | 真实联调、模型意图、预声明容量/恢复目标资格      |
| Native / SDAR 条件扩展 | 4 项 BLOCKED_EXTERNAL | 权威公开合同、实际可用实现与真实消费             |

逐项标准与证据见 [acceptance-matrix.json](../../../config/v0.6/functional-closure/acceptance-matrix.json)。旧阶段报告保持原状，历史 PASS 保留其原范围。

## 已修复与交付

- 修复世界续聊误路由，并在 SDAR mutation 前核对当前授权来源。历史候选、指代和模型分类不能自行形成执行授权，普通聊天、已有 Task 状态和明确独立任务保持可用。
- 接通根目录及部署 Compose 的 WSGS 设置，提供有界、缓存和去重的公开 readiness 检查。关闭、依赖故障、合同不匹配和恢复都有独立结果。
- 交付 `/analysis` 同源认证参考页面，展示公开几何、时间轴、证据和非执行候选，接通显式 Choice、范围草稿、同键重放、取消和观察恢复。页面操作由 Chromium/TCP/SSE/PostgreSQL 验证。
- 实际断库测试复现并修复 checkpoint 连接池未处理错误导致进程退出。八个 OS 故障场景覆盖发送/绑定边界、RUNNING SIGKILL、双实例竞争、旧来源迟到、取消回执丢失和终态投影恢复。
- 交付 v0.6 开发/集成/发布检查入口、镜像、SBOM 和 [运行指南](SOURCE_RUN.md)。常规集成测试缺页面资源的 CI 问题已修复，保留失败记录和修复后证据。

## 当前源码资格

源码候选为 `e4a26ec3d268b5cc055a9a33b4393c3fecac0f86`，runnable-source manifest 为 `sha256:61905dd3158c56256e495fa3a45f3a141caf256434f0518ace5a88232b5892e9`。报告收口只改文档、证据和台账，源码资格按该 manifest 绑定。

[GitHub CI 38439667536](https://github.com/zhouwen-giser/single-agent-chat-server/actions/runs/38439667536) 的 quality、functional-v06 和 container 全部成功。[下载核对记录](R07-ci/e4a26ec/CI.json) 确认 PR 合并 checkout 与本地候选的源码 manifest 一致，十五项实际命令均 exit 0，全部日志字节哈希验证通过。

完整功能检查包括 684 项冻结回归/50 suites、12 项浏览器/身份检查、4 项 Chromium/PostgreSQL 控制场景、1 批八个 OS 故障场景、checkpoint 断库读回、34 项 PostgreSQL 回归和 9 项真实用例输入门禁单元检查（使用本地合同样例）。格式、lint、类型、架构、迁移、许可、secret 和 build 同时通过。常规 quality 另覆盖单元、合同、数据库、API、安全及 E2E。各批次有重叠，没有相加成独立总用例数。

进程验收使用生产 180 秒租约和 30 秒 tick。八场景批次约 224 秒，包含启动清理的整个命令约 244 秒；该批次时间不是单项恢复 SLA。实际数据库 HA、生产容量及真实模型/Provider/device 资格单独保留待验收。

当前本地镜像为 `single-agent-chat-server:sacs-functional-e4a26ec`，image ID `sha256:b79f60464a6ecf59bad7d1d87bb4b137467aee0914035df2cf3bbbe62000fa51`，OCI revision 精确绑定源码候选。实际运行确认 Node 22.14.0、non-root、healthcheck、完整 UI bundle 和零 Node builtin。CycloneDX 1.7 SBOM 含 3720 components，记录冻结 A2A SDK；文件与 SHA 见 [候选清单](R07-candidate/e4a26ec/MANIFEST.json)。hosted SBOM 的身份另见 CI 记录。

## 后续所需材料

R06 本轮真实业务提交为零。需要当前有效、权限 0600 的仓库外私有用例文件：WSGS origin、可解析主体/任务、历史正样本、真实歧义 Choice、各高级 Finding/空间范围的输入及预期、声明的提交预算和专有取消授权。输入门禁已交付；高级真实 runner 扩展与执行仍待这些材料后完成。格式与预检命令见 [运行指南](SOURCE_RUN.md) 和 [R06](R06.md)。

Native 接入需要八项权威公开 consumer artifacts、哈希、来源、端点和恢复语义。SDAR grounding 扩展需要当前 schema、Data Part media type、Agent Card、handler/validator 与消费实现证明。发布还需真实模型网关和预声明容量/恢复目标。缺失项没有用空结果、能力广告或本地 peer 代替。

所有阶段均已正常提交并 push，更新 [Draft PR #25](https://github.com/zhouwen-giser/single-agent-chat-server/pull/25)。最终 merge 和共享服务部署保持用户控制。
