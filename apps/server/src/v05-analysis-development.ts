import type { FastifyInstance, FastifyServerOptions } from "fastify";
import { z } from "zod";

import {
  createDevelopmentAnalysisAgUiV03RunHandler,
  projectAnalysisActivitySnapshot,
  projectAnalysisRunFinished,
  projectAnalysisRunInterrupted,
  projectAnalysisRunStarted,
  projectAnalysisStateSnapshot,
  projectAnalysisStepFinished,
  projectAnalysisStepStarted,
  projectAnalysisText,
  projectAnalysisToolCallLifecycle,
  projectAnalysisToolCallResult,
} from "../../../packages/ag-ui-analysis-adapter/src/index.js";
import type { AgUiRunHandler } from "../../../packages/ag-ui-interaction-adapter/src/index.js";
import type {
  AgUiSharedStateV03,
  AnalysisProjection,
  AnalysisRevision,
  AnalysisRun,
  AnalysisSession,
} from "../../../packages/analysis-contract/src/index.js";
import type { AnalysisControlService } from "../../../packages/analysis-control-runtime/src/index.js";
import {
  createAnalysisDevelopmentRuntime,
  type AnalysisDevelopmentPumpStatus,
} from "../../../packages/analysis-development-runtime/src/index.js";
import type { PersistenceRuntime } from "../../../packages/persistence/src/index.js";
import {
  FixtureWsgsAnalysisAdapter,
  type FixtureWsgsAnalysisScenario,
  type WsgsAnalysisPlanSnapshot,
} from "../../../packages/wsgs-analysis-adapter/src/index.js";
import { buildServer } from "./bootstrap.js";
import type { AnalysisAdapterEnvironment, ServerConfig } from "./config.js";
import { SecureTelemetry } from "./observability/telemetry.js";

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

const developmentDirectiveSchema = z
  .object({
    analysisId: identifier,
    groundingId: identifier,
    scenario: z.enum(["SUCCESS", "AMBIGUITY", "DATA_GAP"]),
    mode: z.enum(["START", "RECONNECT"]),
  })
  .strict();

export type AnalysisDevelopmentDirective = z.infer<
  typeof developmentDirectiveSchema
>;

export interface AnalysisDevelopmentStartInput {
  readonly analysisId: string;
  readonly groundingId: string;
  readonly principalId: string;
  readonly threadId: string;
  readonly title: string;
  readonly scenario: FixtureWsgsAnalysisScenario;
  readonly runId: string;
}

export interface AnalysisDevelopmentStartResult {
  readonly session: AnalysisSession;
  readonly revision: AnalysisRevision;
  readonly run: AnalysisRun;
  readonly projection: AnalysisProjection;
  readonly sourceSnapshot: WsgsAnalysisPlanSnapshot;
}

export interface AnalysisDevelopmentObservation {
  readonly kind: "SNAPSHOT" | "EVENT";
  readonly snapshot: AgUiSharedStateV03;
  readonly activity: Readonly<Record<string, unknown>>;
  readonly projection: AnalysisProjection;
}

/**
 * Narrow application boundary used by the development HTTP composition. It is
 * deliberately expressed without client messages, state, tools, or publicArgs,
 * so none of those values can cross into the fixture adapter by accident.
 */
