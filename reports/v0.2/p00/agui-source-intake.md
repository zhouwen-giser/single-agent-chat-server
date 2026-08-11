# Source Intake — AG-UI

- Source: official maintained AG-UI repository and npm packages
- Repository: `ag-ui-protocol/ag-ui`
- Release/branch: `release/2026-08-07`
- Exact SHA: `338708ca8b57deda9c82d0329f30944ab4b0dea6`
- Retrieved at: 2026-08-10
- License: MIT
- Purpose: exact northbound types, encoding, client, and Interrupt/Resume rules

## Files inspected

Core/client/encoder package manifests, client interrupt helpers, and the
experimental A2A integration README, package, and mapping utilities.

## Contract facts

Official `RunAgentInput`, event, interrupt, and resume types decide the AG-UI
wire. Resume arrays cover all open interrupts and reject unknown IDs.

## Exact version pins

`@ag-ui/core@0.0.57`, `@ag-ui/client@0.0.57`, and
`@ag-ui/encoder@0.0.57`.

## Compatibility with SACS

Core/client/encoder are accepted for exact contracts and E2E. The experimental
`@ag-ui/a2a@0.0.6` depends on `@a2a-js/sdk ^0.2.2`, can emit RAW events, and
does not satisfy SACS's frozen A2A or stricter public-event policy.

## Risks

No RAW events, inferred tool lifecycle, or second A2A adapter may enter the
product. Windows long paths prevent a reliable full checkout, so the exact-SHA
sparse checkout is the inspected source.

## Decision

Core/client/encoder: `ACCEPTED`; A2A integration: `REFERENCE_ONLY`.
