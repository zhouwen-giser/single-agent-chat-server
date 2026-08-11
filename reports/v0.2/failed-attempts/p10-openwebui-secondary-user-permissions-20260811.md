# P10 failed attempt: secondary Open WebUI user permissions

- Date: 2026-08-11
- Gate: two-user isolation through real Open WebUI
- Result: failed as observed

Public signup was disabled after bootstrap, and an administrator-created plain
`user` lacked permission to use the configured OpenAI connection. The verifier
used Open WebUI's official administrator `auths/add` route to create a second
independent administrator identity. Its different signed subject reached SACS
and had zero Task bindings for the first user's chat.
