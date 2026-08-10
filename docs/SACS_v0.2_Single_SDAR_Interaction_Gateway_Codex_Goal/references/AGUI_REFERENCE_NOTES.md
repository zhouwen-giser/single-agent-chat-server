# AG-UI Reference Notes

设计参考 `release/2026-08-07`：

```text
@ag-ui/core    0.0.57
@ag-ui/client  0.0.57
@ag-ui/encoder 0.0.57
@ag-ui/a2a     0.0.6
```

官方 `@ag-ui/a2a` README 明确标记 Experimental；参考版 package 依赖 `@a2a-js/sdk ^0.2.2`。
因此本任务默认只学习其转换策略，不让它替换 SACS 的 A2A 1.0 adapter。

官方参考展示了：

- A2A Message → AG-UI text；
- 只有显式 data tool-call/tool-result 才生成 Tool Events；
- 部分 UI surface data → Activity；
- 其他 A2A Task/事件可 Raw fallback。

SACS v0.2 比参考实现更严格：Raw 对外默认禁用。
执行时必须使用当前官方 types/client/encoder 重新验证接口和 Interrupt/Resume 结构。
