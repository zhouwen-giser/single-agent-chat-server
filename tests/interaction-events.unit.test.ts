import { describe, expect, it } from "@jest/globals";

import {
  InteractionEventFactory,
  isSdarInteractionEvent,
  safePublicText,
} from "../packages/interaction-contract/src/index.js";
import { legacyChatResultToInteractionEvents } from "../packages/interaction-runtime/src/index.js";
import { renderInteractionEventsForOpenAi } from "../packages/openai-interaction-adapter/src/index.js";

describe("unified interaction event spine", () => {
  it("emits strictly increasing sequences and explicit dedupe", () => {
    let id = 0;
    const factory = new InteractionEventFactory({
      runId: "run-1",
      threadId: "thread-1",
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      nextId: () => `event-${++id}`,
    });
    const started = factory.create("run.started", {});
    const text = factory.publicText("public", { dedupeKey: "message-1" });
    const duplicate = factory.publicText("public", {
      dedupeKey: "message-1",
    });
    const finished = factory.create("run.finished", {
      taskTerminal: false,
    });

    expect([started?.sequence, text?.sequence, finished?.sequence]).toEqual([
      0, 1, 2,
    ]);
    expect(duplicate).toBeUndefined();
    expect(started !== undefined && isSdarInteractionEvent(started)).toBe(true);
  });

  it("requires Task identity for Task-scoped events", () => {
    const factory = new InteractionEventFactory({
      runId: "run-1",
      threadId: "thread-1",
    });
    expect(() =>
      factory.create("task.status_changed", { status: "WORKING" }),
    ).toThrow("requires an authorized Task scope");
    expect(
      factory.create(
        "task.status_changed",
        { status: "WORKING" },
        { task: { taskId: "task-1", contextId: "context-1" } },
      ),
    ).toMatchObject({ taskId: "task-1", contextId: "context-1" });
  });

  it("bounds and redacts public text", () => {
    expect(safePublicText("password=exposed value", 200)).toBe(
      "[REDACTED] value",
    );
    expect(safePublicText("abcdef", 3)).toBe("abc\n\n[truncated]");
  });

  it("bridges legacy coordinator text through the OpenAI renderer", async () => {
    const events = legacyChatResultToInteractionEvents(
      fragments("first", "second"),
      { runId: "run-1", threadId: "thread-1" },
    );
    const rendered: string[] = [];
    for await (const fragment of renderInteractionEventsForOpenAi(events)) {
      rendered.push(fragment);
    }
    expect(rendered).toEqual(["first", "second"]);
  });
});

async function* fragments(...values: string[]): AsyncGenerator<string> {
  yield* values;
}
