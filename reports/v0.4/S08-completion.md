# SACS v0.4 S08 genuine WSGS multi-turn completion

## Decision

S08 is `PASS`. The real runner emitted
`SACS_MULTITURN_WORLD_GROUNDING_READY`.

The runner was locked to WSGS commit
`46e872359536b84351ce2b417117fc5725c59145` and used an isolated disposable
PostgreSQL database. Credentials were consumed only inside the authorized
process and are not present in repository artifacts or output.

## Real matrix

The clean run completed all eight required scenarios with 10 genuine WSGS
business POSTs:

- `EXECUTE_WORLD_QUERY`: 8.
- `VALIDATE_REFERENCES`: 2.
- Request evidence hash:
  `sha256:3ffece1f4286708f9800d956aaaddb1edf0de8d670ea031c3c02ece892325f4e`.

The live chain passed vehicle and area pronoun reuse, durable
`AMBIGUOUS` → `第二个` → validate → resume, no-choice clarification,
expired-reference validation before follow-up, thread isolation, restart
restore, OpenAI/AG-UI shared Focus, WSGS pronoun authority, and replay without a
duplicate WSGS POST.

Current-reference follow-ups follow the task package contract:
`knownWorldReferences=true`, `priorGrounding=false`. SACS does not rewrite
pronouns, substitute reference versions, or weaken WSGS/GOWM validation.

## SACS corrections proved by the gate

The real matrix found and closed a replay defect where mutable Focus revision
was part of the outer idempotency identity. Immutable turn/plan/source identity
now controls replay while the actual WSGS request hash still covers the
assembled context capsule.

The runner also preserves completed stale/expired references for explicit
validation, maps terminal WSGS failures through the published safe error
boundary, locks the exact WSGS source, and uses a 120000 ms test-only deadline.
The production planner default is unchanged.

## Supporting gates

- S08 harness contract: 3/3 PASS.
- World-grounding runtime regression: 8/8 PASS.
- Focused reference/unit/PostgreSQL regression: 14/14 PASS.
- Lint: PASS with zero warnings.
- Typecheck: PASS.

The harness records only bounded statuses, counts, booleans, safe error
code/stage values, and hashes. It does not print credentials or raw reference
identifiers.

No shared WSGS, GOWM, GDPS, or database fixture was restarted or modified by
the SACS verification process.
