# P12 failed attempts: Open WebUI bootstrap and browser runtime

- Date: 2026-08-11
- Gate: real pip Open WebUI 0.10.2 northbound path
- Result: failed attempts retained

The fresh isolated Open WebUI process initially exceeded the health timeout.
After it became healthy, model discovery returned 401 because the SACS process
had been started with the wrong service-key environment. A controlled SACS
restart fixed that wiring. Identity forwarding then required an explicit
Open WebUI restart after configuration, and utility isolation initially failed
because `X-OpenWebUI-Task` had not been added through the official configuration
API. The final real HTTP run passed with all required forwarding headers.

Two attempts to start the in-app browser runtime failed in the Windows sandbox
helper. No screenshot or interactive-browser pass is claimed. This limitation
did not replace the real installed Open WebUI service: its authenticated API,
model discovery, chat requests, header templating, and user isolation were
exercised over HTTP in the later passing gate.
