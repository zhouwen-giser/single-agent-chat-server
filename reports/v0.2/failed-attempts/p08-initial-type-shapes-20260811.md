# P08 failed attempt: initial durable Run type shapes

- Date: 2026-08-11
- Gate: `pnpm typecheck`
- Result: failed as required

The first compile found that query execution returned `Promise<string>` rather
than the legacy result union and that replay filtering did not narrow the JSON
array to typed interaction events. Query results are now awaited and replay
events are explicitly validated one item at a time. Typecheck then passed.
