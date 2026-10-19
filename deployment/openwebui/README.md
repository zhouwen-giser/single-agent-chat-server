# Open WebUI connected to SACS

The independent `openwebui-sacs` Compose project publishes
`http://17.26.1.20:18084`. Login is enabled and self-registration is disabled by
default. A new installation bootstraps `admin@sacs.local` with a random password
in `/mnt/data/openwebui-sacs-live/shared/admin-credentials.json` (mode 0600).
Existing users keep their passwords; the official bootstrap only creates the
admin when there are no users. If a password is changed in the UI, the bootstrap
file is no longer its current password.

The official `ghcr.io/open-webui/open-webui:v0.11.3-slim` image resolves to an
immutable digest on first installation. Reinstall preserves the digest, signing
secret, bootstrap credentials and `openwebui-sacs_data` volume. The installer
uses the already pulled image. It does not reset persistent UI settings.

The UI reaches `http://sacs-dev-server-1:3000/v1` through the existing external
Docker network `sacs-dev_outbound`, and selects `sdar-single-agent`. The SACS
container must already be running on that network. Its host port can remain
bound to loopback. Open WebUI does not join the PostgreSQL, WSGS or SDAR networks
and mounts only its own data volume. No Docker socket or device is mounted.

On sz-gowm, copy these files to `/mnt/data/openwebui-sacs-live/deployment/`, then:

```sh
docker pull ghcr.io/open-webui/open-webui:v0.11.3-slim
python3 /mnt/data/openwebui-sacs-live/deployment/deploy.py install
python3 /mnt/data/openwebui-sacs-live/deployment/deploy.py status
```

On reinstall, pull the digest from `shared/settings.json` if it is absent
locally; keep that private file out of version control. Settings, the runtime
environment and credentials live under `shared/`, with mode 0600. The root and
shared directories use mode 0700. `install --allow-anonymous` explicitly selects
the previous shared anonymous UI mode for a trusted development network; omit
that flag for the published login-enabled entrance.

The connection includes all five SACS Chat/Message/parent/utility header
templates. This SACS instance retains its existing shared anonymous development
identity. WebUI login controls entrance access; it does not introduce SACS user
isolation. JWT forwarding is disabled. The API-key placeholder is not a secret
or an authentication grant. The proxy timeout is 180 seconds for SACS's existing
120-second business budget.

Background title, tag and follow-up generation is disabled. The utility-task
header remains configured. Extra WebUI web search, code execution and image
generation are disabled. This entrance serves text chat through SACS; the
existing SDAR action and confirmation rules still apply.

The IP endpoint is reachable on networks with a route to this machine. Internet
DNS, HTTPS and router forwarding require an existing external domain/ingress;
the installer does not provision those resources. CORS is limited to the
published origin.

Official references:

- [Release v0.11.3](https://github.com/open-webui/open-webui/releases/tag/v0.11.3)
- [Docker installation](https://docs.openwebui.com/getting-started/quick-start/)
- [Bootstrap, environment and custom headers](https://docs.openwebui.com/reference/env-configuration/)
