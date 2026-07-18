# Contributing

All changes go through a pull request into protected `main`.

- Read `AGENTS.md`, the active ExecPlan, and the frozen A2A compatibility
  baseline before changing code.
- Use small semantic commits; do not rebase or force-push published branches.
- Run the phase-specific verification and report only commands actually run.
- Keep SDAR access inside the isolated A2A adapter. Do not add direct SDAR
  database, management API, MCP, Mesh, Registry, or multi-agent dependencies.
- Do not merge release pull requests without explicit maintainer approval.

By contributing, you agree that your contribution is licensed under
Apache-2.0.

