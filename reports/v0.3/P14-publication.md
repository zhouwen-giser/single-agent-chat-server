# P14 publication receipt policy

The exact final-head receipt is published on
[PR #14](https://github.com/zhouwen-giser/single-agent-chat-server/pull/14)
with title **P14 exact-head publication receipt**. It is produced after the
containing commit passes the full gate and both CI workflows, then rechecked
against the actual Ready state. It contains the final SHA and sanitized JSON;
this committed document deliberately does not invent its own future SHA or CI.

Required fields: final local/remote/PR SHA; base SHA and ancestry; Push and PR CI
URLs and conclusions; real evidence hashes and timestamps; log and SBOM hashes;
zero required skips; actual `isDraft=false`; no merge/tag/release/deployment.

Prior-head qualification: `9cb0db0`, full gate exit 0. P13 evidence publication:
`838c9e7`, Push CI `32925165630` and PR CI `32925168899`, both successful.
The final candidate must still be fully tested after its commit.
