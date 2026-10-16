# Open WebUI for the shared SACS development service

User-approved anonymous mode: everyone who reaches the UI shares its account,
chats and administrative capability. SACS also retains its existing shared
identity. Do not expose either service to untrusted networks.

Official image `ghcr.io/open-webui/open-webui:v0.11.3-slim` is resolved to an
immutable digest on first installation. This does not change Open WebUI source,
SACS, WSGS, SDAR, or upstream databases. The independent Compose project is
`openwebui-sacs`; only `17.26.1.20:18084` is published. Its persistent data volume
is `openwebui-sacs_data`. No Docker socket, devices or upstream data are mounted.
Browser CORS is limited to the published UI origin, not wildcard access.

On sz-gowm, copy these files to `/mnt/data/openwebui-sacs-live/deployment/`, then:

```sh
docker pull ghcr.io/open-webui/open-webui:v0.11.3-slim
python3 /mnt/data/openwebui-sacs-live/deployment/deploy.py install --allow-anonymous
python3 /mnt/data/openwebui-sacs-live/deployment/deploy.py status
```

The generated settings/secret and runtime environment are kept under
`/mnt/data/openwebui-sacs-live/shared/`, mode 0600. Reinstall preserves the
secret, pinned image and data. Existing Open WebUI persistent settings are not
reset; edit a previously saved connection in its admin UI if needed.

Connection: `http://17.26.1.20:18083/v1`, model `sdar-single-agent`.
The connection includes all five SACS Chat/Message/parent/utility header
templates. User JWT forwarding is unnecessary for this explicitly anonymous
SACS instance. The API-key placeholder is not a secret or authentication grant.
The proxy waits up to 180 seconds for SACS's existing 120-second business budget.

Background title/tag/follow-up generation is disabled to avoid unsolicited
requests. The utility-task header remains configured. Extra WebUI web search,
code execution and image generation are disabled; this deployment validates
text chat through SACS, not WebUI RAG, attachments or direct device execution.
SACS's existing SDAR action and confirmation rules remain in force.

Official references:

- [Release v0.11.3](https://github.com/open-webui/open-webui/releases/tag/v0.11.3)
- [Docker and single-user mode](https://docs.openwebui.com/getting-started/quick-start/)
- [Environment and custom header configuration](https://docs.openwebui.com/reference/env-configuration/)
