# Observer-First Interactive Analysis Authority

This document freezes the SACS v0.5 authority boundary. It is an architectural
constraint, not a description of temporary implementation convenience.

## Authority ownership

| Concern                                                             | Authority                       | SACS responsibility                                                        |
| ------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| Semantic intent and capability matching                             | WSGS                            | Consume the authoritative analysis profile                                 |
| Typed Query DAG and executable node plan                            | WSGS                            | Validate identity and structural bounds, persist, and project              |
| Node reuse, invalidation, and rerun decisions                       | WSGS                            | Preserve the returned sets without independently recalculating them        |
| World references, geometry, and world currentness                   | GOWM through WSGS               | Display typed references and authority labels                              |
| Current products and analytical facts                               | GDPS/STAS through WSGS and GOWM | Display bounded published findings                                         |
| Session, Revision, Run, event, Proposal, and Intervention lifecycle | SACS                            | Persist and enforce ownership, CAS, idempotency, and Observer-First policy |
| AG-UI and map projection                                            | SACS                            | Project persisted state without creating new semantic facts                |

Production SACS code must not create a GOWM, GDPS, or STAS client, read those
systems directly, or import their SDKs. The only interactive-analysis
presentation/control boundary is the authorized WSGS analysis consumer. Plain
contract values such as `sourceAuthority: "GOWM"` identify provenance; they do
not grant routing authority.

SACS does not own semantic DAG generation, capability discovery, spatial
calculation, or node reuse policy. It may validate that WSGS-provided node sets
are bounded, unique, mutually consistent, and members of the published plan.
It must not decide which nodes are reused, invalidated, or rerun.

Tool events come from the WSGS analysis presentation stream or snapshot. SACS
must never reconstruct tool calls, progress, or completion events from final
evidence or final result artifacts.

## Development fixture boundary

The deterministic `FixtureWsgsAnalysisAdapter` is a development qualification
asset, not an alternate production authority. It is eligible only when
`NODE_ENV` is `test` or `development` and
`SACS_ANALYSIS_ADAPTER_MODE=fixture`; its manifest declares
`productionEligible=false`. The fixture implements the same five SACS-side
ports as the eventual HTTP adapter so local HTTP, AG-UI, policy, persistence,
and reconnect behavior can be exercised without inventing an upstream WSGS
contract. Production rejects fixture mode and fails closed until an
authoritative WSGS analysis-control handoff is available.

## Disconnect and the background event pump

The analysis event pump belongs to the durable Analysis Run, not to a browser
or SSE connection. After an authorized WSGS run starts, the pump continues to
receive, integrity-check, persist, and project upstream events while observers
are disconnected. Subscriber attachment and detachment only controls delivery
to that observer; it does not start, stop, cancel, or own the analysis.

The ordering invariant is:

```text
WSGS event -> integrity decision -> database transaction -> projection commit
           -> observer publication
```

On reconnect, SACS loads the persisted projection, sends complete State and
Activity snapshots, and then attaches the observer to new live publications.
Version 0.5 keeps `resumable=false` and does not claim arbitrary cursor replay.
Cancellation is a separate authenticated command and becomes `CANCELLED` only
after WSGS acknowledgement.

## Map local and shared state

Local observer state never creates an analysis command:

- viewport, zoom, pitch, and heading;
- hover and `inspectionFocus`;
- layer visibility preference;
- an unsubmitted edit draft;
- playback cursor and rate;
- panel layout.

Shared durable state is limited to:

- Analysis Session, Revision, Run, and Node state;
- execution, intervention, pinned, and conversation focus;
- submitted Proposal and Intervention state;
- analysis time window;
- WSGS-published layer descriptors and WorldExplanation.

Map pan, zoom, hover, inspection, and visibility changes are observation only.
Authoritative reference geometry is read-only. A submitted user geometry edit
is represented as a bounded `USER_OVERRIDE` Proposal; WSGS decides the revised
semantic plan.

## Mechanical guard

`pnpm verify:v05:architecture` scans production files under `apps/` and
`packages/`. It rejects direct downstream clients or endpoints, spatial
computation dependencies and coordinate algorithms, SACS-owned node-reuse or
semantic-DAG decisions, and final-evidence-to-tool-event inference. It permits
authority/type literals and the WSGS analysis consumer boundary.
