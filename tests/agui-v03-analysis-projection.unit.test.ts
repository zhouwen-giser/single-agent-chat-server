import { describe, expect, it } from "@jest/globals";
import { EventSchemas, EventType } from "@ag-ui/core";

import {
  projectAnalysisActivityDelta,
  projectAnalysisActivitySnapshot,
  projectAnalysisRunFinished,
  projectAnalysisRunInterrupted,
  projectAnalysisRunStarted,
  projectAnalysisStateDelta,
  projectAnalysisStateSnapshot,
  projectAnalysisStepFinished,
  projectAnalysisStepStarted,
  projectAnalysisText,
  projectAnalysisToolCallLifecycle,
  projectAnalysisToolCallResult,
} from "../packages/ag-ui-analysis-adapter/src/index.js";
import {
  ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
  assertAnalysisPublicArgsNonDisclosure,
  assertAnalysisPublicPatchNonDisclosure,
  toolInteractionDescriptorSchema,
  type ToolInteractionDescriptor,
} from "../packages/analysis-contract/src/index.js";
import {
  parseSacsAgUiToolResultContent,
  SACS_AG_UI_V03_PROFILE_ID,
  assertSacsAgUiEvent,
} from "../packages/ag-ui-api-contract/src/index.js";
import { hashCanonicalJson } from "../packages/world-explanation-contract/src/index.js";
import {
  analysisStateBody,
  analysisStateHash,
} from "./v05-analysis-fixtures.js";

const sha = `sha256:${"a".repeat(64)}`;

