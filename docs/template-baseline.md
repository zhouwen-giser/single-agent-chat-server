# Maintained LangGraph.js template baseline

Phase 0 selected the official minimal JavaScript template referenced by current
LangChain documentation and the `create-langgraph` CLI.

| Item                | Frozen value                                        |
| ------------------- | --------------------------------------------------- |
| CLI                 | `create-langgraph@1.1.5`                            |
| CLI repository      | `langchain-ai/langgraphjs`, `libs/create-langgraph` |
| Template ID         | `new-langgraph-project-js`                          |
| Template repository | `langchain-ai/new-langgraphjs-project`              |
| Template commit     | `4e5f3cd20895663f43d77b91074fbab9d7d05476`          |
| Local runtime       | Node `22.14.0`, pnpm `11.13.1`                      |

The official scaffold was downloaded unchanged and passed its unit test,
TypeScript build, ESLint, and `langgraph.json` path/export check. The production
repository retained its `StateGraph`, TypeScript, `langgraph.json`, and Studio
debugging shape while changing package management to pinned pnpm and licensing
to Apache-2.0.

The Phase 0 graph is a deterministic placeholder. It does not call an LLM,
SDAR, a management API, a database, or MCP. The OpenAI-compatible server begins
in Phase 1, and product graph routing begins in Phase 2.
