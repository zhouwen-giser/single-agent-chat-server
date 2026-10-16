# SACS v0.6 功能修复方案交付报告

R00 交付功能修复与验收方案。业务源码基线为 `30dd9814de93acf7e3e24311b8b477cdbcac16c2`，沿用 `codex/sacs-v0.6-wsgs-full-functional-integration`。本阶段只增加计划、基线和验收清单，并更新 README/PROJECT_STATUS 的当前入口。

## 交付范围

- [实施方案](../../../execplans/EP-06-sacs-v0.6-functional-closure.md)：R01–R07 的范围、前置条件、主要实现位置、测试和完成标准。
- [验收矩阵](../../../config/v0.6/functional-closure/acceptance-matrix.json)：34 个主线必需项目和四个条件扩展项目，全部为 `NOT_RUN`。
- [BASELINE.json](BASELINE.json)：业务基线、受影响文件/合同哈希和上一轮审查实测摘要。
- Native Analysis 的权威八项合同门槛和 SDAR grounding 的扩展合同门槛分别列为 N01/E01。

方案优先修复历史候选相关执行表达漏拦截、普通对话误路由和根目录 Compose 丢配置。浏览器展示、显式交互、独立进程恢复和真实高级历史验收分阶段完成，继续复用现有 adapter、持久化和参考客户端。

## 验证边界

本阶段检查 Markdown/JSON 格式、链接、阶段依赖、验收编号与轨道、全量未执行状态、基线/哈希和变更范围。具体命令与退出码保存在 [R00-validation.json](R00-validation.json)。没有为文档改动重跑之前通过的 629 项业务回归，也没有把上一轮实测重新标成 R00 的执行证据。

没有修改运行时代码、Compose 设置、迁移或冻结 WSGS 字节。没有提交真实业务查询、操作共享服务或设备，方案阶段不产生新的功能 PASS。

## Git 交付

使用语义提交 `docs(v0.6): plan functional repairs and acceptance closure`，正常 push 到现有分支，并更新 [Draft PR #25](https://github.com/zhouwen-giser/single-agent-chat-server/pull/25)。交付提交以 Git 历史为准；此报告的业务源码 SHA 与交付文档提交分别记录，避免将文档提交视作新功能实现。最终 merge 保持用户控制。
