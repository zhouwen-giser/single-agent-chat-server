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
  readonly projectionReceipts = new Map<string, string>();
  sourceRecoveryEligible?: (execution: GroundingExecution) => boolean;
  constructor(private readonly now: () => Date = () => new Date()) {}
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
      if (prior.state !== "GROUNDING_PENDING")
        return { kind: "REPLAY", execution: prior };
      if (
        prior.leaseOwner &&
        prior.leaseOwner !== input.leaseOwner &&
        prior.leaseUntil &&
        prior.leaseUntil.getTime() > this.now().getTime()
      )
        return { kind: "BUSY", execution: prior };
      const acquired = {
        ...prior,
        leaseOwner: input.leaseOwner,
        leaseUntil: new Date(this.now().getTime() + (input.leaseMs ?? 180000)),
      };
      this.rows.set(prior.groundingId, acquired);
      return { kind: "ACQUIRED", execution: acquired };
    }
    const row: GroundingExecution = {
      ...input,
      state: "GROUNDING_PENDING",
      version: 1,
      createdAt: this.now(),
      updatedAt: this.now(),
      leaseUntil: new Date(this.now().getTime() + 180000),
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
      updatedAt: this.now(),
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
  async releaseLease(
    input: Parameters<GroundingPersistenceRepository["releaseLease"]>[0],
  ) {
    const row = await this.get(input);
    if (!row || row.leaseOwner !== input.leaseOwner) return false;
    const { leaseOwner: _owner, leaseUntil: _until, ...released } = row;
    this.rows.set(row.groundingId, released);
    return true;
  }
  async claimRecoverable(
    input: Parameters<GroundingPersistenceRepository["claimRecoverable"]>[0],
  ) {
    const recovered: GroundingExecution[] = [];
    for (const row of this.rows.values()) {
      if (this.sourceRecoveryEligible && !this.sourceRecoveryEligible(row))
        continue;
      if (row.leaseUntil && row.leaseUntil.getTime() > this.now().getTime())
        continue;
      if (
        !row.canonicalRequest ||
        !["GROUNDING_PENDING", "GROUNDING_READY"].includes(row.state) ||
        (row.lastSourceStatus !== undefined &&
          !["ACCEPTED", "RUNNING"].includes(row.lastSourceStatus) &&
          this.projectionReceipts.get(row.groundingId) ===
            row.lastObservationHash)
      )
        continue;
      const acquired = {
        ...row,
        leaseOwner: input.leaseOwner,
        leaseUntil: new Date(this.now().getTime() + (input.leaseMs ?? 180000)),
      };
      this.rows.set(row.groundingId, acquired);
      recovered.push(acquired);
      if (recovered.length >= (input.limit ?? 32)) break;
    }
    return recovered;
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
  async recordGroundingReady(
    input: Parameters<
      GroundingPersistenceRepository["recordGroundingReady"]
    >[0],
  ) {
    const row = await this.get(input);
    if (!row) throw Error("ANALYSIS_NOT_FOUND");
    if (row.state !== "GROUNDING_PENDING") {
      if (
        row.wsgsGroundingId === input.wsgsGroundingId &&
        row.groundingResultHash === input.resultHash
      )
        return row;
      throw Error("GROUNDING_RESULT_CONFLICT");
    }
    if (row.leaseOwner !== input.leaseOwner)
      throw Error("GROUNDING_LEASE_CONFLICT");
    const ready: GroundingExecution = {
      ...row,
      state: "GROUNDING_READY",
      wsgsGroundingId: input.wsgsGroundingId,
      groundingResultHash: input.resultHash,
      groundingResult: json(input.result),
      updatedAt: this.now(),
    };
    this.rows.set(row.groundingId, ready);
    return ready;
  }
  async complete(
    input: Parameters<GroundingPersistenceRepository["complete"]>[0],
  ) {
    return this.terminal(input, "COMPLETED");
  }
  async fail(input: Parameters<GroundingPersistenceRepository["fail"]>[0]) {
    return this.terminal(input, "FAILED", input.failureCode);
  }
  async cancel(input: Parameters<GroundingPersistenceRepository["cancel"]>[0]) {
    return this.terminal(input, "CANCELLED");
  }
  private async terminal(
    input: Parameters<GroundingPersistenceRepository["complete"]>[0],
    state: "COMPLETED" | "FAILED" | "CANCELLED",
    failureCode?: string,
  ) {
    const row = await this.get(input);
    if (!row) throw Error("ANALYSIS_NOT_FOUND");
    if (row.state === state) return row;
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(row.state))
      throw Error("GROUNDING_TERMINAL_CONFLICT");
    if (state === "COMPLETED" && row.state !== "GROUNDING_READY")
      throw Error("GROUNDING_NOT_READY");
    const { leaseOwner: _owner, leaseUntil: _until, ...value } = row;
    const terminal = {
      ...value,
      state,
      ...(failureCode ? { failureCode } : {}),
      terminalAt: this.now(),
      updatedAt: this.now(),
    };
    this.rows.set(row.groundingId, terminal);
    return terminal;
  }
}
