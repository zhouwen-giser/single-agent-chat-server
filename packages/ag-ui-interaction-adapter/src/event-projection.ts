import { EventType } from "@ag-ui/core";

import {
  assertSacsAgUiEvent,
  type AGUIEvent,
} from "../../ag-ui-api-contract/src/index.js";
import type {
  PublicJsonValue,
  SdarInteractionEvent,
} from "../../interaction-contract/src/index.js";
import type { AgUiRunContext, AgUiRunHandler } from "./index.js";

const terminalStates = new Set(["COMPLETED", "FAILED", "CANCELED", "REJECTED"]);

export async function* renderInteractionEventsForAgUi(
  events: AsyncIterable<SdarInteractionEvent>,
): AsyncGenerator<AGUIEvent> {
  const projection = new AgUiEventProjection();
  for await (const event of events) {
    for (const projected of projection.project(event)) yield projected;
  }
}

export type InteractionEventSource = (
  context: AgUiRunContext,
) => AsyncIterable<SdarInteractionEvent>;

export function createInteractionAgUiRunHandler(
  source: InteractionEventSource,
): AgUiRunHandler {
  return async function* run(context) {
    for await (const event of renderInteractionEventsForAgUi(source(context))) {
      if (context.signal.aborted) return;
      yield event;
    }
  };
}

export class AgUiEventProjection {
  private snapshotTaskId: string | undefined;
  private activityTaskId: string | undefined;
  private finished = false;

  project(event: SdarInteractionEvent): readonly AGUIEvent[] {
    if (this.finished) return [];
    switch (event.eventType) {
      case "run.started":
        return [
          profile({
            type: EventType.RUN_STARTED,
            threadId: event.threadId,
            runId: event.runId,
            timestamp: timestamp(event.occurredAt),
          }),
        ];
      case "task.bound":
        return [
          custom("sdar.task.bound", catalogValue(event, [], true), event),
        ];
      case "task.snapshot":
        return this.taskSnapshot(event);
      case "task.status_changed":
        return this.taskDelta(event);
      case "message.text":
      case "artifact.text":
        return textEvents(event);
      case "artifact.data":
        return [
          custom(
            "sdar.artifact.data",
            catalogValue(event, ["artifactId", "mediaType", "data"]),
            event,
          ),
        ];
      case "artifact.reference":
        return [
          custom(
            "sdar.artifact.reference",
            catalogValue(event, ["artifactId", "mediaType", "url"]),
            event,
          ),
        ];
      case "capability.gap":
        return [
          custom(
            "sdar.capability_gap",
            catalogValue(event, ["errorCode", "capabilityGap", "nextAction"]),
            event,
          ),
        ];
      case "allowed_actions.changed":
        return this.allowedActions(event);
      case "input.required":
        this.finished = true;
        return [
          profile({
            type: EventType.RUN_FINISHED,
            threadId: event.threadId,
            runId: event.runId,
            timestamp: timestamp(event.occurredAt),
            outcome: {
              type: "interrupt",
              interrupts: [
                {
                  id: `${event.runId}:input-required`,
                  reason:
                    stringValue(event.payload.internalPhase) ??
                    "input_required",
                  ...(stringValue(event.payload.text) === undefined
                    ? {}
                    : { message: stringValue(event.payload.text) }),
                  metadata: catalogValue(
                    event,
                    ["internalPhase", "inputRequestId", "allowedActions"],
                    true,
                  ),
                },
              ],
            },
          }),
        ];
      case "observation.ended":
        this.finished = true;
        return [
          custom(
            "sdar.observation_ended",
            catalogValue(event, ["state", "taskContinues"]),
            event,
          ),
          runFinished(event),
        ];
      case "run.finished":
        this.finished = true;
        return [runFinished(event)];
      case "run.error":
        this.finished = true;
        return [
          profile({
            type: EventType.RUN_ERROR,
            message:
              stringValue(event.payload.message) ??
              "The AG-UI run failed safely.",
            code: stringValue(event.payload.code) ?? "interaction_error",
            timestamp: timestamp(event.occurredAt),
          }),
        ];
    }
  }

  private taskSnapshot(event: SdarInteractionEvent): readonly AGUIEvent[] {
    const taskId = requiredTaskId(event);
    this.snapshotTaskId = taskId;
    this.activityTaskId = taskId;
    const task = publicTask(event);
    return [
      profile({
        type: EventType.STATE_SNAPSHOT,
        snapshot: publicState(event, task),
        timestamp: timestamp(event.occurredAt),
      }),
      profile({
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: `sdar-task:${taskId}`,
        activityType: "sdar.task",
        content: task,
        replace: true,
        timestamp: timestamp(event.occurredAt),
      }),
    ];
  }

