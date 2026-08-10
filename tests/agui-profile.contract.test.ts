import { describe, expect, it } from "@jest/globals";
import { EventType, RunAgentInputSchema } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";

import {
  AG_UI_SSE_CONTENT_TYPE,
  SACS_AG_UI_PROFILE,
  acceptsAgUiJson,
  acceptsAgUiSse,
  assertSacsAgUiEvent,
  parseAgUiInterrupt,
  parseAgUiResumeEntry,
  parseAgUiRunInput,
  type RunAgentInput,
} from "../packages/ag-ui-api-contract/src/index.js";

describe("SACS AG-UI 0.0.57 profile", () => {
  it("uses the official RunAgentInput schema and types", () => {
    const input = {
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [{ id: "message-1", role: "user", content: "status" }],
      tools: [],
      context: [],
      forwardedProps: {},
    } satisfies RunAgentInput;

    expect(parseAgUiRunInput(input)).toEqual(RunAgentInputSchema.parse(input));
  });

  it("uses official Interrupt and ResumeEntry schemas", () => {
    expect(
      parseAgUiInterrupt({
        id: "interrupt-1",
        reason: "sdar.input_required",
        message: "Please provide the requested input.",
      }),
    ).toMatchObject({ id: "interrupt-1", reason: "sdar.input_required" });
    expect(
      parseAgUiResumeEntry({
        interruptId: "interrupt-1",
        status: "resolved",
        payload: { value: "safe public input" },
      }),
    ).toMatchObject({ interruptId: "interrupt-1", status: "resolved" });
  });

  it("freezes HTTP/SSE content negotiation", () => {
    expect(AG_UI_SSE_CONTENT_TYPE).toContain("text/event-stream");
    expect(acceptsAgUiSse(undefined)).toBe(true);
    expect(acceptsAgUiSse("*/*")).toBe(true);
    expect(acceptsAgUiSse("text/event-stream; charset=utf-8")).toBe(true);
    expect(acceptsAgUiSse("application/json")).toBe(false);
    expect(acceptsAgUiJson("application/json; charset=utf-8")).toBe(true);
    expect(acceptsAgUiJson("application/vnd.ag-ui+json")).toBe(true);
    expect(acceptsAgUiJson("text/plain")).toBe(false);
  });

  it("accepts profile events and rejects RAW or inferred tool events", () => {
    const started = assertSacsAgUiEvent({
      type: EventType.RUN_STARTED,
      threadId: "thread-1",
      runId: "run-1",
    });
    const encoded = new EventEncoder({ accept: "text/event-stream" }).encodeSSE(
      started,
    );
    expect(encoded).toContain("RUN_STARTED");
    expect(() =>
      assertSacsAgUiEvent({ type: EventType.RAW, event: { secret: true } }),
    ).toThrow("outside the SACS profile");
    expect(() =>
      assertSacsAgUiEvent({
        type: EventType.TOOL_CALL_START,
        toolCallId: "tool-1",
        toolCallName: "internal_mcp",
        parentMessageId: "message-1",
      }),
    ).toThrow("outside the SACS profile");
    expect(SACS_AG_UI_PROFILE).toMatchObject({
      runIsTask: false,
      rawEvents: false,
      inferredToolCalls: false,
    });
  });
});
