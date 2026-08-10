# P11 failed attempt: Interrupt authorization used the public thread ID

- Date: 2026-08-11
- Gate: real plan-confirmation Interrupt persistence
- Result: failed attempt retained

After the typed mapping was connected, the real official client received State,
Activity, Custom, and Text events, but the final boundary was a safe
`RUN_ERROR interaction_error` instead of an Interrupt. The public interaction
event correctly carried the external AG-UI `threadId`, while
`persistInputRequired` incorrectly used that value as the internal persistence
key and could not authorize the Task binding.

The persistence wrapper now accepts a separate internal thread ID from the
server-owned run context. Repository authorization and the durable Interrupt
row use that internal ID, while projected AG-UI events keep the external ID.
Both execution and recovery paths apply this boundary. A unit regression and
the later exact-SHA real run passed; this failed run remains failed evidence.
