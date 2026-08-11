# P12 failed attempts: real SDAR background cleanup serialization

- Date: 2026-08-11
- Gate: combined real P12 commands against one local SDAR composition
- Result: failed attempts retained

Several attempts placed the northbound matrix, same-Task consistency scenario,
and short-budget observation scenario immediately back-to-back in one process.
The local deterministic SDAR test composition was still serializing background
Goal/model cleanup when the next Task arrived, so that Task could fail before
SACS received and persisted a binding. These aggregate attempts are failures;
they are not evidence of a passing Task flow.

The required behaviors are now three explicit zero-skip commands against the
same locked source, PostgreSQL, Redis, SACS, and Open WebUI services. Before the
final long-observation run, only the exact SDAR test process was restarted to
isolate prior test cleanup. The resulting Task proved bounded stream recovery
and was explicitly canceled for cleanup. This split preserves the product
contract and records the environment serialization instead of hiding it.
