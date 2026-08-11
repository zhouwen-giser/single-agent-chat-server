# Failed Attempt

- Phase: P13
- Timestamp: 2026-08-11
- Candidate SHA: `40e7ae4e2346bb932ccd7e6b89aea3793cc08c42`
- Command/scenario: bounded long observation with 500 ms stream and 250 ms poll budgets
- Result: Task reached `INPUT_REQUIRED` before an `observation.ended` event

## Failure

The Task was created, but the exact local SDAR fixture progressed to plan
confirmation within the configured window. `INPUT_REQUIRED` correctly maps to
an interrupt rather than `observation.ended`, so the strict long-observation
driver rejected the run.

## Root cause

The short entrance budget was not short enough for the current fast local SDAR
fixture. The product mapping was correct; using the same handling for
`INPUT_REQUIRED` and a nonterminal observation boundary would have been wrong.

## Fix/disposition

Start the same candidate with the minimum legal 100 ms stream budget and zero
polling budget, use a new durable Run identity, and retain the original failed
attempt. The earlier test Task was canceled through the official adapter.

## Retest evidence

Task `f78651cd-3675-4862-a317-63e91e05531d` emitted
`observation.ended` with `taskContinues=true`, recovered through `getTask()` to
`INPUT_REQUIRED/awaiting_plan_confirmation`, and finished cleanup as
`CANCELED`, with no cursor or resubscription.
