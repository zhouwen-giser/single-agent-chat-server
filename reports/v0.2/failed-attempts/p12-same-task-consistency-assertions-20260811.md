# P12 failed attempts: same-Task protocol consistency assertions

- Date: 2026-08-11
- Gate: OpenAI and AG-UI views of one real SDAR interaction
- Result: failed attempts retained

The first consistency assertion required terminal state only from an AG-UI
State event, while the authorized read-only status path may publish the same
approved state as bounded Text. A second assertion expected the OpenAI renderer
to expose the internal Task ID in every text response, which is not part of the
public OpenAI contract.

The final gate accepts the approved State or published Text terminal shape and
anchors protocol consistency to persisted Task-scoped interaction events,
normalized adapter `getTask()`, context identity, history, and artifacts. It
therefore checks shared authority without expanding either public renderer.
The exact implementation run passed; both earlier assertions remain failed.
