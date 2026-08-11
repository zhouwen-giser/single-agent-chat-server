# P12 failed attempts: bounded long-observation orchestration

- Date: 2026-08-11
- Gate: nonterminal bounded stream followed by `getTask()` polling
- Result: failed attempts retained

Early versions of the driver tried three orchestration shapes that did not
match the real contract. A read-only status query cannot synthesize an
Interrupt, and plan confirmation itself is a bounded `sendMessage` Follow-up
rather than a Task stream resubscription. Another attempt placed a Task ID in a
custom client payload instead of deriving identity from the accepted server
events and authorized binding.

The final driver creates a real Task through the short-budget SACS path,
requires the published `observation_ended` boundary, proves that the Task
continues, and recovers only with adapter `getTask()` polling. The exact-SHA run
passed without an event cursor or resubscription; the rejected shapes remain
failed evidence.
