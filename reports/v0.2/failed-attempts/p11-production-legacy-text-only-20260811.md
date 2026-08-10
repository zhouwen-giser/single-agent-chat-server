# P11 failed attempt: production AG-UI path emitted only legacy text

- Date: 2026-08-11
- Gate: official `HttpAgent` real POST/SSE event profile
- Result: failed attempt retained

The first real official-client probe reached the built SACS service and real
SDAR, but received only Run and Text events. No State, Activity, Custom, or
Interrupt event was present. The pure A2A mapper and AG-UI projection tests were
passing, so this was a production integration failure rather than an SDK or
fixture failure.

Inspection showed that `createSdarAgUiInteractionSource` converted coordinator
strings through the legacy text bridge and never consumed the existing typed
A2A mapper. The production path now observes only persistence-accepted
normalized A2A values, maps them to the shared interaction contract, suppresses
duplicate legacy fragments, and preserves local fallback text. The failed probe
is not counted as passing evidence.
