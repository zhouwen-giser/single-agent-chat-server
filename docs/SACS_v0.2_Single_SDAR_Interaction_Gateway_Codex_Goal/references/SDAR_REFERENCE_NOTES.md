# SDAR Reference Notes

设计参考 v1.4.1 已确认：

- A2A SDK 1.0.0-beta.0；
- protocol 1.0 / spec patch 1.0.1 / HTTP+JSON；
- `/.well-known/agent-card.json` + `/a2a`；
- streaming；
- TaskService submit/get/followUp/cancel；
- Follow-up: confirm_plan/reject_plan/revise_plan/patch_goal/cancel_goal/provide_input/pause/resume；
- public Task projection可含 internalPhase/errorCode/capabilityGap/nextAction；
- v1.4 使用 Capability/A2A Exposure 驱动 public Agent Card。

执行时以当日 SDAR `origin/main` 为真值。
