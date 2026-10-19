# Goal

## Problem
AG-UI v0.3 and Grounding Job support exist, but the presentation loop is incomplete: lifecycle is coarse, Grounding Job and DAG semantics are mixed, cross-view identity linkage is incomplete, candidate/map interactions are not a fully specified closed loop, and reconnect/revision behavior needs implementation-level proof.

## Required flows
- Normal: RUN -> world-grounding STEP -> grounding.job Activity -> State -> World Analysis View -> Text -> FINISHED.
- Partial: valid Findings remain visible with typed gaps/warnings.
- Selection: WAITING_SELECTION -> inspect candidates -> explicit confirm -> intervention resolve -> new Revision -> new Grounding -> new Snapshot.
- Map requery: local draft geometry -> explicit submit -> new Revision -> new Grounding -> new Snapshot.
- Reconnect: observer disconnect -> analysis continues -> full Snapshot -> reconnect existing analysis.
- Cancel: CANCEL_REQUESTED until authoritative terminal CANCELLED.

## Non-goals
No browser frontend, no WSGS internal DAG fabrication, no Provider calls, no route planning/device execution, no upstream repo changes, no release/deployment.