  private taskDelta(event: SdarInteractionEvent): readonly AGUIEvent[] {
    const taskId = requiredTaskId(event);
    if (this.snapshotTaskId !== taskId || this.activityTaskId !== taskId) {
      throw new Error("AG-UI Task delta was received before its snapshot");
    }
    const task = publicTask(event);
    return [
      profile({
        type: EventType.STATE_DELTA,
        delta: [
          { op: "replace", path: "/task", value: task },
          {
            op: "replace",
            path: "/conversation/hasActiveTask",
            value: !terminalStates.has(String(task.state)),
          },
        ],
        timestamp: timestamp(event.occurredAt),
      }),
      profile({
        type: EventType.ACTIVITY_DELTA,
        messageId: `sdar-task:${taskId}`,
        activityType: "sdar.task",
        patch: [{ op: "replace", path: "", value: task }],
        timestamp: timestamp(event.occurredAt),
      }),
      custom(
        "sdar.task.status",
        catalogValue(event, [
          "state",
          "internalPhase",
          "phaseMessage",
          "updatedAt",
        ]),
        event,
      ),
    ];
  }

  private allowedActions(event: SdarInteractionEvent): readonly AGUIEvent[] {
    const taskId = requiredTaskId(event);
    const actions = Array.isArray(event.payload.actions)
      ? event.payload.actions.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return [
      ...(this.snapshotTaskId === taskId
        ? [
            profile({
              type: EventType.STATE_DELTA,
              delta: [
                { op: "replace", path: "/allowedActions", value: actions },
              ],
              timestamp: timestamp(event.occurredAt),
            }),
          ]
        : []),
      custom("sdar.allowed_actions", { taskId, actions }, event),
    ];
  }
}

function publicState(
  event: SdarInteractionEvent,
  task: Record<string, PublicJsonValue>,
): Record<string, PublicJsonValue> {
  return {
    schemaVersion: "io.sacs/agui-state/v0.2",
    conversation: {
      threadId: event.threadId,
      hasActiveTask: !terminalStates.has(String(task.state)),
    },
    task,
    allowedActions: [],
    observation: { bounded: true, endedBeforeTaskTerminal: false },
  };
}

function publicTask(
  event: SdarInteractionEvent,
): Record<string, PublicJsonValue> {
  return catalogValue(
    event,
    [
      "state",
      "internalPhase",
      "phaseMessage",
      "errorCode",
      "terminal",
      "updatedAt",
    ],
    true,
  );
}

function catalogValue(
  event: SdarInteractionEvent,
  fields: readonly string[],
  includeContext = false,
): Record<string, PublicJsonValue> {
  const value: Record<string, PublicJsonValue> = {};
  if (event.taskId !== undefined) value.taskId = event.taskId;
  if (includeContext && event.contextId !== undefined) {
    value.contextId = event.contextId;
  }
  for (const field of fields) {
    const item = event.payload[field];
    if (item !== undefined) value[field] = item;
  }
  return value;
}

function textEvents(event: SdarInteractionEvent): readonly AGUIEvent[] {
  const text = stringValue(event.payload.text);
  if (text === undefined) return [];
  const messageId = `${event.eventId}:assistant`;
  return [
    profile({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
      timestamp: timestamp(event.occurredAt),
    }),
    profile({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: text,
      timestamp: timestamp(event.occurredAt),
    }),
    profile({
      type: EventType.TEXT_MESSAGE_END,
      messageId,
      timestamp: timestamp(event.occurredAt),
    }),
  ];
}

function custom(
  name: string,
  value: Record<string, PublicJsonValue>,
  event: SdarInteractionEvent,
): AGUIEvent {
  return profile({
    type: EventType.CUSTOM,
    name,
    value,
    timestamp: timestamp(event.occurredAt),
  });
}

function runFinished(event: SdarInteractionEvent): AGUIEvent {
  return profile({
    type: EventType.RUN_FINISHED,
    threadId: event.threadId,
    runId: event.runId,
    outcome: { type: "success" },
    timestamp: timestamp(event.occurredAt),
  });
}

function profile(input: unknown): AGUIEvent {
  return assertSacsAgUiEvent(input);
}

function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: PublicJsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredTaskId(event: SdarInteractionEvent): string {
  if (event.taskId === undefined)
    throw new Error(`${event.eventType} omitted Task ID`);
  return event.taskId;
}
