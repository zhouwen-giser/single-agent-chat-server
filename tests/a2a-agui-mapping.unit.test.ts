import { describe, expect, it } from "@jest/globals";
import { EventSchemas, EventType, type AGUIEvent } from "@ag-ui/core";

import {
  AgUiEventProjection,
  createInteractionAgUiRunHandler,
} from "../packages/ag-ui-interaction-adapter/src/event-projection.js";
import { InteractionEventFactory } from "../packages/interaction-contract/src/index.js";
import { A2aInteractionMapper } from "../packages/interaction-runtime/src/a2a-mapper.js";
import type { NormalizedTask } from "../packages/sdar-a2a-adapter/src/index.js";

describe("A2A to AG-UI public mapping", () => {
  it("emits Task snapshot before deltas and only approved official events", () => {
    const mapper = createMapper();
    const projection = new AgUiEventProjection();
    const initial = mapper.mapTask(task("WORKING"));
    const changed = mapper.mapTask(task("COMPLETED"));
    const agui = [...initial, ...changed].flatMap((event) =>
      projection.project(event),
    );

    agui.forEach((event) =>
      expect(() => EventSchemas.parse(event)).not.toThrow(),
    );
    expect(agui.map(({ type }) => type)).toEqual([
      EventType.CUSTOM,
      EventType.STATE_SNAPSHOT,
      EventType.ACTIVITY_SNAPSHOT,
      EventType.STATE_DELTA,
      EventType.CUSTOM,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.STATE_DELTA,
      EventType.ACTIVITY_DELTA,
      EventType.CUSTOM,
      EventType.STATE_DELTA,
      EventType.CUSTOM,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
    ]);
    expect(agui.some(({ type }) => type === EventType.RAW)).toBe(false);
    expect(agui.some(({ type }) => type.startsWith("TOOL_CALL"))).toBe(false);
    expect(
      agui.find(({ type }) => type === EventType.STATE_SNAPSHOT),
    ).toMatchObject({
      snapshot: {
        schemaVersion: "io.sacs/agui-state/v0.2",
        conversation: { threadId: "thread-1", hasActiveTask: true },
        task: { taskId: "task-1", contextId: "context-1", state: "WORKING" },
        observation: { bounded: true, endedBeforeTaskTerminal: false },
      },
    });
  });

  it("maps artifacts and capability gaps through bounded custom events", () => {
    const mapper = createMapper();
    const events = mapper.mapTask({
      ...task("FAILED"),
      internalPhase: "capability_gap",
      errorCode: "CAPABILITY_GAP",
      capabilityGap: {
        capability: "geo-analysis",
        secret: "must-not-leak",
      },
      nextAction: "register a public capability",
      artifacts: [
        {
          artifactId: "artifact-1",
          parts: [
            { kind: "text", mediaType: "text/plain", text: "public result" },
            {
              kind: "data",
              mediaType: "application/json",
              data: { value: 42, apiKey: "must-not-leak" },
            },
            {
              kind: "url",
              mediaType: "application/json",
              url: "https://artifacts.example/result.json",
            },
            {
              kind: "raw",
              mediaType: "application/octet-stream",
            },
          ],
        },
      ],
    });
    const agui = events.flatMap((event) =>
      new AgUiEventProjection().project(event),
    );
    const serialized = JSON.stringify(agui);

    expect(events.map(({ eventType }) => eventType)).toContain(
      "capability.gap",
    );
    expect(events.map(({ eventType }) => eventType)).toContain("artifact.text");
    expect(events.map(({ eventType }) => eventType)).toContain("artifact.data");
    expect(events.map(({ eventType }) => eventType)).toContain(
      "artifact.reference",
    );
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("RAW");
    expect(Object.keys(customValue(agui, "sdar.artifact.data")).sort()).toEqual(
      ["artifactId", "data", "mediaType", "taskId"],
    );
    expect(
      Object.keys(customValue(agui, "sdar.artifact.reference")).sort(),
    ).toEqual(["artifactId", "mediaType", "taskId", "url"]);
    expect(
      Object.keys(customValue(agui, "sdar.capability_gap")).sort(),
    ).toEqual(["capabilityGap", "errorCode", "nextAction", "taskId"]);
  });

  it("projects only public HTTPS artifact references without fetching them", () => {
    const mapper = createMapper();
    const events = mapper.mapTask({
      ...task("COMPLETED"),
      artifacts: [
        {
          artifactId: "artifact-url-policy",
          parts: [
            {
              kind: "url",
              mediaType: "text/plain",
              url: "https://artifacts.example/public.txt",
            },
            {
              kind: "url",
              mediaType: "text/plain",
              url: "https://127.0.0.1/private.txt",
            },
            {
              kind: "url",
              mediaType: "text/plain",
              url: "https://[::1]/private.txt",
            },
            {
              kind: "url",
              mediaType: "text/plain",
              url: "https://[::ffff:127.0.0.1]/private.txt",
            },
            {
              kind: "url",
              mediaType: "text/plain",
              url: "https://metadata.local/token",
            },
            {
              kind: "url",
              mediaType: "text/plain",
              url: "http://artifacts.example/insecure.txt",
            },
          ],
        },
      ],
    });
    const references = events.filter(
      (event) => event.eventType === "artifact.reference",
    );

    expect(references).toHaveLength(1);
    expect(references[0]?.payload.url).toBe(
      "https://artifacts.example/public.txt",
    );
  });
  it("turns phase-specific INPUT_REQUIRED into an official interrupt outcome", () => {
    const mapper = createMapper();
    const events = mapper.mapTask({
      ...task("INPUT_REQUIRED"),
      internalPhase: "awaiting_user_input",
      inputRequestId: "request-1",
      phaseMessage: "Please provide the published input.",
    });
    const projection = new AgUiEventProjection();
    const agui = events.flatMap((event) => projection.project(event));

    expect(
      agui.find(({ type }) => type === EventType.RUN_FINISHED),
    ).toMatchObject({
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            reason: "sdar.input_required",
            message: "Please provide the published input.",
            metadata: {
              taskId: "task-1",
              contextId: "context-1",
              inputRequestId: "request-1",
              allowedActions: ["provide_input"],
            },
          },
        ],
      },
    });
  });

  it("projects the typed event source through the reusable AG-UI run handler", async () => {
    const factory = new InteractionEventFactory({
      runId: "run-handler",
      threadId: "thread-handler",
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });
    const handler = createInteractionAgUiRunHandler(async function* () {
      yield required(factory.create("run.started", {}));
      yield required(factory.publicText("shared public semantics"));
      yield required(factory.create("run.finished", {}));
    });
    const events = [];
    for await (const event of handler({
      input: {
        threadId: "thread-handler",
        runId: "run-handler",
        state: {},
        messages: [],
        tools: [],
        context: [],
        forwardedProps: {},
      },
      principalId: "principal-1",
      internalThreadId: "thread-handler",
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events.map(({ type }) => type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
  });

  it("rejects cross-Task identity and delta-before-snapshot", () => {
    const mapper = createMapper();
    mapper.mapTask(task("WORKING"));
    expect(() =>
      mapper.mapTask({ ...task("WORKING"), taskId: "other-task" }),
    ).toThrow("changed authorized Task identity");

    const factory = new InteractionEventFactory({
      runId: "run-2",
      threadId: "thread-2",
    });
    const delta = factory.create(
      "task.status_changed",
      { state: "WORKING", terminal: false },
      { task: { taskId: "task-2", contextId: "context-2" } },
    );
    expect(() => new AgUiEventProjection().project(required(delta))).toThrow(
      "before its snapshot",
    );
  });
});

function createMapper(): A2aInteractionMapper {
  let id = 0;
  return new A2aInteractionMapper(
    new InteractionEventFactory({
      runId: "run-1",
      threadId: "thread-1",
      now: () => new Date("2026-08-11T00:00:00.000Z"),
      nextId: () => `event-${++id}`,
    }),
  );
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected interaction event");
  return value;
}

function customValue(
  events: readonly AGUIEvent[],
  name: string,
): Record<string, unknown> {
  const event = events.find(
    (candidate) =>
      candidate.type === EventType.CUSTOM && candidate.name === name,
  );
  if (event?.type !== EventType.CUSTOM) {
    throw new Error(`missing custom event ${name}`);
  }
  return event.value as Record<string, unknown>;
}

function task(state: NormalizedTask["state"]): NormalizedTask {
  return {
    taskId: "task-1",
    contextId: "context-1",
    state,
    statusTimestamp: "2026-08-11T00:00:00.000Z",
    statusMessage: {
      messageId: `message-${state}`,
      taskId: "task-1",
      contextId: "context-1",
      role: "AGENT",
      parts: [{ kind: "text", mediaType: "text/plain", text: state }],
    },
    artifacts: [],
  };
}
