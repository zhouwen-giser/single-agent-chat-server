# Source Intake — SDAR

- Source: maintained upstream main
- Repository: `zhouwen-giser/skill-driven-agent-runtime`
- Release/branch: `main`, package version 1.4.1
- Exact SHA: `a9957c82c17ca01e77528f3817c03d86224aaf88`
- Retrieved at: 2026-08-10
- License: Apache-2.0
- Purpose: execution-time one-SDAR A2A compatibility lock

## Files inspected

`package.json`, A2A compatibility, HTTP endpoint, task service executor, task
mapping, and Agent Card projection sources.

## Contract facts

A2A spec patch 1.0.1, wire 1.0, HTTP+JSON, Agent Card
`/.well-known/agent-card.json`, endpoint `/a2a`, and existing-task actions:
`confirm_plan`, `reject_plan`, `revise_plan`, `patch_goal`, `cancel_goal`,
`provide_input`, `pause`, and `resume`.

## Exact version pins

`@a2a-js/sdk@1.0.0-beta.0`.

## Compatibility with SACS

Compatible with the existing isolated adapter. SACS must continue using only
`sendMessageStream`, `sendMessage`, `getTask`, and `cancelTask`.

## Risks

The unauthenticated A2A endpoint requires a trusted isolated network. Agent Card
published endpoints may need explicit `SDAR_A2A_ENDPOINT_OVERRIDE`.

## Decision

`ACCEPTED`
