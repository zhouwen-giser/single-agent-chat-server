# SACS Reference Notes

v0.1 已形成并应复用：

- exactly one configured SDAR；
- OpenAI-compatible model/chat routes；
- signed OpenWebUI identity；
- PostgreSQL thread/task binding；
- request idempotency / submission lease；
- isolated official A2A SDK adapter；
- sendMessageStream / sendMessage / getTask / cancelTask；
- bounded stream + nonterminal getTask observation；
- disconnect does not cancel；
- follow-up phase guard；
- normalized Task metadata/artifacts；
- Docker/CI/security/release evidence framework。

v0.2 是“结构化事件内核 + 第二北向协议 + query/interrupt 泛化”，不是重写 v0.1。
