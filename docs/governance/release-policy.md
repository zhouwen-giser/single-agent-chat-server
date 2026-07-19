# Repository and release policy

- `main` is protected and changes arrive through pull requests.
- The release branch is `feature/single-sdar-chat-entry-v0.1`; published history
  is never rebased or force-pushed.
- CODEOWNERS review is required for workflows, migrations, and the isolated A2A
  adapter.
- CI uses SHA-pinned GitHub Actions and exact Node/pnpm/PostgreSQL versions.
- Production dependencies must pass the Apache-2.0/MIT/BSD-3-Clause/ISC
  allowlist and produce a CycloneDX SBOM with pinned Syft v1.48.0.
- The frozen A2A SDK and protocol boundary is checked automatically.
- The Draft PR becomes Ready only after all required real Phase 11 E2E and
  final Phase 13 acceptance gates pass.
- Only the user controls final merge. Automation must not merge or bypass
  protected workflows.
