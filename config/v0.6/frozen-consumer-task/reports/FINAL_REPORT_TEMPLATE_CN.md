# SACS 冻结 WSGS 消费者最终报告

> 模板初始状态：NOT_STARTED。不得把本文件直接作为完成证明。

## 结论

填写 DEV_READY / PARTIAL / BLOCKED。仅在全部 REQUIRED 真实通过后使用指定就绪标志。

## 实际变更

概括公共依赖、1.2 HTTP 消费、正常入口、选择/Revision、投影和相关持久化变化。列出修改文件或提交范围。

## 公共合同来源

填写仓库、交接提交、冻结提交、Header 二元组、实际锁校验结果。说明没有修改冻结合同和上游仓库。

## 验收台账

REQUIRED 通过数：待记录 / 40。

列出台账路径、完整命令/退出码、关键测试用例和证据目录。不要借用 WSGS 自报数量作为本仓成绩。

## 功能闭环证据

给出正常 Chat/AG-UI/Analysis Control 两轮交互的请求/结果标识关系、选择 body 中的锚点、Revision 变化和取消场景。测试数据必须明确为人工 fixture。

## 执行隔离与兼容

说明新历史候选链的零 A2A/MCP/设备调用断言；旧普通 Chat/Reference/地理/SDAR 受控回归结果。

## 源码运行

给出实际可用命令与所需配置；不要求先发布构建。区分无 Docker 的共享组合 HTTP 测试与有真实数据库配置的普通源码服务。

## 未执行项目

逐项填写：真实 PostgreSQL 恢复、真实模型、真实 WSGS/Provider 联调、真实 SDAR/设备、生产/发布。无证据即 NOT_RUN/OUT_OF_SCOPE，不能省略。

## 交付与剩余工作

填写分支、实际提交、实际 Draft PR 或未创建原因。禁止自动合并、tag、release。若 PARTIAL，按场景 ID 给出精确可续作清单。
