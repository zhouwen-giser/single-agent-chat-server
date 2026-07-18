# Task Package R2 Changelog

This revision corrects the Codex Goal package against the inspected SDAR A2A implementation at commit `667146a3639eefdfed9b89c2417c08e1ac50e9a9`.

Key corrections:

- pinned A2A spec patch 1.0.1, wire 1.0, HTTP+JSON and `@a2a-js/sdk@1.0.0-beta.0`;
- removed v0.3-first/alpha SDK selection;
- replaced generic task update/subscription abstractions with `sendMessageStream`, `sendMessage`, `getTask`, and `cancelTask`;
- added strict SDAR Follow-up actions and metadata allowlist;
- required `INPUT_REQUIRED` interpretation through `internalPhase`;
- changed stream recovery to bounded stream plus `getTask()` polling;
- corrected top-level cancellation semantics and Provider boundary;
- limited progress to published Task/status messages and final Result Artifact;
- added Docker Agent Card endpoint override handling;
- added protocol drift gates and 22 acceptance scenarios.
