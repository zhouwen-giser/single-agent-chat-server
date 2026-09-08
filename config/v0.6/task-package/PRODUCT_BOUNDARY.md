# Product Boundary

## SACS owns

- OpenAI-compatible and AG-UI conversational entry.
- User, principal, thread, message, request and analysis bindings.
- Turn classification and selection of `WORLD_ANSWER` versus task/general routes.
- Construction of WSGS Grounding requests from authorized conversation context.
- WSGS consumer contract negotiation and response validation.
- Grounding Job lifecycle observation.
- Analysis Session, Revision, Run, Event and Projection persistence.
- Safe result normalization into a SACS-owned view model.
- Text, map, timeline, candidate and intervention presentation.
- Multi-turn reuse of prior WSGS Grounding results.
- User-initiated cancellation and new-revision submission.
- Security, rate limits, logging, telemetry, recovery and idempotency at the SACS boundary.

## WSGS owns

- Semantic parsing of world questions.
- Mention/reference grounding.
- Query compilation.
- Selection and composition of GOWM+, GDPS and analysis capabilities.
- Provider operation identity and arguments.
- Capability gaps and typed gaps.
- Evidence/provenance aggregation.
- Northbound Grounding Result and authoritative result schemas.
- World selection and source-currentness operations when actually available.
- Internal execution graph and internal progress.

## SACS does not own

- GOWM+ or GDPS storage.
- Historical trajectory extraction.
- Map matching, temporal-event derivation, H3 ranking or other Provider algorithms.
- Provider discovery and invocation.
- Upstream ReferenceKey generation.
- Upstream evidence fabrication.
- Route planning, device task creation or device control.
- WSGS Native Analysis API implementation.
- Open WebUI source code.

## Hard boundary

```text
SACS → WSGS northbound API only
```

The following paths are forbidden:

```text
SACS → GOWM+ database
SACS → GDPS database
SACS → T2/T3/T4 Provider
SACS → WSGS internal database
SACS → arbitrary MCP Provider
```

## Authority

- User text supplies intent and constraints, not world truth.
- WSGS supplies grounded world results and capability gaps.
- GOWM+/GDPS/Provider receipts remain upstream evidence authorities.
- SACS supplies presentation and interaction state, not new world facts.
