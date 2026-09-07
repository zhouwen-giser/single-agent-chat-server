import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  AnalysisSourceError,
  parseWritableAnalysisSource,
  verifySourceRequest,
  parseGroundingContractIdentity,
  sourceIsTerminal,
  type AnalysisSourceAdapter,
  type AnalysisSourceIdentity,
  type AnalysisSourceSnapshot,
  type StartWorldAnalysisRequest,
  type AnalysisSourceEvent,
} from "../../analysis-contract/src/source.js";
import { hashCanonicalJson } from "../../world-explanation-contract/src/index.js";
import {
  WsgsHttpError,
  type WsgsHttpClient,
  type WsgsGroundingJob,
  type WsgsGroundingResult,
} from "../../wsgs-http-adapter/src/index.js";

const bounds = z.strictObject({
  pollIntervalMs: z.number().int().min(10).max(30_000).default(500),
  maxDurationMs: z.number().int().min(10).max(600_000).default(120_000),
  maxConsecutiveFailures: z.number().int().min(1).max(10).default(3),
});
/** Grounding Job transport only. Durable replay/scoping is owned by persistence. */
export class GroundingJobAnalysisSourceAdapter implements AnalysisSourceAdapter {
  readonly mode = "WSGS_GROUNDING_JOB" as const;
  readonly productionEligible = true;
  readonly limits;
  constructor(
    readonly client: WsgsHttpClient,
    options: z.input<typeof bounds> = {},
    private readonly onPoll?: (succeeded: boolean) => Promise<void>,
  ) {
    if (
      !["sacs-wsgs-grounding/1.1", "sacs-wsgs-grounding/1.2"].includes(
        client.contractVersion,
      )
    )
      throw new AnalysisSourceError("ANALYSIS_SOURCE_TRANSPORT_UNAVAILABLE");
    this.limits = bounds.parse(options);
  }
  async capabilities(signal?: AbortSignal) {
    const value = await this.client.capabilities(signal);
    if ("worldAnalysis" in value)
      return {
        requiredReady: value.requiredCapabilitiesReady,
        optionalAvailable: value.worldAnalysis.capabilities
          .filter((c) => c.supported && c.available)
          .map((c) => c.capability),
        optionalUnavailable: value.worldAnalysis.capabilities
          .filter((c) => !c.available)
          .map((c) => ({
            operationId: c.capability,
            reasonCode: c.reasonCodes[0]!,
            reasonCodes: c.reasonCodes,
          })),
        worldAnalysis: value.worldAnalysis,
        nativeReady: false,
        nativeReasonCode: "SACS_WSGS_NATIVE_ANALYSIS_CONTROL_DEFERRED" as const,
      };
    return {
      requiredReady: value.requiredCapabilitiesReady,
      optionalAvailable: (value.optionalCapabilities ?? [])
        .filter((c) => c.available)
        .map((c) => c.operationId),
      optionalUnavailable: (value.optionalCapabilities ?? [])
        .filter((c) => !c.available)
        .map((c) => ({
          operationId: c.operationId,
          reasonCode: "OPTIONAL_CAPABILITY_UNAVAILABLE" as const,
        })),
      nativeReady: false,
      nativeReasonCode: "SACS_WSGS_NATIVE_ANALYSIS_CONTROL_DEFERRED" as const,
    };
  }
  async start(
    request: StartWorldAnalysisRequest,
  ): Promise<AnalysisSourceSnapshot> {
    verifySourceRequest(request);
    const contractIdentity = parseGroundingContractIdentity(
      request.contractIdentity ?? {
        contractVersion: this.client.contractVersion,
        resultProfile:
          this.client.contractVersion === "sacs-wsgs-grounding/1.2"
            ? "wsgs-world-analysis-findings/1.0"
            : "sacs-wsgs-geospatial-findings/1.0",
      },
    );
    if (contractIdentity.contractVersion !== this.client.contractVersion)
      throw new AnalysisSourceError(
        "ANALYSIS_SOURCE_CONTRACT_IDENTITY_INVALID",
      );
    request.signal?.throwIfAborted();
    const value = await this.client.createGrounding(
      request.canonicalGroundingRequest,
      request.idempotencyKey,
      request.signal,
    );
    if (value.requestId !== request.requestId)
      throw new AnalysisSourceError(
        "ANALYSIS_SOURCE_RESPONSE_CONTRACT_VIOLATION",
      );
    return this.snapshot(value, {
      kind: this.mode,
      sourceId: value.groundingId,
      sourceHash: request.requestHash,
      contractIdentity,
      requestId: request.requestId,
      messageId: request.canonicalGroundingRequest.source.messageId,
      originalTextSha256:
        request.canonicalGroundingRequest.source.originalTextSha256,
      maxResultBytes:
        request.canonicalGroundingRequest.executionPolicy.maxResultBytes,
      ...("jobId" in value ? { upstreamRunId: value.jobId } : {}),
    });
  }
  async get(
    value: AnalysisSourceIdentity,
    signal?: AbortSignal,
  ): Promise<AnalysisSourceSnapshot> {
    const identity = this.identity(value);
    signal?.throwIfAborted();
    return this.snapshot(
      await this.client.getGrounding(
        identity.sourceId,
        signal,
        identity.maxResultBytes,
      ),
      identity,
    );
  }
  async *observe(
    input: Parameters<AnalysisSourceAdapter["observe"]>[0],
  ): AsyncIterable<AnalysisSourceEvent> {
    const identity = this.identity(input.identity);
    const started = Date.now();
    let previous = input.after;
    let failures = 0;
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.limits.maxDurationMs),
      ...(input.signal ? [input.signal] : []),
    ]);
    while (Date.now() - started < this.limits.maxDurationMs) {
      input.signal?.throwIfAborted();
      let snapshot: AnalysisSourceSnapshot;
      try {
        snapshot = await this.get(identity, signal);
      } catch (error) {
        input.signal?.throwIfAborted();
        if (!(error instanceof WsgsHttpError) || !error.retryable) throw error;
        await this.onPoll?.(false);
        if (++failures >= this.limits.maxConsecutiveFailures)
          throw new AnalysisSourceError(
            "ANALYSIS_SOURCE_OBSERVATION_LIMIT_EXCEEDED",
          );
        try {
          await delay(this.limits.pollIntervalMs, undefined, { signal });
        } catch (error) {
          input.signal?.throwIfAborted();
          if (signal.aborted) break;
          throw error;
        }
        continue;
      }
      // Persistence errors are not transport failures and must stop this owner.
      await this.onPoll?.(true);
      failures = 0;
      const eventId = hashCanonicalJson({
        identity: snapshot.identity,
        status: snapshot.sourceStatus,
        resultHash: snapshot.resultHash ?? null,
        terminal: snapshot.terminal,
      });
      if (eventId !== previous) {
        previous = eventId;
        yield {
          ...snapshot,
          eventId,
          analysisId: input.analysisId,
          revisionId: input.revisionId,
          runId: input.runId,
        };
      }
      if (snapshot.terminal) return;
      try {
        await delay(this.limits.pollIntervalMs, undefined, { signal });
      } catch (error) {
        input.signal?.throwIfAborted();
        if (signal.aborted) break;
        throw error;
      }
    }
    throw new AnalysisSourceError("ANALYSIS_SOURCE_OBSERVATION_LIMIT_EXCEEDED");
  }
  async cancel(
    input: Parameters<AnalysisSourceAdapter["cancel"]>[0],
  ): Promise<AnalysisSourceSnapshot> {
    const identity = this.identity(input.identity);
    input.signal?.throwIfAborted();
    return this.snapshot(
      await this.client.cancelGrounding(
        identity.sourceId,
        input.signal,
        identity.maxResultBytes,
      ),
      identity,
    );
  }
  revise(request: StartWorldAnalysisRequest) {
    return this.start(request);
  }
  resolveChoice(request: StartWorldAnalysisRequest) {
    return this.start(request);
  }
  private identity(value: AnalysisSourceIdentity) {
    const identity = parseWritableAnalysisSource(value);
    if (identity.kind !== this.mode)
      throw new AnalysisSourceError("ANALYSIS_SOURCE_IDENTITY_INVALID");
    if (
      (identity.contractIdentity &&
        identity.contractIdentity.contractVersion !==
          this.client.contractVersion) ||
      (this.client.contractVersion === "sacs-wsgs-grounding/1.2" &&
        (!identity.contractIdentity ||
          !identity.requestId ||
          !identity.messageId ||
          !identity.originalTextSha256 ||
          !identity.maxResultBytes))
    )
      throw new AnalysisSourceError(
        "ANALYSIS_SOURCE_CONTRACT_IDENTITY_INVALID",
      );
    return identity;
  }
  private snapshot(
    value: WsgsGroundingJob | WsgsGroundingResult,
    identity: AnalysisSourceIdentity,
  ): AnalysisSourceSnapshot {
    const source = this.identity(identity);
    const result =
      "jobId" in value ? ("result" in value ? value.result : undefined) : value;
    if (
      value.groundingId !== source.sourceId ||
      (source.requestId !== undefined &&
        value.requestId !== source.requestId) ||
      (result &&
        source.messageId !== undefined &&
        (result.source.messageId !== source.messageId ||
          result.source.originalTextSha256 !== source.originalTextSha256)) ||
      ("jobId" in value &&
        source.upstreamRunId !== undefined &&
        value.jobId !== source.upstreamRunId) ||
      (result &&
        (result.groundingId !== source.sourceId ||
          result.requestId !== value.requestId ||
          result.status !== value.status))
    )
      throw new AnalysisSourceError(
        "ANALYSIS_SOURCE_RESPONSE_CONTRACT_VIOLATION",
      );
    return {
      identity: source,
      sourceStatus: value.status,
      terminal: sourceIsTerminal(value.status),
      observedAt: new Date().toISOString(),
      ...(result ? { result, resultHash: result.resultHash } : {}),
    };
  }
}
