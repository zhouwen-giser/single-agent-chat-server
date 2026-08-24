# Repository and release policy

- `main` is protected and changes arrive through pull requests.
- The v0.3 release branch is
  `feature/sacs-v0.3-general-conversation-multitask`; published history is
  never rebased or force-pushed.
- CODEOWNERS review is required for workflows, migrations, and the isolated A2A
  adapter.
- CI uses SHA-pinned GitHub Actions and exact Node/pnpm/PostgreSQL versions.
- Production dependencies must pass the Apache-2.0/MIT/BSD-3-Clause/ISC
  allowlist and produce a CycloneDX SBOM with pinned Syft v1.48.0.
- The frozen A2A SDK and protocol boundary is checked automatically.
- The Draft PR becomes Ready only after P13 real-model/current-SDAR and upgrade
  evidence plus the final P14 exact-head gate pass with zero required skips.
- Only the user controls final merge. Automation must not merge or bypass
  protected workflows.
