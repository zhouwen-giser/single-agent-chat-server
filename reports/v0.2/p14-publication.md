# P14 publication

Status: `PR_READY_USER_MERGE_PENDING`

- Final product candidate: `80ed0bb5532a86feff2e2a374db9d7990301e7a7`
- P14 evidence commit: `b9269bcc613320d33671fd1055efefa2949c5b5d`
- Verified remote head after evidence push:
  `b9269bcc613320d33671fd1055efefa2949c5b5d`
- Local/remote equality after evidence push: `true`
- Evidence push CI: [run 31451495721](https://github.com/zhouwen-giser/single-agent-chat-server/actions/runs/31451495721), quality and container passed
- Pull request: [#11](https://github.com/zhouwen-giser/single-agent-chat-server/pull/11)
- Pull-request CI: [run 31451710922](https://github.com/zhouwen-giser/single-agent-chat-server/actions/runs/31451710922), quality and container passed
- Publication-index secret scan: `PASSED_418_TRACKED_FILES`
- Pull request state: `OPEN`, `READY_FOR_REVIEW`, `MERGEABLE`
- Base/head: `main` <- `feature/single-sdar-chat-entry-v0.1`

Latest main `6a159aa87883568c96f7190c211150843a4d8ad4` is an ancestor of the
feature candidate, satisfying AC-21. AC-22 remains pending because the final
candidate cannot be an ancestor of `origin/main` until the user merges the
protected PR. Codex did not merge the PR and did not create a tag, GitHub
Release, deployment, or SDAR upstream change.
