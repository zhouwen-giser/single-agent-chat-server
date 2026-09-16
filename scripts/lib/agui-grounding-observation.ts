import { createHash, randomBytes } from "node:crypto";
import { parseServerConfig } from "../../apps/server/src/config.js";
import {
  HeadlessAnalysisReferenceClient,
  HeadlessMapEngineAdapter,
} from "../../packages/analysis-client/src/index.js";
import { parseAndVerifyAgUiSharedStateV03 } from "../../packages/analysis-contract/src/index.js";
import {
  groundingActivityMessageId,
  groundingJobActivityV1Schema,
} from "../../packages/analysis-contract/src/grounding-activity.js";
import { sourceStatusMapping } from "../../packages/analysis-contract/src/source.js";
import {
  publicCanonicalHash,
  type GroundingResult12,
} from "../../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import type { WorldAnalysisViewModel } from "../../packages/world-explanation-runtime/src/analysis-view.js";

const requireCheck = (condition: unknown, code: string): void => {
  if (!condition) throw Error(code);
};
const equal = (left: unknown, right: unknown) =>
  publicCanonicalHash(JSON.parse(JSON.stringify(left))) ===
  publicCanonicalHash(JSON.parse(JSON.stringify(right)));
const hash = (value: string) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");

/** Isolated authenticated test service; keep the normal cross-protocol key rule. */
export function createAcceptanceServerConfig(agUiSecret: string) {
  return parseServerConfig({
    CHAT_SERVER_SERVICE_KEY: randomBytes(32).toString("hex"),
    AG_UI_SERVICE_KEY: agUiSecret,
    OPENWEBUI_USER_JWT_SECRET: agUiSecret,
    CHAT_SERVER_REQUEST_TIMEOUT_MS: "120000",
    CHAT_HTTP_STREAM_BUDGET_MS: "120000",
    LOG_LEVEL: "silent",
  });
}

/** Shared development/live oracle. No network or files; never returns raw content in summary. */
export async function verifyGroundingObservation(
  wire: string,
  result: GroundingResult12,
) {
  const events = wire
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
  requireCheck(
    events.length > 0 && events.at(-1)?.["type"] === "RUN_FINISHED",
    "RUN_NOT_FINISHED",
  );
  requireCheck(
    !events.some(
      (event) =>
        event["type"] === "RUN_ERROR" ||
        String(event["type"]).startsWith("TOOL_CALL"),
    ),
    "UNEXPECTED_ERROR_OR_TOOL_EVENT",
  );
  const state = parseAndVerifyAgUiSharedStateV03(
    events.filter((event) => event["type"] === "STATE_SNAPSHOT").at(-1)?.[
      "snapshot"
    ],
  );
  const view = state.worldExplanation as unknown as WorldAnalysisViewModel;
  requireCheck(
    view?.groundingId === result.groundingId &&
      view.source.resultHash === result.resultHash,
    "SOURCE_RESULT_IDENTITY_MISMATCH",
  );
  requireCheck(
    view.status === sourceStatusMapping[result.status].view,
    "SOURCE_STATUS_MISMATCH",
  );
  const expectedFindings = [
    ...result.worldAnalysisFindings.findings,
    ...(result.geospatialFindings?.findings ?? []),
  ];
  requireCheck(
    equal(view.findings, expectedFindings),
    "FINDINGS_NOT_PRESERVED",
  );
  requireCheck(
    result.worldAnalysisFindings.gaps.every((gap) =>
      view.typedGaps?.some((item) => equal(item, gap)),
    ),
    "GAPS_NOT_PRESERVED",
  );
  requireCheck(
    equal(
      state.map.layersById,
      Object.fromEntries(
        view.map.layers.map((layer) => [layer.layerId, layer]),
      ),
    ),
    "MAP_PROJECTION_MISMATCH",
  );
  requireCheck(
    equal(state.timeline.items, view.timeline.items) &&
      equal(state.timeline.sources, view.timeline.sources),
    "TIMELINE_PROJECTION_MISMATCH",
  );
  for (const target of view.actionTargets)
    requireCheck(
      target.executionAuthorized === false,
      "ACTION_AUTHORIZATION_FORBIDDEN",
    );
  const client = new HeadlessAnalysisReferenceClient(
    new HeadlessMapEngineAdapter(),
  );
  requireCheck(
    (await client.acceptSseChunk(wire)).length === 0,
    "CLIENT_RECOVERY_REQUIRED",
  );
  await client.finishStream();
  requireCheck(equal(client.state.sharedState, state), "CLIENT_STATE_MISMATCH");
  requireCheck(
    equal(client.mapPresentation.shared, state.map),
    "CLIENT_MAP_MISMATCH",
  );
  requireCheck(
    Object.values(client.state.textByMessageId).join("") ===
      view.summary.primaryText,
    "TEXT_PROJECTION_MISMATCH",
  );
  const id = groundingActivityMessageId({
    analysisId: state.analysis.session.analysisId,
    revisionId: state.analysis.activeRevisionId,
  });
  const activity = groundingJobActivityV1Schema.parse(
    client.state.activitiesByMessageId[id]?.content,
  );
  requireCheck(
    activity.groundingId === result.groundingId &&
      activity.sourceStatus === result.status,
    "ACTIVITY_SOURCE_MISMATCH",
  );
  requireCheck(
    Object.values(client.state.activitiesByMessageId).every(
      (a) =>
        a.activityType === "grounding.job" &&
        a.content["phase"] === undefined &&
        a.content["progress"] === undefined,
    ),
    "FABRICATED_ACTIVITY",
  );
  requireCheck(
    client.state.stepsByName["world-grounding"] === "FINISHED",
    "STEP_NOT_FINISHED",
  );
  return {
    state,
    client,
    summary: {
      httpStatus: 200,
      sourceStatus: result.status,
      businessStatus: view.status,
      findingCount: view.findings.length,
      gapCount: view.typedGaps?.length ?? 0,
      choiceCount: result.worldAnalysisFindings.choices.length,
      resultHash: result.resultHash,
      projectionHash: hash(JSON.stringify(state)),
      wireHash: hash(wire),
      groundingIdHash: hash(result.groundingId),
      revisionIdHash: hash(state.analysis.activeRevisionId),
      assertions: [
        "source-result-identity",
        "finding-gap-fidelity",
        "map-timeline-fidelity",
        "headless-hydration",
        "text-summary-fidelity",
        "truthful-activity",
        "no-tool-or-device-authorization",
      ],
    },
  };
}