describe("AG-UI v0.3 analysis projection", () => {
  it("projects official Run, Step, ToolCall, Activity, State and Text events", () => {
    const state = analysisStateBody({
      threadId: "thread-1",
      focus: "vehicle-1",
    });
    const nextState = analysisStateBody({
      threadId: "thread-1",
      focus: "vehicle-2",
    });
    const events = [
      projectAnalysisRunStarted({ threadId: "thread-1", runId: "run-1" }),
      projectAnalysisStepStarted({ stepName: "WORLD_GEOMETRY" }),
      ...projectAnalysisToolCallLifecycle({ descriptor: descriptor() }),
      projectAnalysisToolCallResult({
        toolCallId: "tool-1",
        messageId: "tool-result-1",
        status: "COMPLETED",
        summary: "Found two published features.",
        analysisId: "analysis-1",
        revisionId: "revision-1",
        runId: "run-1",
        nodeId: "node-1",
        findingIds: ["finding-1"],
        layerIds: ["layer-1"],
        evidenceItemIds: ["evidence-1"],
      }),
      projectAnalysisActivitySnapshot({
        messageId: "activity-1",
        activityRevision: 1,
        content: { nodesById: { "node-1": { status: "RUNNING" } } },
      }),
      projectAnalysisActivityDelta({
        messageId: "activity-1",
        expectedActivityRevision: 1,
        nextActivityRevision: 2,
        patch: [
          {
            op: "replace",
            path: "/nodesById/node-1/status",
            value: "COMPLETED",
          },
        ],
      }),
      projectAnalysisStateSnapshot({
        stateRevision: 4,
        state,
      }),
      projectAnalysisStateDelta({
        expectedStateRevision: 4,
        nextStateRevision: 5,
        nextSnapshotHash: analysisStateHash(5, nextState),
        operations: [
          {
            op: "replace",
            path: "/conversation/focus",
            value: "vehicle-2",
          },
        ],
      }),
      ...projectAnalysisText({
        messageId: "analysis-text-1",
        text: "Analysis completed.",
      }),
      projectAnalysisStepFinished({ stepName: "WORLD_GEOMETRY" }),
      projectAnalysisRunFinished({ threadId: "thread-1", runId: "run-1" }),
    ];

    for (const event of events) {
      expect(() => EventSchemas.parse(event)).not.toThrow();
      expect(() =>
        assertSacsAgUiEvent(event, SACS_AG_UI_V03_PROFILE_ID),
      ).not.toThrow();
    }
    expect(events.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        EventType.RUN_STARTED,
        EventType.STEP_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.TOOL_CALL_RESULT,
        EventType.ACTIVITY_SNAPSHOT,
        EventType.ACTIVITY_DELTA,
        EventType.STATE_SNAPSHOT,
        EventType.STATE_DELTA,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.STEP_FINISHED,
        EventType.RUN_FINISHED,
      ]),
    );
  });

  it("puts the state revision test first and reserves revision mutation", () => {
    const nextState = analysisStateBody({
      threadId: "thread-1",
      focus: "vehicle-2",
    });
    const nextSnapshotHash = analysisStateHash(9, nextState);
    const delta = projectAnalysisStateDelta({
      expectedStateRevision: 8,
      nextStateRevision: 9,
      nextSnapshotHash,
      operations: [
        { op: "add", path: "/conversation/focus", value: "vehicle-2" },
      ],
    });
    expect(delta).toMatchObject({
      type: EventType.STATE_DELTA,
      delta: [
        { op: "test", path: "/meta/stateRevision", value: 8 },
        {
          op: "add",
          path: "/conversation/focus",
          value: "vehicle-2",
        },
        { op: "replace", path: "/meta/snapshotHash", value: nextSnapshotHash },
        { op: "replace", path: "/meta/stateRevision", value: 9 },
      ],
    });
    expect(() =>
      projectAnalysisStateDelta({
        expectedStateRevision: 8,
        nextStateRevision: 9,
        nextSnapshotHash,
        operations: [{ op: "replace", path: "/meta/stateRevision", value: 99 }],
      }),
    ).toThrow("AG_UI_STATE_REVISION_PATCH_RESERVED");
  });

  it("publishes complete snapshots before an official interrupt outcome", () => {
    const events = projectAnalysisRunInterrupted({
      identity: { threadId: "thread-1", runId: "run-1" },
      stateRevision: 3,
      state: analysisStateBody({ threadId: "thread-1" }),
      activityMessageId: "activity-1",
      activityRevision: 5,
      activity: {
        nodesById: { "node-1": { status: "WAITING_INTERVENTION" } },
      },
      interrupts: [
        {
          id: "intervention-1",
          reason: "AMBIGUITY",
          message: "Choose one published candidate.",
        },
      ],
    });

    expect(events.map(({ type }) => type)).toEqual([
      EventType.STATE_SNAPSHOT,
      EventType.ACTIVITY_SNAPSHOT,
      EventType.RUN_FINISHED,
    ]);
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      threadId: "thread-1",
      runId: "run-1",
      outcome: {
        type: "interrupt",
        interrupts: [{ id: "intervention-1", reason: "AMBIGUITY" }],
      },
    });
  });

  it("exposes only bounded result summaries/IDs and public tool args", () => {
    const result = projectAnalysisToolCallResult({
      toolCallId: "tool-1",
      messageId: "result-1",
      status: "PARTIAL",
      summary: "Published result summary.",
      analysisId: "analysis-1",
      revisionId: "revision-1",
      runId: "run-1",
      nodeId: "node-1",
      findingIds: [],
      layerIds: [],
      evidenceItemIds: [],
    });
    if (result.type !== EventType.TOOL_CALL_RESULT) {
      throw new Error("expected ToolCallResult");
    }
    const content = parseSacsAgUiToolResultContent(result.content);
    expect(content).toEqual(
      expect.objectContaining({
        summary: "Published result summary.",
        analysisId: "analysis-1",
        nodeId: "node-1",
      }),
    );
    expect(JSON.stringify(content)).not.toMatch(
      /geometry|provider|endpoint|executionArgs|dataScope/iu,
    );

    const unsafe = uncheckedDescriptor({ provider: "private-provider" });
    expect(() =>
      projectAnalysisToolCallLifecycle({ descriptor: unsafe }),
    ).toThrow(ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION);
  });

  it.each([
    { auth: "credential-material" },
    { encryptionKey: "credential-material" },
    { passphrase: "credential-material" },
    { nested: { apiKey: "credential-material" } },
    { nested: { sourceAuthority: "server-owned" } },
    { note: "Authorization: Bearer credential-material" },
    { note: "cookie=session-material" },
    { note: "postgresql://db-user:db-password@database.internal/results" },
    { source: "file:///srv/private/result.tif" },
    { source: "http://example.com/private/result.tif" },
    { source: "https://tiles.internal/private/result.tif" },
    { source: "https://localhost./private/result.tif" },
    { source: "https://service.namespace.svc/private/result.tif" },
    { source: "https://127.0.0.1/private/result.tif" },
    { source: "https://0x7f000001/private/result.tif" },
    { source: "https://[::ffff:127.0.0.1]/private/result.tif" },
  ])(
    "rejects disclosure-bearing public arguments with a stable error",
    (publicArgs) => {
      const unsafe = uncheckedDescriptor(publicArgs);
      try {
        projectAnalysisToolCallLifecycle({ descriptor: unsafe });
        throw new Error("expected non-disclosure rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(
          ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
        );
        expect((error as Error).message).not.toContain("credential-material");
        expect((error as Error).message).not.toContain("/srv/private");
      }
    },
  );

  it("enforces non-disclosure at the trusted descriptor boundary", () => {
    const unsafe = uncheckedDescriptor({
      nested: { accessToken: "credential-material" },
    });
    expect(() => toolInteractionDescriptorSchema.parse(unsafe)).toThrow(
      ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
    );
    expect(() =>
      toolInteractionDescriptorSchema.parse(
        uncheckedDescriptor({
          source: "https://example.com/public/result.json",
          keyboardLayout: "qwerty",
          keyframeCount: 4,
        }),
      ),
    ).not.toThrow();
  });

  it("rejects sensitive JSON Pointer tokens before a public patch is durable", () => {
    for (const path of ["/auth", "/nested/encryptionKey", "/passphrase"]) {
      expect(() =>
        assertAnalysisPublicPatchNonDisclosure([
          { op: "replace", path, value: "credential-material" },
        ]),
      ).toThrow(ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION);
    }
    expect(() =>
      assertAnalysisPublicPatchNonDisclosure([
        { op: "replace", path: "/keyboardLayout", value: "qwerty" },
        { op: "replace", path: "/keyframeCount", value: 4 },
      ]),
    ).not.toThrow();
  });

  it("does not echo hostile input through non-disclosure errors", () => {
    const hostile = new Proxy<Record<string, unknown>>(
      {},
      {
        ownKeys: () => {
          throw new Error("credential-material-from-hostile-input");
        },
      },
    );
    try {
      assertAnalysisPublicArgsNonDisclosure(hostile);
      throw new Error("expected non-disclosure rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
      );
    }
  });
});

function descriptor(
  publicArgs: Record<string, unknown> = { radiusM: 600 },
): ToolInteractionDescriptor {
  return toolInteractionDescriptorSchema.parse({
    schemaVersion: "sacs-wsgs-tool-interaction/1.0",
    toolCallId: "tool-1",
    nodeId: "node-1",
    operationKey: "geometry.buffer@1.0",
    executionArgsHash: sha,
    publicArgs,
    publicArgsHash: hashCanonicalJson(publicArgs),
    publicEditSchemaUri: "urn:wsgs:public-edit:buffer:1.0",
    publicEditSchemaHash: sha,
    editablePaths: ["/radiusM"],
    editorHints: [
      { path: "/radiusM", editor: "MAP_RADIUS", unit: "m", minimum: 1 },
    ],
    editSemantics: "CHANGE_CONSTRAINT",
    editPolicy: "SUGGEST_NEXT_REVISION",
  });
}

function uncheckedDescriptor(
  publicArgs: Record<string, unknown>,
): ToolInteractionDescriptor {
  return {
    ...descriptor(),
    publicArgs,
    publicArgsHash: hashCanonicalJson(publicArgs),
  };
}
