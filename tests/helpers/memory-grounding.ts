import type {
  GroundingExecution,
  GroundingPersistenceRepository,
} from "../../packages/persistence/src/index.js";
import type { WorldGroundingRuntimeOptions } from "../../packages/world-grounding-runtime/src/index.js";
import { publicCanonicalHash } from "../../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import type { JsonValue } from "../../packages/persistence/src/types.js";
const json = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;
/** Test substitute at the durable storage port, not the analysis/HTTP business adapter. */
type GroundingPort = WorldGroundingRuntimeOptions["grounding"];
export class MemoryGrounding implements GroundingPort {
  readonly rows = new Map<string, GroundingExecution>();
  readonly publications: string[] = [];
  private scoped(id: string, principalId: string, threadId: string) {
    const row = this.rows.get(id);
    return row?.principalId === principalId && row.threadId === threadId
      ? row
      : undefined;
  }
  async get(input: Parameters<GroundingPersistenceRepository["get"]>[0]) {
    return this.scoped(input.groundingId, input.principalId, input.threadId);
  }
  async claim(
    input: Parameters<GroundingPersistenceRepository["claim"]>[0],
  ): ReturnType<GroundingPersistenceRepository["claim"]> {
    const prior = this.rows.get(input.groundingId);
    if (prior) {
      if (!this.scoped(input.groundingId, input.principalId, input.threadId))
        throw Error("ANALYSIS_NOT_FOUND");
      if (
        prior.requestHash !== input.requestHash ||
        publicCanonicalHash(prior.analysisIntent ?? null) !==
          publicCanonicalHash(input.analysisIntent ?? null)
      )
        throw Error("ANALYSIS_SOURCE_REPLAY_CONFLICT");
      return { kind: "REPLAY", execution: prior };
    }
    const row: GroundingExecution = {
      ...input,
      state: "GROUNDING_PENDING",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      leaseUntil: new Date(Date.now() + 180000),
    };
    this.rows.set(row.groundingId, row);
    return { kind: "CREATED", execution: row };
  }
  async recordSourceSnapshot(
    input: Parameters<
      GroundingPersistenceRepository["recordSourceSnapshot"]
    >[0],
  ): ReturnType<GroundingPersistenceRepository["recordSourceSnapshot"]> {
    const prior = await this.get(input);
    if (!prior || prior.leaseOwner !== input.leaseOwner)
      throw Error("ANALYSIS_NOT_FOUND");
    const snapshot = input.snapshot;
    const hash = publicCanonicalHash({
      identity: snapshot.identity,
      status: snapshot.sourceStatus,
      resultHash: snapshot.resultHash ?? null,
    });
    const row: GroundingExecution = {
      ...prior,
      wsgsGroundingId: snapshot.identity.sourceId,
      ...("upstreamRunId" in snapshot.identity
        ? { sourceJobId: snapshot.identity.upstreamRunId }
        : {}),
      lastSourceStatus: snapshot.sourceStatus,
      lastObservationHash: hash,
      ...(snapshot.result
        ? {
            state: "GROUNDING_READY",
            groundingResult: json(snapshot.result),
            groundingResultHash: snapshot.resultHash,
          }
        : {}),
      updatedAt: new Date(),
    };
    const changed = hash !== prior.lastObservationHash;
    if (changed) this.publications.push(hash);
    this.rows.set(row.groundingId, row);
    return { changed, execution: row };
  }
  polls = 0;
  async recordSourcePoll() {
    this.polls++;
  }
  async releaseLease() {
    return true;
  }
  async requestSourceCancellation(
    input: Parameters<
      GroundingPersistenceRepository["requestSourceCancellation"]
    >[0],
  ) {
    const prior = await this.get(input);
    if (!prior) throw Error("ANALYSIS_NOT_FOUND");
    const row = { ...prior, cancelRequested: true };
    this.rows.set(row.groundingId, row);
    return row;
  }
  async recordGroundingReady(): Promise<never> {
    throw Error("UNEXPECTED_LEGACY_PORT");
  }
  async complete(): Promise<never> {
    throw Error("UNEXPECTED_LEGACY_PORT");
  }
  async fail(): Promise<never> {
    throw Error("UNEXPECTED_LEGACY_PORT");
  }
  async cancel(): Promise<never> {
    throw Error("UNEXPECTED_LEGACY_PORT");
  }
}