export interface AnalysisDevelopmentRuntimePort {
  readonly analysisControl: AnalysisControlService;
  startAnalysis(
    input: AnalysisDevelopmentStartInput,
  ): Promise<AnalysisDevelopmentStartResult>;
  getSnapshot(input: {
    readonly analysisId: string;
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<AgUiSharedStateV03 | undefined>;
  getProjection(input: {
    readonly analysisId: string;
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<AnalysisProjection | undefined>;
  ensureAnalysisPump(input: {
    readonly analysisId: string;
    readonly principalId: string;
    readonly threadId: string;
  }): Promise<AnalysisDevelopmentPumpStatus>;
  observeAnalysis(input: {
    readonly analysisId: string;
    readonly principalId: string;
    readonly threadId: string;
  }): AsyncIterable<AnalysisDevelopmentObservation>;
}

export interface V05AnalysisDevelopmentServerOptions {
  readonly config: ServerConfig;
  readonly persistence: PersistenceRuntime;
  readonly environment: AnalysisAdapterEnvironment & {
    readonly nodeEnv: "test" | "development";
    readonly adapterMode: "fixture";
  };
  readonly adapter?: FixtureWsgsAnalysisAdapter;
  readonly logger?: FastifyServerOptions["logger"];
  readonly httpNow?: () => number;
  readonly runtimeNow?: () => string;
  readonly runtimeNextId?: (kind: "revision" | "run") => string;
}

export interface V05AnalysisDevelopmentServer {
  readonly server: FastifyInstance;
  readonly adapter: FixtureWsgsAnalysisAdapter;
  readonly runtime: AnalysisDevelopmentRuntimePort;
}

export function parseAnalysisDevelopmentDirective(
  value: unknown,
): AnalysisDevelopmentDirective {
  return developmentDirectiveSchema.parse(value);
}

export function createAnalysisDevelopmentAgUiRunHandler(
  runtime: AnalysisDevelopmentRuntimePort,
): AgUiRunHandler {
  return async function* runAnalysis(context) {
    const directive = parseAnalysisDevelopmentDirective(
      context.input.forwardedProps,
    );
    const runId = identifier.parse(context.input.runId);
    const scope = {
      analysisId: directive.analysisId,
      principalId: context.principalId,
      threadId: context.internalThreadId,
    };
    const identity = {
      threadId: context.input.threadId,
      runId,
      ...(context.input.parentRunId === undefined
        ? {}
        : { parentRunId: identifier.parse(context.input.parentRunId) }),
    };

    if (directive.mode === "RECONNECT") {
      const projection = await runtime.getProjection(scope);
      if (projection === undefined) throw new Error("ANALYSIS_NOT_FOUND");
      if (projection.analysisId !== directive.analysisId) {
        throw new Error("ANALYSIS_DEVELOPMENT_SCOPE_MISMATCH");
      }
      const snapshot = projection.state as AgUiSharedStateV03;
      assertSnapshotScope(snapshot, directive, context);
      if (context.signal.aborted) return;
      const pump = await runtime.ensureAnalysisPump(scope);
      if (context.signal.aborted) return;
      yield projectAnalysisRunStarted(identity);
      yield projectAnalysisStateSnapshot({
        stateRevision: snapshot.meta.stateRevision,
        state: snapshot,
      });
      yield projectAnalysisActivitySnapshot({
        messageId: activityMessageId(directive.analysisId),
        activityRevision: projection.activityRevision,
        content: projection.activity,
      });
      let lastPublishedRevision = snapshot.meta.stateRevision;
      let lastPublishedActivityRevision = projection.activityRevision;
      if (!(
        pump.state === "STOPPED" &&
        (pump.stopReason === "DURABLE_TERMINAL" ||
          pump.stopReason === "TERMINAL_EVENT")
      )) {
        for await (const observation of runtime.observeAnalysis(scope)) {
          if (context.signal.aborted) return;
          assertSnapshotScope(observation.snapshot, directive, context);
          if (
            observation.snapshot.meta.stateRevision === lastPublishedRevision &&
            observation.projection.activityRevision ===
              lastPublishedActivityRevision
          ) {
            continue;
          }
          lastPublishedRevision = observation.snapshot.meta.stateRevision;
          lastPublishedActivityRevision =
            observation.projection.activityRevision;
          yield projectAnalysisStateSnapshot({
            stateRevision: observation.snapshot.meta.stateRevision,
            state: observation.snapshot,
          });
          yield projectAnalysisActivitySnapshot({
            messageId: activityMessageId(directive.analysisId),
            activityRevision: observation.projection.activityRevision,
            content: observation.activity,
          });
        }
      }
      yield projectAnalysisRunFinished(identity);
      return;
    }

    const started = await runtime.startAnalysis({
      ...scope,
      groundingId: directive.groundingId,
      title: `Fixture analysis ${directive.analysisId}`,
      scenario: directive.scenario,
      runId,
    });
    assertStartedScope(started, directive, context, runId);
    if (context.signal.aborted) return;

    yield projectAnalysisRunStarted(identity);
    yield projectAnalysisStateSnapshot({
      stateRevision: started.projection.stateRevision,
      state: started.projection.state,
    });
    yield projectAnalysisActivitySnapshot({
      messageId: activityMessageId(directive.analysisId),
      activityRevision: started.projection.activityRevision,
      content: started.projection.activity,
    });

    const interrupting = directive.scenario === "AMBIGUITY";
    const stepName = interrupting
      ? "REFERENCE_GROUNDING"
      : "GEOSPATIAL_PRODUCT_QUERY";
    yield projectAnalysisStepStarted({ stepName });

    const descriptor = started.sourceSnapshot.toolInteractions[0];
    if (!interrupting) {
      if (descriptor === undefined) {
        throw new Error("ANALYSIS_TOOL_INTERACTION_MISSING");
      }
      yield* projectAnalysisToolCallLifecycle({ descriptor });
    }

    let latest = started.projection.state as AgUiSharedStateV03;
    let latestActivity = started.projection.activity;
    let latestActivityRevision = started.projection.activityRevision;
    let lastPublishedRevision = started.projection.stateRevision;
    let lastPublishedActivityRevision = started.projection.activityRevision;
    for await (const observation of runtime.observeAnalysis(scope)) {
      if (context.signal.aborted) return;
      latest = observation.snapshot;
      latestActivity = observation.activity;
      latestActivityRevision = observation.projection.activityRevision;
      assertSnapshotScope(latest, directive, context);
      if (
        latest.meta.stateRevision === lastPublishedRevision &&
        latestActivityRevision === lastPublishedActivityRevision
      ) {
        continue;
      }
      lastPublishedRevision = latest.meta.stateRevision;
      lastPublishedActivityRevision = latestActivityRevision;
      yield projectAnalysisStateSnapshot({
        stateRevision: latest.meta.stateRevision,
        state: latest,
      });
      yield projectAnalysisActivitySnapshot({
        messageId: activityMessageId(directive.analysisId),
        activityRevision: latestActivityRevision,
        content: latestActivity,
      });
    }

    if (interrupting) {
      const intervention = latest.pendingIntervention;
      if (intervention === undefined || intervention.reason !== "AMBIGUITY") {
        throw new Error("ANALYSIS_AMBIGUITY_INTERVENTION_MISSING");
      }
      yield* projectAnalysisRunInterrupted({
        identity,
        stateRevision: latest.meta.stateRevision,
        state: latest,
        activityMessageId: activityMessageId(directive.analysisId),
        activityRevision: latestActivityRevision,
        activity: latestActivity,
        interrupts: [
          {
            id: intervention.interruptId,
            reason: "AMBIGUITY",
            message: "Choose one of the published candidates.",
          },
        ],
      });
      return;
    }

    if (descriptor === undefined) {
      throw new Error("ANALYSIS_TOOL_INTERACTION_MISSING");
    }
    const dataGap = directive.scenario === "DATA_GAP";
    const completedRun = latest.analysis.runsById[started.run.runId];
    if (
      completedRun === undefined ||
      (dataGap
        ? completedRun.status !== "PARTIAL"
        : completedRun.status !== "SUCCEEDED")
    ) {
      throw new Error("ANALYSIS_TERMINAL_STATUS_MISMATCH");
    }
    const completedNode = latest.analysis.nodesById[descriptor.nodeId];
    const layerIds = Object.values(latest.map.layersById)
      .filter((layer) => layer.nodeId === descriptor.nodeId)
      .map((layer) => layer.layerId);
    yield projectAnalysisToolCallResult({
      toolCallId: descriptor.toolCallId,
      messageId: `${runId}:tool-result`,
      status: dataGap ? "NO_DATA" : "COMPLETED",
      summary: dataGap
        ? "The published result is a DATA_GAP; truth remains unknown."
        : "The published fixture geospatial result is available.",
      analysisId: directive.analysisId,
      revisionId: started.revision.revisionId,
      runId: started.run.runId,
      nodeId: descriptor.nodeId,
      findingIds: completedNode?.findingIds ?? [],
      layerIds,
      evidenceItemIds: [],
    });
    yield* projectAnalysisText({
      messageId: `${runId}:assistant`,
      text: dataGap
        ? "The analysis completed partially because the source reported a DATA_GAP. The answer remains unknown; no contrary fact is implied."
        : "The read-only analysis completed from the published fixture result.",
    });
    yield projectAnalysisStepFinished({ stepName });
    yield projectAnalysisRunFinished(identity);
  };
}

export function createV05AnalysisDevelopmentServer(
  options: V05AnalysisDevelopmentServerOptions,
): V05AnalysisDevelopmentServer {
  assertFixtureEnvironment(options.environment);
  const adapter =
    options.adapter ??
    new FixtureWsgsAnalysisAdapter({
      environment: {
        NODE_ENV: options.environment.nodeEnv,
        SACS_ANALYSIS_ADAPTER_MODE: options.environment.adapterMode,
      },
    });
  const runtime: AnalysisDevelopmentRuntimePort =
    createAnalysisDevelopmentRuntime({
      repository: options.persistence.analysisDevelopmentRepository,
      adapter,
      environment: options.environment,
      ...(options.runtimeNow === undefined ? {} : { now: options.runtimeNow }),
      ...(options.runtimeNextId === undefined
        ? {}
        : { nextId: options.runtimeNextId }),
    });
  const telemetry = new SecureTelemetry();
  const runAgUiV03 = createDevelopmentAnalysisAgUiV03RunHandler(
    createAnalysisDevelopmentAgUiRunHandler(runtime),
    {
      environment: options.environment,
      fixture: adapter.manifest,
      analysisControlReady: true,
    },
  );
  const server = buildServer({
    config: options.config,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    telemetry,
    readinessCheck: () => options.persistence.readiness(),
    resolveChatThread: (input) =>
      options.persistence.repository.getOrCreateThread(input),
    resolveAgUiThread: async (input) => {
      const principal =
        await options.persistence.interactionRepository.resolvePrincipal({
          issuer: "openwebui-jwt",
          subject: input.userId,
          role: input.userRole,
        });
      return options.persistence.interactionRepository.getOrCreateThread({
        clientType: "ag_ui",
        externalThreadId: input.externalThreadId,
        principalId: principal.principalId,
      });
    },
    runAgUiV03,
    analysisControl: runtime.analysisControl,
    saveSelection: (selection, now) =>
      options.persistence.structuredWorldSelectionRepository.saveOrReplay(
        selection,
        now,
      ),
    findSelection: (scope, selectionId, now) =>
      options.persistence.structuredWorldSelectionRepository.findActive(
        scope,
        selectionId,
        now,
      ),
    ...(options.httpNow === undefined ? {} : { now: options.httpNow }),
  });
  server.addHook("onClose", async () => options.persistence.close());
  return { server, adapter, runtime };
}

function assertFixtureEnvironment(
  environment: AnalysisAdapterEnvironment,
): asserts environment is AnalysisAdapterEnvironment & {
  readonly nodeEnv: "test" | "development";
  readonly adapterMode: "fixture";
} {
  if (
    !["test", "development"].includes(environment.nodeEnv) ||
    environment.adapterMode !== "fixture"
  ) {
    throw new Error("SACS_ANALYSIS_DEVELOPMENT_COMPOSITION_FORBIDDEN");
  }
}

function assertStartedScope(
  started: AnalysisDevelopmentStartResult,
  directive: AnalysisDevelopmentDirective,
  context: Parameters<AgUiRunHandler>[0],
  runId: string,
): void {
  if (
    started.session.analysisId !== directive.analysisId ||
    started.session.groundingId !== directive.groundingId ||
    started.session.principalId !== context.principalId ||
    started.session.threadId !== context.internalThreadId ||
    started.revision.analysisId !== directive.analysisId ||
    started.run.runId !== runId ||
    started.run.revisionId !== started.revision.revisionId ||
    started.sourceSnapshot.scenario !== directive.scenario
  ) {
    throw new Error("ANALYSIS_DEVELOPMENT_SCOPE_MISMATCH");
  }
}

function assertSnapshotScope(
  snapshot: AgUiSharedStateV03,
  directive: AnalysisDevelopmentDirective,
  context: Parameters<AgUiRunHandler>[0],
): void {
  if (
    snapshot.analysis.session.analysisId !== directive.analysisId ||
    snapshot.analysis.session.groundingId !== directive.groundingId ||
    snapshot.analysis.session.principalId !== context.principalId ||
    snapshot.analysis.session.threadId !== context.internalThreadId
  ) {
    throw new Error("ANALYSIS_DEVELOPMENT_SCOPE_MISMATCH");
  }
}

function activityMessageId(analysisId: string): string {
  return `${analysisId}:activity`;
}
