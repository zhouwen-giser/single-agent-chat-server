# Durable AG-UI Interrupt and Resume

SACS converts only the three published SDAR `INPUT_REQUIRED` phases into
AG-UI interrupts:

| `internalPhase`              | official interrupt reason | allowed resolved actions                                   |
| ---------------------------- | ------------------------- | ---------------------------------------------------------- |
| `awaiting_plan_confirmation` | `sdar.plan_confirmation`  | `confirm_plan`, `reject_plan`, `revise_plan`, `patch_goal` |
| `awaiting_user_input`        | `sdar.input_required`     | `provide_input`                                            |
| `paused`                     | `sdar.paused`             | `resume`, `cancel_goal`                                    |

An unsupported or missing phase fails closed. `awaiting_user_input` also
requires the exact published `inputRequestId`.

## Persist before finish

Before an `input.required` interaction event can reach the AG-UI projection,
SACS durably stores the principal, internal thread, Task, context, phase,
reason, optional input request and response schema, and expiry. The Task and
context must already be authorized for the same principal/thread. The emitted
official Interrupt carries the durable expiry and public response schema.

## Resume payload

The HTTP body is first parsed by official `RunAgentInputSchema`; every entry is
parsed again by official `ResumeEntrySchema` at the runtime boundary. A
resolved SACS Resume payload is:

```json
{
  "action": "provide_input",
  "text": "published user input",
  "data": { "optional": "JSON only for provide_input" },
  "inputRequestId": "exact-published-id"
}
```

Only `action`, optional bounded `text`, optional bounded JSON `data`, and
optional `inputRequestId` are accepted. The action must be allowed for the
durable phase; structured data is allowed only for `provide_input`. If SDAR
publishes a response schema, SACS validates the complete Resume payload against
the supported fail-closed JSON Schema subset before claiming a side effect.

The single-SDAR profile can have only one unfinished interrupt for its active
Task. A Resume request must therefore provide exactly one complete entry.
Zero-entry and multi-entry requests are rejected before any A2A call, avoiding
partial multi-interrupt resolution.

## Durable resolution

Resolution is a three-step state transition:

```text
OPEN -> RESOLVING (durable resolution hash) -> A2A sendMessage -> RESOLVED
```

The A2A Follow-up uses a stable message ID and the existing strict adapter,
which emits only `sdar_action`, optional `input_request_id`, and optional
`user_id` metadata. Same hash after `RESOLVED` is a replay with no new
Follow-up. Different content conflicts. Same hash while `RESOLVING` remains
in-progress; SACS does not automatically resend after a crash or uncertain
network result. This favors no duplicate side effect over an unsafe retry.

An official ResumeEntry with status `cancelled` closes the local interrupt and
sends no A2A request. It does not imply `cancelTask` or `cancel_goal`. Expired,
cross-principal, cross-thread, changed Task/context, stale, and already-
cancelled interrupts fail closed.
