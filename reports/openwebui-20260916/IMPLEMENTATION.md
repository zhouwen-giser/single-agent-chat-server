# Open WebUI deployment for SACS

User explicitly requested sz-gowm deployment and selected anonymous shared
access on development port 18084. Existing SACS endpoint remains 18083;
no SACS application change or upstream redeployment is part of this task.

Preflight: no existing Open WebUI container/deployment; 18084 bind check passed;
/mnt/data has over 7 TiB free and memory available exceeds 120 GiB. Existing
container identity digest and SDAR binding count captured before deployment.

Official release API identified v0.11.3, source
2a960a59fe1dbbd35282f0556b3666d81102e781. The pinned source was inspected for
OPENAI_API_CONFIGS, custom message headers and client timeouts. The image is
official v0.11.3-slim, resolved to an immutable digest at first install.

Independent openwebui-sacs Compose project, persistent UI-only data volume,
0600 runtime secret/config files and explicit anonymous acknowledgement.
Browser CORS is explicitly restricted to the UI's published origin.
OpenAI connection points only to SACS /v1 and includes all five existing
Chat/Message/parent/utility headers. Background generation and unrelated web,
code/image features are disabled. SACS's 120-second budget is unchanged;
Open WebUI proxy timeout is 180 seconds to accommodate it.

Local deployment regressions: 2 PASS, secret scan PASS. Live deployment and
browser conversation evidence will be recorded separately. This is not
production authentication, user isolation or device-execution acceptance.
