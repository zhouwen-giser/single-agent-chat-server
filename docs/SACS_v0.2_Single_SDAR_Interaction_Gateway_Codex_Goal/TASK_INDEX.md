# Task Index

| Phase | 内容                                     | 必须 Push | Release blocker                   |
| ----- | ---------------------------------------- | --------: | --------------------------------- |
| P00   | Waiting Gate、执行基线、来源锁、创建分支 |         ✓ | Phase13 merged main + main verify |
| P01   | 双协议合同、官方来源审计、ADR            |         ✓ | exact AG-UI/A2A pins              |
| P02   | Unified Interaction Event Spine          |         ✓ | OpenAI 行为不回退                 |
| P03   | Principal/Thread/Binding 协议无关持久化  |         ✓ | v0.1 upgrade migration            |
| P04   | Query Service + Task Authorization       |         ✓ | 不允许任意 taskId                 |
| P05   | AG-UI HTTP/SSE Endpoint                  |         ✓ | official type/encoder contract    |
| P06   | A2A→State/Activity/Artifact              |         ✓ | snapshot/delta/order              |
| P07   | Interrupt / Resume                       |         ✓ | plan/input/paused                 |
| P08   | Run 幂等、断线、恢复、长任务             |         ✓ | disconnect ≠ cancel               |
| P09   | Security/Privacy/Rate/CORS               |         ✓ | adversarial pass                  |
| P10   | OpenAI/OpenWebUI Regression              |         ✓ | v0.1 real scenarios pass          |
| P11   | Official AG-UI Client Real E2E           |         ✓ | real client                       |
| P12   | Current SDAR Real E2E                    |         ✓ | exact current SDAR                |
| P13   | Docker/Ops/SBOM/Release Candidate        |         ✓ | full zero-skip gate               |
| P14   | latest main sync、PR、Protected Merge    |  PR/Merge | post-merge proof                  |
