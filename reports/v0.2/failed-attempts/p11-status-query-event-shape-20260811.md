# P11 failed attempt: terminal status was expected only in State events

- Date: 2026-08-11
- Gate: official-client post-Resume terminal observation
- Result: failed attempt retained

The first full P11 driver required the post-Resume status query to publish a
State snapshot or delta. SACS correctly routed the explicit read-only status
query through the existing non-mutating query service, which returned the
published terminal Task status as official Text events. The driver therefore
reported `undefined` even though the response text stated that the same Task
was `COMPLETED`.

The driver now validates both approved representations: typed Task state from
the mutation/recovery path and bounded published terminal text from the
read-only query service. It still requires official `EventSchemas`, the same
Task identity when a typed binding is present, and a terminal `COMPLETED`
result. No production behavior was weakened, and the failed assertion is not
counted as passing evidence.
