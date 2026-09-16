# S03 full CI follow-up

Run [35108993995](https://github.com/zhouwen-giser/single-agent-chat-server/actions/runs/35108993995) on `87eeee8a8045863cd71b17ce9d608e9787aad271` failed in the older v0.5 HTTP/PostgreSQL E2E assertion DEV-E2E-03. The S03 scoped receipt remains valid for its listed commands, but is not full CI success.

The old assertion expected a local pin in `mapPresentation.shared`. S03 deliberately separated authoritative `shared` from locally composed `rendered`, as required by the new task. The regression now asserts that the pin is rendered, while both the client shared scene and the persisted server scene are unchanged. Existing assertions still require unchanged Revision, command/proposal audit counts and upstream counters; no gate was removed.

Command: `SACS_V05_POSTGRES_IMAGE=postgres:17.10-alpine3.23 pnpm test:v05:local-e2e`; exit 0; 8/8 tests passed against an ephemeral isolated PostgreSQL container. This is a targeted fix, not a claim that the subsequent full CI has passed. Full CI must be rerun for the new source.
