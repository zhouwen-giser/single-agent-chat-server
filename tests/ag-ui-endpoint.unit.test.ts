import { describe, expect, it } from "@jest/globals";
import { EventType } from "@ag-ui/core";

import { createTextAgUiRunHandler } from "../packages/ag-ui-interaction-adapter/src/index.js";

describe("AG-UI observation lifecycle", () => {
  it("stops the current observation on abort without inventing a finish", async () => {
    let releaseAnswer: (() => void) | undefined;
    const answerReady = new Promise<void>((resolve) => {
      releaseAnswer = resolve;
    });
    const abortController = new AbortController();
    const handler = createTextAgUiRunHandler(async () => {
      await answerReady;
      return "must not be emitted after disconnect";
    });
    const iterator = handler({
      input: {
        threadId: "thread-1",
        runId: "run-1",
        state: {},
        messages: [{ id: "user-1", role: "user", content: "hello" }],
        tools: [],
        context: [],
        forwardedProps: {},
      },
      principalId: "principal-1",
      internalThreadId: "internal-thread-1",
      signal: abortController.signal,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: EventType.RUN_STARTED },
    });
    const observation = iterator.next();
    abortController.abort();
    releaseAnswer?.();

    await expect(observation).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});
