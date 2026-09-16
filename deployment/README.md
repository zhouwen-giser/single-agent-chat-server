# SACS development deployment

This package exposes all existing SACS APIs with a **shared anonymous user**
when installed with its development defaults. Every reachable client can use
the same conversation identity and operate SDAR tasks. There is no tenant
isolation. Do not publish it to an untrusted network. SDAR safety/confirmation
and scope policies remain in force. This is not a device-execution acceptance.

## Build and install

From a clean committed source checkout with Node 22, pnpm and Docker:

```sh
pnpm package:development
```

Output: `.tmp/deployment/<version>-<commit>/sacs-development.tar.gz` and
its SHA-256 sidecar. The archive contains prebuilt SACS and PostgreSQL images;
no remote build, package registry or source checkout is needed. Only the
environment template is included, never real `.env`, private keys or tokens.

Copy both files to the server. Verify the outer SHA-256 before extracting:

```sh
sha256sum -c sacs-development.tar.gz.sha256
tar -xzf sacs-development.tar.gz
bash sacs-development/deploy.sh preflight
bash sacs-development/deploy.sh install
bash sacs-development/deploy.sh status
```

Requirements: Linux, Python 3.10+, Docker with Compose v2 or newer, sufficient disk,
and permission to operate Docker and `/mnt/data/sacs-live`. Port 18083 must
be free. Default listener is `17.26.1.20:18083`, not all host interfaces.
Options: `--root`, `--bind`, `--port`, `--model-container`. Do not change bind
or port between updates without reviewing exposure and client configuration.

The installer loads only this package's images and owns Compose project
`sacs-dev`. It reuses the WSGS/SDAR published API endpoints, never their
databases. Dedicated PostgreSQL has no published port. No upstream containers
are stopped, recreated, migrated or network-reconfigured.

On first install, model configuration is read locally from
`wsgs-dev-grounding-api-1` and only MODEL_BASE_URL/NAME/API_KEY are mapped.
Private configuration lives in `/mnt/data/sacs-live/shared/runtime.json`
(0600), with generated Compose env files also 0600. Update that JSON to change
configuration, then run install. Existing values and credentials are retained;
updates do not silently reimport or rotate them. The model must remain
reachable from the new container. All runtime defaults originate from the
included `.env.example` and are delivered through env_file (not a partial
inline Compose environment list).

`SACS_AUTH_MODE=authenticated` restores existing service-key and signed-user
requirements. Anonymous requires both `development-anonymous` and
`SACS_ALLOW_INSECURE_ANONYMOUS=true`. The shared role is always user; client
identity headers do not grant another identity or administrator rights.
Browser CORS stays denied unless exact origins are configured; command-line
clients do not need CORS. No Open WebUI frontend or public TLS is installed.

## APIs and safe examples

Health: `/health`, `/ready`. OpenAI-compatible: `/v1/models`,
`/v1/chat/completions`, `/v1/world-selections`. AG-UI: `/ag-ui` (explicit v0.3
profile when requesting analysis), `/ag-ui/capabilities`. Analysis:
`/api/v1/analysis-capabilities` and the following routes:

| Method | Path suffix under `/api/v1/analyses/:analysisId` | Purpose |
| --- | --- | --- |
| GET | (none) | Analysis session |
| GET | `/snapshot` | Durable AG-UI projection |
| POST | `/proposals` | Revision proposal / grounding source query |
| POST | `/cancel` | Explicit analysis cancellation |
| POST | `/interventions/:interventionId:resolve` | Published Choice resolution |

Control commands still require published revision identifiers, strict schemas
and idempotency keys. Grounding sources accept source queries, not native Plan
patches; `nativeReady=false` remains an explicit upstream capability boundary.
SDAR creation/follow-up/cancellation use the existing Chat/AG-UI interaction
contracts, not new direct management endpoints. Follow-ups still require the
allowed `sdar_action` and published Task context; no device safety bypass is added.
No request/response contract or upstream frozen bytes are changed.

```sh
curl -fsS http://17.26.1.20:18083/v1/models
curl -fsS http://17.26.1.20:18083/api/v1/analysis-capabilities
curl -N http://17.26.1.20:18083/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'X-OpenWebUI-Chat-Id: example-chat' \
  -H 'X-OpenWebUI-Message-Id: example-assistant-1' \
  -H 'X-OpenWebUI-User-Message-Id: example-user-1' \
  -d '{"model":"sdar-single-agent","stream":true,"messages":[{"role":"user","content":"你好，请只做普通对话，不创建任务。"}]}'
```

Use new message IDs for new turns; do not reuse IDs for conflicting requests.
For an operator-selected real task, replace the placeholder before making this
single read-only history request; do not reuse expired reference leases:

```sh
curl -N http://17.26.1.20:18083/ag-ui \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -H 'X-SACS-AG-UI-Profile: sacs-ag-ui-v0.3' \
  -d '{"threadId":"history-example-1","runId":"history-run-1","state":{},"messages":[{"id":"history-user-1","role":"user","content":"查询任务 <真实任务标识> 最近一次执行的历史轨迹，仅查询，不执行设备动作。"}],"tools":[],"context":[],"forwardedProps":{"mode":"START"}}'

# Use analysis.session.analysisId from the returned STATE_SNAPSHOT.
curl -fsS 'http://17.26.1.20:18083/api/v1/analyses/<analysisId>/snapshot'
```

Deployment preflight only inspects WSGS capabilities and SDAR Agent Card;
it submits no business tasks. Business acceptance is separate and must not
automatically repeat failed requests. PARTIAL/PROVISIONAL are not equivalent
to failure or complete acceptance without scenario-specific assertions.

## Updates, failure and rollback

Releases are retained under `releases/<content-manifest-digest>/`; `current`
changes only after readiness succeeds, with the preceding release in
`previous`. Upgrades back up only the dedicated SACS database. No `down -v`,
shared-data deletion or automatic database restore is performed.

```sh
bash /mnt/data/sacs-live/current/deploy.sh rollback
```

Rollback is application-only and requires the target migration checksums to
match both the current release and applied database schema exactly. Otherwise
it fails closed for explicit operator recovery. Old images/releases, backups,
and volumes are retained. Do not use this command to undo upstream services.
