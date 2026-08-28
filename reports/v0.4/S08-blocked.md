# SACS v0.4 S08 genuine WSGS multi-turn gate

## Decision

S08 is `BLOCKED_UPSTREAM_TYPED_STALE`. The Ready marker remains withheld.

The authorized live run used the isolated WSGS v0.2 debug instance at the
handed-off commit and an isolated disposable SACS PostgreSQL instance. The WSGS
live and ready probes returned HTTP 200, the northbound contract matched, and
all four required operations were advertised ready. Credentials were consumed
only from the authorized process environment and are not present in this
report, runner output, or repository.

## Redacted live evidence

The initial vehicle grounding completed and produced one mention and one
reference product. Before using that reference in the pronoun follow-up, SACS
correctly invoked `VALIDATE_REFERENCES` because the product required
revalidation.

- Create request: HTTP 202.
- Poll requests: HTTP 200.
- WSGS terminal result: `COMPLETED`.
- WSGS `error.code`: null.
- WSGS `error.stage`: null.
- Returned product `sourceOperation`: `reference.resolve`.
- Returned product `revalidationRequired`: true.
- Returned product `validUntil`: absent.

The successful HTTP and terminal statuses therefore did not produce a usable
reference. SACS retained the focus item as `STALE` and failed closed with
`WORLD_GROUNDING_CONTEXT_UNAVAILABLE` before sending a pronoun query that would
have depended on it. Treating this product as current would violate the frozen
policy requiring validation before use.

This blocks AC-M001 (vehicle pronoun follow-up). AC-M005 (expired-reference
revalidation) depends on the same validation transition and cannot pass until
WSGS returns a product with current usable validity semantics. The remaining
ordered live scenarios, including the area follow-up, PendingChoice validation
and resume, thread isolation, restart recovery, shared OpenAI/AG-UI focus, and
replay checks, were not reached and are not reported as passed.

## SACS regression evidence

SACS now preserves a completed-but-revalidation-required reference as `STALE`
instead of dropping it. Focused unit and PostgreSQL integration regression
tests passed 14/14. The runner contract passed 3/3 tests; lint passed with zero
warnings and typecheck passed.

## Required upstream resolution

For a reference that can be validated, `VALIDATE_REFERENCES` must return a
product that no longer requires revalidation and carries usable current
validity semantics. SACS must not weaken its fail-closed handling of stale
references. After the WSGS debug instance is refreshed, rerun the complete S08
matrix from the first scenario.

No shared WSGS, GOWM, GDPS, or database fixture was restarted or modified.
