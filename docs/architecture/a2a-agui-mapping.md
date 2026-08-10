# A2A to interaction and AG-UI mapping

SACS maps only normalized, published A2A facts. The frozen
`@a2a-js/sdk@1.0.0-beta.0` remains isolated in `sdar-a2a-adapter`; the mapping
layer never sends an A2A request and never reads SDAR management APIs,
databases, MCP calls, internal skill execution, telemetry, or hidden reasoning.

## Ordered mapping

| Normalized public fact                   | Interaction event         | AG-UI projection                                           |
| ---------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| first authorized Task identity           | `task.bound`              | `CUSTOM sdar.task.bound`                                   |
| first authorized Task/status observation | `task.snapshot`           | `STATE_SNAPSHOT` then `ACTIVITY_SNAPSHOT`                  |
| later Task/status observation            | `task.status_changed`     | `STATE_DELTA`, `ACTIVITY_DELTA`, `CUSTOM sdar.task.status` |
| public agent text                        | `message.text`            | text start/content/end                                     |
| Artifact text                            | `artifact.text`           | text start/content/end                                     |
| bounded Artifact JSON                    | `artifact.data`           | `CUSTOM sdar.artifact.data`                                |
| allowed HTTPS Artifact reference         | `artifact.reference`      | `CUSTOM sdar.artifact.reference`                           |
| published Capability Gap                 | `capability.gap`          | `CUSTOM sdar.capability_gap`                               |
| server-calculated actions                | `allowed_actions.changed` | state delta and `CUSTOM sdar.allowed_actions`              |
| `INPUT_REQUIRED`                         | `input.required`          | `RUN_FINISHED` with official interrupt outcome             |
| bounded observation end                  | `observation.ended`       | `CUSTOM sdar.observation_ended` and run finish             |
| technical failure                        | `run.error`               | sanitized `RUN_ERROR`                                      |

Every mapper instance is scoped to one run and at most one authorized
Task/context pair. A changed Task identity is rejected. A Task delta is
rejected unless its state and activity snapshots have already been emitted.
Run completion does not imply Task completion, cancellation, or
resubscription.

## Public state

The state snapshot follows `io.sacs/agui-state/v0.2` and contains only:

- the protocol-neutral thread identity and active-Task flag;
- public Task identity, state, phase, error code, terminal flag, and timestamp;
- server-calculated allowed actions;
- the bounded-observation flags.

State and activity deltas use RFC 6902 operations. The mapper never emits an
event cursor and never treats a Run ID as an A2A Task ID.

## Data safety

Custom event values are constructed from the frozen field catalog, rather than
copying arbitrary A2A metadata. JSON Artifact and Capability Gap objects are
bounded and recursively redact secret-like keys. Artifact references must be
HTTPS, must not contain URL credentials, and are never fetched by SACS. Raw
parts are dropped. A2A, MCP, skill, reasoning, and telemetry records cannot be
inferred as AG-UI tool calls; the SACS AG-UI profile rejects all Tool and Raw
events.

P06 supplies the pure mapper and reusable typed-event AG-UI run handler. P07
adds durable Interrupt/Resume resolution, and P08 adds durable run recovery;
neither responsibility is inferred by this projection layer.
