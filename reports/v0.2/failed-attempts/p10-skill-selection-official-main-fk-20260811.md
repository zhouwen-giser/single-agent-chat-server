# P10 failed attempt: official main omitted Skill-selection composition

- Date: 2026-08-11
- Gate: real Skill selection
- Result: failed as observed

The exact SDAR commit's ordinary server main did not compose its optional
`skillSelection` dependency. An attempt ID reached the selection foreign key
and failed `agent_task_skill_selection_fk`. The E2E harness then called the
same exact locked `startServerRuntime` with the official deterministic
embedding hook; no upstream file was edited.
