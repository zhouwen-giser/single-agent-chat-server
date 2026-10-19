# v0.6 功能修复运行与验收指南

本指南对应本轮功能修复。源码开发、真实 WSGS 集成、发布资格和 Native/SDAR 条件扩展分别验收，当前状态以 [acceptance-matrix.json](../../../config/v0.6/functional-closure/acceptance-matrix.json) 和 [R07](R07.md) 为准。

## 工具与启动

使用 Node 22.14.x 和固定 pnpm 11.13.1。若终端中的 pnpm 指向其他运行时，先纠正 PATH/Corepack shim；`corepack pnpm` 的内部脚本仍会调用 PATH 上的 `pnpm`，不能只核对最外层命令。

```bash
corepack enable
corepack prepare pnpm@11.13.1 --activate
node --version
pnpm --version
pnpm install --frozen-lockfile
cp .env.example .env
```

根据部署环境填写数据库、模型网关、可信用户 JWT、独立 OpenAI/AG-UI 服务密钥及 SDAR 地址。SDAR 当前没有认证，须留在可信隔离网络。之后执行正常迁移、构建和启动：

```bash
pnpm migrate
pnpm build
pnpm start
```

两种 Compose 入口都传入 WSGS 设置。实际启用前需要当前公开 `sacs-wsgs-grounding/1.2` / `wsgs-world-analysis-findings/1.0` 能力和 required readiness；默认开关保持关闭。浏览器页面的开关、同源地址、认证及 HTTPS 设置见 [analysis-browser.md](../../../docs/deployment/analysis-browser.md)。本轮没有启动或更新共享部署。

## 观察与恢复

`/health` 表示进程存活，`/ready` 返回数据库、模型及已启用 WSGS 的分项结果。WSGS readiness 有短超时、缓存和去重，探针不创建 Grounding；依赖不可用时 `/ready` 返回 503，恢复后重新检查。

打开 `/analysis` 后，用可信签发的用户 JWT 换取短期会话。页面显示当前 Revision 的公开文字、几何、时间轴、证据、候选和来源 Activity。检查候选、移动地图和绘制范围均为本地操作；确认选择、范围提交和取消分别需要显式按钮。

断开观察保留最后视图，恢复观察请求完整 State/Activity。不要用重复 START 恢复正在运行的工作。`CANCEL_REQUESTED` 表示取消意图已保存；只有公开权威 `CANCELLED` 才表示源工作已取消。网络回复不确定时可显式同键重放原控制，不改写 command/key。

进程恢复使用生产 180 秒租约和 30 秒 tick，需计入启动、轮询和数据库恢复时间。checkpoint 连接池已处理空闲连接断库错误；正在执行的数据库请求仍可失败并留下恢复状态。隔离故障测试证明单服务持久化恢复，没有建立数据库 HA 或生产容量承诺。

## 可重复开发验收

```bash
pnpm exec playwright-core install --with-deps chromium
node scripts/verify-v06-functional.mjs development --list
pnpm verify:v06:development
pnpm check:v06:status
```

完整开发检查需要 Docker，启动专有 PostgreSQL 容器，并测试真实 Chromium/TCP/SSE 和 OS 子进程故障。耗时包含 180 秒租约等待。输入环境排除本机业务地址和凭据；证据默认写入 `.tmp/v06-functional-gate`，不能据这些本地 peer 结果声明真实 WSGS 成功。

## 真实用例与条件扩展

准备仓库外、权限 0600 的当前授权 JSON，用例格式见 [real-cases.example.json](../../../config/v0.6/functional-closure/real-cases.example.json)。示例故意不可直接执行。需要公开 WSGS origin、可解析主体/任务、有效历史正样本与真实歧义候选、预期 Finding 类型、提交预算和独立选择/范围/专有取消授权；高级输入可以分别提供。

```bash
pnpm build
SACS_FUNCTIONAL_REAL_CASES=/absolute/private/cases.json pnpm check:v06:real-inputs
SACS_FUNCTIONAL_REAL_CASES=/absolute/private/cases.json pnpm verify:v06:integration
pnpm verify:v06:release
```

`check:v06:real-inputs` 只做公开 GET 预检，INPUTS_READY 不等于用例通过。真实集成 Gate 还核对当前源码的逐项执行证据；高级类型、范围和真实 OS 恢复/取消 runner 的实际扩展仍待有效材料后完成。缺资料返回 2，错误返回 1；不替换输入重复查询、不补造引用、不取消共享任务。真实证据文件不能通过填写 PASS 字段代替公开结果和实际断言。

Native 接入先需要权威八文件 consumer bundle、哈希、公开端点与恢复语义。SDAR grounding 扩展先需要 schema、media type、Agent Card 和 handler/validator 消费证明。收到并验证合同后再组合生产适配器；历史行动候选自身一直没有执行授权。
