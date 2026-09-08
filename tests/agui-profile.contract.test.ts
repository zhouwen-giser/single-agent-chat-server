import { describe, expect, it } from "@jest/globals";
import { EventType, RunAgentInputSchema } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";

import {
  AG_UI_PROFILE_HEADER,
  AG_UI_SSE_CONTENT_TYPE,
  SACS_AG_UI_PROFILE,
  SACS_AG_UI_V02_PROFILE_ID,
  SACS_AG_UI_V03_PROFILE,
  SACS_AG_UI_V03_PROFILE_ID,
  acceptsAgUiJson,
  acceptsAgUiSse,
  assertSacsAgUiEvent,
  negotiateSacsAgUiProfile,
  parseSacsAgUiToolResultContent,
  parseAgUiInterrupt,
  parseAgUiResumeEntry,
  parseAgUiRunInput,
  type RunAgentInput,
} from "../packages/ag-ui-api-contract/src/index.js";
import { createSacsAgUiCapabilities } from "../packages/ag-ui-interaction-adapter/src/index.js";

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

  it("negotiates v0.3 only by explicit request and keeps v0.2 as default", () => {
    expect(AG_UI_PROFILE_HEADER).toBe("x-sacs-ag-ui-profile");
    expect(negotiateSacsAgUiProfile(undefined)).toBe(SACS_AG_UI_V02_PROFILE_ID);
    expect(negotiateSacsAgUiProfile(SACS_AG_UI_V03_PROFILE_ID)).toBe(
      SACS_AG_UI_V03_PROFILE_ID,
    );
    expect(() => negotiateSacsAgUiProfile("sacs-ag-ui-v9")).toThrow(
      "AG_UI_PROFILE_NOT_SUPPORTED",
    );
    expect(SACS_AG_UI_V03_PROFILE).toMatchObject({
      backwardCompatibleProfile: SACS_AG_UI_V02_PROFILE_ID,
      resumable: false,
    });
    const legacyCustom = {
      type: EventType.CUSTOM,
      name: "sacs.world-explanation.v1",
      value: { explanationId: "explanation-1" },
    };
    expect(() => assertSacsAgUiEvent(legacyCustom)).not.toThrow();
    expect(() =>
      assertSacsAgUiEvent(legacyCustom, SACS_AG_UI_V03_PROFILE_ID),
    ).toThrow("outside sacs-ag-ui-v0.3");
  });

  it("advertises v0.3 server tool events without client tools or resumability", () => {
    expect(createSacsAgUiCapabilities()).toMatchObject({
      transport: { resumable: false },
      tools: { supported: false, clientProvided: false },
      custom: { sacsProfile: SACS_AG_UI_V02_PROFILE_ID },
    });
    expect(createSacsAgUiCapabilities(SACS_AG_UI_V03_PROFILE_ID)).toMatchObject(
      {
        transport: { resumable: false },
        tools: { supported: true, clientProvided: false },
        humanInTheLoop: { approveWithEdits: true },
        custom: {
          sacsProfile: SACS_AG_UI_V03_PROFILE_ID,
          backwardCompatibleProfile: SACS_AG_UI_V02_PROFILE_ID,
        },
      },
    );
  });

  it("accepts only bounded structured ToolCallResult content in v0.3", () => {
    const content = JSON.stringify({
      schemaVersion: "sacs-ag-ui-tool-result/1.0",
      status: "COMPLETED",
      summary: "Completed safely.",
      analysisId: "analysis-1",
      revisionId: "revision-1",
      runId: "run-1",
      nodeId: "node-1",
      findingIds: ["finding-1"],
      layerIds: ["layer-1"],
      evidenceItemIds: ["evidence-1"],
    });
    expect(parseSacsAgUiToolResultContent(content).summary).toBe(
      "Completed safely.",
    );
    expect(() =>
      assertSacsAgUiEvent(
        {
          type: EventType.TOOL_CALL_RESULT,
          messageId: "message-1",
          toolCallId: "tool-1",
          content,
        },
        SACS_AG_UI_V03_PROFILE_ID,
      ),
    ).not.toThrow();
    expect(() =>
      parseSacsAgUiToolResultContent(
        JSON.stringify({ ...JSON.parse(content), geometry: { type: "Point" } }),
      ),
    ).toThrow("AG_UI_TOOL_RESULT_INVALID");
  });
});
