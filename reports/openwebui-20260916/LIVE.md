# Open WebUI live deployment receipt

Date: 2026-09-16. Deployment source: `6061fc6f4ac2a75b6e440702dc05063583d4f94b`.
Scope: user-authorized anonymous shared Open WebUI on sz-gowm, connected to the
existing SACS. No shared upstream service modification or device action.

## Deployment identity

- UI: <http://17.26.1.20:18084>; version `0.11.3`.
- SACS connection: `http://17.26.1.20:18083/v1`; model `sdar-single-agent`.
- Official image: `ghcr.io/open-webui/open-webui@sha256:bb3633af77b35d97783affc9cd8097d8a6dc89fedd5a410ce9a50d85556a870c`.
- Project/container: `openwebui-sacs` / `openwebui-sacs-openwebui-1`.
- Only published port: `17.26.1.20:18084:8080`.
- Only data mount: `openwebui-sacs_data` at `/app/backend/data`.
- Deployment files: `/mnt/data/openwebui-sacs-live/deployment/`.
- Private configuration: `/mnt/data/openwebui-sacs-live/shared/settings.json`
  and `runtime.env`, both verified mode `0600`. No secrets reproduced here.

Deployment file SHA-256 (also copied to the server):

```text
33b17c7a8c12f86923ea291830c56632ceedac35197455c37acaa990207e3092  compose.yaml
8e3a60ab6cd5e77f5c8d1451ba7470464ff731afd3bd20972df6a2b022c640d5  deploy.py
b432e53c3b87728f24841903f20861557cf4abe3415f547ceea0fb14766981c5  README.md
```

## Executed checks

| Check                                 | Result                                                         |
| ------------------------------------- | -------------------------------------------------------------- |
| Official image load on sz-gowm        | Exit 0; immutable digest matched local official pull           |
| `deploy.py install --allow-anonymous` | Exit 0; READY / container healthy                              |
| Identical install repeated after chat | Exit 0; existing container Running then Healthy, no recreation |
| `deploy.py status`                    | Exit 0; healthy, exact development address binding             |
| GET `/health` and `/api/config`       | HTTP 200; configuration `auth=false`, version `0.11.3`         |
| Fresh browser access                  | PASS; no login, model selected as `sdar-single-agent`          |
| One browser ordinary-chat submission  | PASS; exactly one logged HTTP 200 POST `/api/chat/completions` |
| User input                            | `你好！请只用一句中文打招呼。`                                 |
| Visible final answer                  | `你好！很高兴见到你，祝你今天愉快！`                           |
| Browser reload                        | PASS; same user message and complete answer remained visible   |
| SDAR task bindings, before / after    | 0 / 0; no device task submitted                                |
| Existing container identity audit     | PASS; all 75 preexisting containers unchanged                  |

Container audit hashes the sorted tuples `(name, id, image, startedAt)` from
`docker inspect`, excluding this new Open WebUI project. Both before and after:
`63df6a2499346ab8405706a7fe6ea98c1d6e9164c169bf5717af01797dbb8664`.
Only the SACS-owned table `chat_service.conversation_task_binding` was counted;
no upstream database was accessed. Audit command exit code: 0.

Two slow remote image-pull clients were deliberately interrupted (exit 130).
The successful fallback streamed the same official image using `docker save |
gzip -1 | ssh sz-gowm 'docker load'` (exit 0), not a rebuilt or substitute image.

Local focused deployment tests: 2 PASS. Typecheck, format and secret scan passed.
GitHub CI for implementation `09be524`, run `35085142818`: quality and container
PASS. Later CORS/evidence commits have their own PR checks; those results must
be read from PR #24 rather than inferred from this earlier run.

## Boundaries and handoff

This is deployment and one real text-chat smoke acceptance, not full v0.6
analysis, RAG, voice, attachment, multi-user isolation or device execution
acceptance. Shared anonymous users can access the same chats and administrative
settings. Use only on the trusted development network; no production security
claim or firewall relaxation. Existing SACS action/confirmation rules remain.

Operator commands and connection headers are documented in
`deployment/openwebui/README.md`. The new UI and its data remain running for
the user; no shared service was rebuilt or restarted. The smoke conversation
is retained as a non-sensitive example.
