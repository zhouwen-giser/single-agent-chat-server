import { describe, expect, it } from "@jest/globals";
import {
  AnalysisDevelopmentPumpSupervisor,
  type AnalysisSourcePumpOptions,
} from "../packages/analysis-development-runtime/src/index.js";
import { createInitialAnalysisProjection } from "../packages/analysis-runtime/src/projection-reducer.js";
import {
  agUiSharedStateV03Schema,
  type AnalysisProjection,
} from "../packages/analysis-contract/src/index.js";
import { hashCanonicalJson } from "../packages/world-explanation-contract/src/index.js";

const scope = {
  analysisId: "analysis-pump",
  principalId: "principal-pump",
  threadId: "thread-pump",
};
const now = "2026-09-06T02:00:30.000Z";
function projection(revisionId: string, sequence: number): AnalysisProjection {
  const initial = createInitialAnalysisProjection({
    session: {
      schemaVersion: "sacs-analysis-session/1.0",
      ...scope,
      groundingId: "grounding-" + revisionId,
      title: "world",
      autonomyMode: "OBSERVER",
      status: "ACTIVE",
      activeRevisionId: revisionId,
      latestRevisionNumber: sequence,
      observerPolicyHash: hashCanonicalJson({ mode: "OBSERVER" }),
      createdAt: now,
      updatedAt: now,
    },
    revision: {
      schemaVersion: "sacs-analysis-revision/1.0",
      analysisId: scope.analysisId,
      revisionId,
      revisionNumber: sequence,
      cause: "INITIAL_QUERY",
      changedPaths: [],
      reusedNodeIds: [],
      invalidatedNodeIds: [],
      rerunNodeIds: [],
      status: "RUNNING",
      createdAt: now,
      source: {
        kind: "WSGS_GROUNDING_JOB",
        sourceId: "source-" + revisionId,
        sourceHash: hashCanonicalJson({ revisionId }),
      },
    },
    run: {
      schemaVersion: "sacs-analysis-run/1.0",
      runId: "run-" + revisionId,
      revisionId,
      attempt: 1,
      status: "RUNNING",
      startedAt: now,
    },
    createdAt: now,
  });
  return { ...initial, lastEventSequence: sequence };
}
type Observation = { projection: AnalysisProjection; terminal: boolean };
class Queue {
  private values: Observation[] = [];
  private waiter?: (value: Observation | undefined) => void;
  private ended = false;
  push(value: Observation): void {
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter(value);
    } else this.values.push(value);
  }
  end(): void {
    this.ended = true;
    this.waiter?.(undefined);
    this.waiter = undefined;
  }
  async *read(): AsyncGenerator<Observation> {
    for (;;) {
      const value =
        this.values.shift() ??
        (this.ended
          ? undefined
          : await new Promise<Observation | undefined>((resolve) => {
              this.waiter = resolve;
            }));
      if (!value) return;
      yield value;
    }
  }
}
describe("frozen source pump Revision identity and detachable observations", () => {
  it("AC-029 restarts a terminal entry for a new Revision without accepting the prior source event", async () => {
    let stored: Observation = {
      projection: projection("revision-1", 1),
      terminal: true,
    };
    const queue = new Queue();
    const consumed: string[] = [];
    const options: AnalysisSourcePumpOptions = {
      source: {
        load: async () => stored,
        consume: (s) => {
          consumed.push(s.revisionId);
          return queue.read();
        },
      },
    };
    const pump = new AnalysisDevelopmentPumpSupervisor(options, () => now);
    expect((await pump.ensure(scope)).state).toBe("STOPPED");
    stored = { projection: projection("revision-2", 2), terminal: false };
    expect((await pump.ensure(scope)).state).toBe("RUNNING");
    const iterator = pump.observe(scope)[Symbol.asyncIterator]();
    await iterator.next();
    const pending = iterator.next();
    queue.push({ projection: projection("revision-1", 3), terminal: true });
    queue.push({ projection: projection("revision-2", 4), terminal: true });
    const event = await pending;
    expect(event.done).toBe(false);
    expect(
      agUiSharedStateV03Schema.parse(event.value!.projection.state).analysis
        .activeRevisionId,
    ).toBe("revision-2");
    expect(pump.status(scope)?.lastEventSequence).toBe(4);
    expect(consumed).toEqual(["revision-2"]);
    await iterator.return?.();
    await pump.settle();
  });
  it("AC-029 aborts a superseded in-flight generation and isolates its late completion", async () => {
    let stored: Observation = {
      projection: projection("revision-1", 1),
      terminal: false,
    };
    const queues = [new Queue(), new Queue()];
    const signals: AbortSignal[] = [];
    const pump = new AnalysisDevelopmentPumpSupervisor(
      {
        source: {
          load: async () => stored,
          consume: (s) => {
            signals.push(s.signal);
            return queues[signals.length - 1]!.read();
          },
        },
      },
      () => now,
    );
    await pump.ensure(scope);
    stored = { projection: projection("revision-2", 2), terminal: false };
    await Promise.all([pump.ensure(scope), pump.ensure(scope)]);
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    queues[0]!.push({
      projection: projection("revision-1", 99),
      terminal: true,
    });
    const observer = pump.observe(scope)[Symbol.asyncIterator]();
    await observer.next();
    queues[1]!.push({
      projection: projection("revision-2", 3),
      terminal: true,
    });
    await observer.next();
    expect(pump.status(scope)?.lastEventSequence).toBe(3);
    queues.forEach((queue) => queue.end());
    await observer.return?.();
    await pump.settle();
  });
  it("AC-031 pending observer abort detaches immediately without aborting the source pump", async () => {
    const queue = new Queue();
    let sourceSignal: AbortSignal | undefined;
    const pump = new AnalysisDevelopmentPumpSupervisor(
      {
        source: {
          load: async () => ({
            projection: projection("revision-1", 1),
            terminal: false,
          }),
          consume: (s) => {
            sourceSignal = s.signal;
            return queue.read();
          },
        },
      },
      () => now,
    );
    await pump.ensure(scope);
    const client = new AbortController();
    const observer = pump.observe(scope, client.signal)[Symbol.asyncIterator]();
    await observer.next();
    const pending = observer.next();
    client.abort();
    expect((await pending).done).toBe(true);
    expect(sourceSignal?.aborted).toBe(false);
    expect(pump.status(scope)?.state).toBe("RUNNING");
    queue.end();
    await pump.settle();
  });
});
