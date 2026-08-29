# S11 lifecycle, partial and replay E2E — BLOCKED

The production hybrid comparison path now consumes the official normalized A2A Task snapshot across INPUT_REQUIRED, WORKING, COMPLETED, FAILED and CANCELED states. It compiles only published structured predicates and deterministic correlation hints, assembles those inputs through ConversationWorldFocus, requests the six required WSGS product classes, evaluates the typed results, persists the immutable fusion record, and renders a bounded conversational result.

Focused tests cover completed positive evidence, completed false evidence, WORKING false without premature violation, FAILED without causal inference, CANCELED without mutation, NO_DATA, partial per-check degradation, optional gaps, ambiguous Task selection without WSGS, critical reference ambiguity with clarification, and same-request replay without a second POST. These focused gates are 41/41 PASS.

The S11 marker is not asserted as PASS. The real WSGS instance and isolated PostgreSQL are unavailable because the host Docker control plane is unresponsive. Consequently real Task lifecycle, real typed WSGS product, cross-message exact-snapshot replay, and restart recovery tests remain NOT_RUN. Prior WSGS evidence is not reused as current runtime evidence.
