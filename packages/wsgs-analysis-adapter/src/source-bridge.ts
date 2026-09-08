import {
  AnalysisSourceError,
  parseWritableAnalysisSource,
  sourceIsTerminal,
  verifySourceRequest,
  type AnalysisSourceAdapter,
  type AnalysisSourceIdentity,
  type AnalysisSourceSnapshot,
  type AnalysisSourceEvent,
  type AnalysisSourceStatus,
  type StartWorldAnalysisRequest,
} from "../../analysis-contract/src/source.js";
import type { WsgsAnalysisAdapter } from "./index.js";

/** Retains all five Native ports. No Native transport is authorized by this bridge. */
export class PlanAnalysisSourceBridge implements AnalysisSourceAdapter {
  readonly productionEligible = false;
  constructor(
    readonly mode: "FIXTURE" | "WSGS_NATIVE_ANALYSIS",
    readonly nativePorts: WsgsAnalysisAdapter,
    environment: { nodeEnv: string },
  ) {
    if (
      mode === "FIXTURE" &&
      !["test", "development"].includes(environment.nodeEnv)
    )
      throw new AnalysisSourceError("ANALYSIS_SOURCE_MODE_INVALID");
  }
  private eligible(): void {
    if (this.mode === "WSGS_NATIVE_ANALYSIS")
      throw new AnalysisSourceError("ANALYSIS_SOURCE_TRANSPORT_UNAVAILABLE");
  }
  async start(
    request: StartWorldAnalysisRequest,
  ): Promise<AnalysisSourceSnapshot> {
    this.eligible();
    verifySourceRequest(request);
    const snapshot = await this.nativePorts.getAnalysisSnapshot(
      request.revisionId,
    );
    return {
      identity: {
        kind: "FIXTURE",
        sourceId: request.revisionId,
        sourceHash: snapshot.planHash,
        sourceRevision: snapshot.planRevision,
        upstreamRunId: snapshot.upstreamRunId,
      },
      sourceStatus: "RUNNING",
      terminal: false,
      observedAt: snapshot.generatedAt,
    };
  }
  async get(value: AnalysisSourceIdentity): Promise<AnalysisSourceSnapshot> {
    this.eligible();
    const identity = parseWritableAnalysisSource(value);
    if (identity.kind !== this.mode)
      throw new AnalysisSourceError("ANALYSIS_SOURCE_IDENTITY_INVALID");
    const snapshot = await this.nativePorts.getAnalysisSnapshot(
      identity.sourceId,
    );
    if (snapshot.planHash !== identity.sourceHash)
      throw new AnalysisSourceError("ANALYSIS_SOURCE_IDENTITY_INVALID");
    return {
      identity,
      sourceStatus: "RUNNING",
      terminal: false,
      observedAt: snapshot.generatedAt,
    };
  }
  async *observe(
    input: Parameters<AnalysisSourceAdapter["observe"]>[0],
  ): AsyncIterable<AnalysisSourceEvent> {
    const initial = await this.get(input.identity);
    for await (const event of this.nativePorts.subscribeAnalysisEvents(
      initial.identity.sourceId,
    )) {
      if (input.signal?.aborted) return;
      const sourceStatus: AnalysisSourceStatus =
        event.eventType === "ANALYSIS_COMPLETED"
          ? event.payload["status"] === "PARTIAL"
            ? "PARTIAL"
            : "COMPLETED"
          : event.eventType === "INTERVENTION_REQUIRED"
            ? "AMBIGUOUS"
            : "RUNNING";
      yield {
        ...initial,
        eventId: event.eventId,
        analysisId: input.analysisId,
        revisionId: input.revisionId,
        runId: input.runId,
        sourceStatus,
        terminal: sourceIsTerminal(sourceStatus),
      };
    }
  }
  async cancel(
    input: Parameters<AnalysisSourceAdapter["cancel"]>[0],
  ): Promise<AnalysisSourceSnapshot> {
    const snapshot = await this.get(input.identity);
    if (!snapshot.identity.upstreamRunId)
      throw new AnalysisSourceError("ANALYSIS_SOURCE_IDENTITY_INVALID");
    const result = await this.nativePorts.cancelRun({
      analysisId: snapshot.identity.sourceId,
      revisionId: snapshot.identity.sourceId,
      upstreamRunId: snapshot.identity.upstreamRunId,
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    });
    if (!result.acknowledged)
      throw new AnalysisSourceError("ANALYSIS_SOURCE_CANCEL_UNCONFIRMED");
    return { ...snapshot, sourceStatus: "CANCELLED", terminal: true };
  }
  revise(request: StartWorldAnalysisRequest) {
    return this.start(request);
  }
  resolveChoice(request: StartWorldAnalysisRequest) {
    return this.start(request);
  }
}
