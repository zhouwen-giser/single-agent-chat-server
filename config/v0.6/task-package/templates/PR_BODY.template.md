## Summary

- Integrate SACS v0.6 with the real WSGS Grounding Job lifecycle.
- Add explicit WSGS 1.0/1.1 contract negotiation and authoritative geospatial consumer locking.
- Generalize the v0.5 Analysis runtime across Grounding Job, Native and Fixture transports without fabricating upstream Plan/DAG state.
- Add durable observation/recovery, unified result normalization, map/timeline/text/AG-UI projections and multi-turn controls.

## Source locks

```text
SACS:
WSGS:
WSGS contract lock:
Task package:
```

## Track decisions

```text
DEVELOPMENT:
REAL_WSGS_INTEGRATION:
RELEASE: NOT_REQUESTED
```

## Verification

Add source-bound commands, exit codes and evidence links.

## External blockers

List only blockers supported by locked WSGS capabilities/contracts. Do not treat fixture success as real integration.

## Safety / non-claims

- No changes to WSGS, GOWM+, GDPS, SDAR or Provider repositories.
- No direct Provider or upstream database connection.
- No invented WSGS internal DAG/progress.
- Historical action targets are non-executing.
- Native WSGS Analysis Control remains deferred.
- No merge, tag, release or deployment is included.

This PR should remain Draft unless the user explicitly requests readiness.
