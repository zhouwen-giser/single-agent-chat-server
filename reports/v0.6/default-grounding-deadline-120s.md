# Default Grounding deadline: 120 seconds

Changed both deterministic request planners (legacy/geospatial and frozen 1.2)
from 30,000 ms to 120,000 ms as requested. The read-only flag and all other
execution limits remain unchanged. Frozen upstream contract files are untouched;
120,000 ms is within the existing public contract limit.

Legacy planner assertions and the frozen planner's actual HTTP round-trip test
now require the new default. Existing saved requests are not rewritten; the new
default applies to newly planned requests and revisions.

The Grounding Job polling default is already 120,000 ms. The per-request HTTP
timeout remains separate: asynchronous POST/GET requests do not wait for the
whole job. This change does not extend every client stream or guarantee that a
model completes within its derived budget; real integration must verify that.

Validation:

- Planner and Grounding Job contract regression: 3 suites, 46 tests passed.
- TypeScript and changed-file formatting passed.
- Changed-file lint passed with existing warnings only.
- v0.4 acceptance evidence consistency and `git diff --check` passed.

No live WSGS request, upstream configuration change or deployment was performed
for this default-value change. In-progress real-integration files are excluded
from this commit.
