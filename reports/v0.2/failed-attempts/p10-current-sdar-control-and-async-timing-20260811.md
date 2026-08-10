# P10 failed attempt: current SDAR control and asynchronous timing

- Date: 2026-08-11
- Gate: revise, input, pause, cancel, gap, and disconnect E2E
- Result: failed attempts retained

The first combined driver exposed several non-passing assumptions: a revised
literal lacked governed outcome refs; `provide_input` was followed by confirm
before the new plan reached confirmation; a two-second MCP call exceeded
SDAR's one-second pause-control wait; cancellation was attempted during that
in-flight call; the words `capability gap` were correctly routed as a local
query; and disconnect occurred before a Task binding was published.

The correction followed the exact locked SDAR pause E2E structure: one 300 ms
MCP node, a second MCP node, a 50 ms pause request, then resume. Revision now
returns formal MCP outcome refs. The driver polls the distinct post-input plan
phase, cancels the top-level Task while awaiting confirmation, uses an explicit
non-query gap marker, and aborts only after `Task queued` is observed. The
strict exact-SHA rerun passed all business assertions.
