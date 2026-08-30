import { describe, expect, it, jest } from "@jest/globals";

import { createAnalysisEventPump } from "../packages/analysis-runtime/src/event-pump.js";
import {
  calculateCanonicalJsonHash,
  type WsgsAnalysisEventDecision,
  type WsgsAnalysisEventEnvelope,
} from "../packages/wsgs-analysis-consumer/src/index.js";

describe("v0.5 background analysis event pump", () => {
  it("continues committing after an observer disconnects", async () => {
    const committed: number[] = [];
    const published: number[] = [];
    const events = [event(1, "NODE_READY"), event(2, "NODE_STARTED")];
    const pump = createAnalysisEventPump<Record<string, never>, number>({
      presentation: {
        getAnalysisSnapshot: async () => ({}),
        subscribeAnalysisEvents: () => source(events),
      },
      committer: {
        commit: async (decision) => {
          committed.push(decision.event.sequence);
          return {
            disposition: decision.disposition,
            published: [decision.event.sequence],
          };
        },
      },
      activePlan: activePlan(),
    });
    let unsubscribe: () => void = () => undefined;
    unsubscribe = pump.subscribe((sequence) => {
      published.push(sequence);
      unsubscribe();
    });
    await pump.start("grounding-1");
    expect(committed).toEqual([1, 2]);
    expect(published).toEqual([1]);
  });

  it("retries a transient subscription once and resumes after the last sequence", async () => {
    const cursors: (number | undefined)[] = [];
    let attempt = 0;
    const commit = jest.fn(async (decision: WsgsAnalysisEventDecision) => ({
      disposition: decision.disposition,
      published: [] as number[],
    }));
    const pump = createAnalysisEventPump<Record<string, never>, number>({
      presentation: {
        getAnalysisSnapshot: async () => ({}),
        subscribeAnalysisEvents: (_groundingId, afterSequence) => {
          cursors.push(afterSequence);
          attempt += 1;
          return attempt === 1
            ? failingSource(event(1, "NODE_READY"))
            : source([event(2, "NODE_STARTED")]);
        },
      },
      committer: { commit },
      activePlan: activePlan(),
    });
    await pump.start("grounding-1");
    expect(cursors).toEqual([undefined, 1]);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("does not advance the cursor or integrity guard before persistence commits", async () => {
    const cursors: (number | undefined)[] = [];
    let subscriptionAttempt = 0;
    let commitAttempt = 0;
    const committed: number[] = [];
    const first = event(1, "NODE_READY");
    const second = event(2, "NODE_STARTED");
    const pump = createAnalysisEventPump<Record<string, never>, number>({
      presentation: {
        getAnalysisSnapshot: async () => ({}),
        subscribeAnalysisEvents: (_groundingId, afterSequence) => {
          cursors.push(afterSequence);
          subscriptionAttempt += 1;
          return source(subscriptionAttempt === 1 ? [first] : [first, second]);
        },
      },
      committer: {
        commit: async (decision) => {
          commitAttempt += 1;
          if (commitAttempt === 1) throw new Error("transient persistence");
          committed.push(decision.event.sequence);
          return { disposition: decision.disposition, published: [] };
        },
      },
      activePlan: activePlan(),
    });

    await pump.start("grounding-1");
    expect(cursors).toEqual([undefined, undefined]);
    expect(committed).toEqual([1, 2]);
  });

  it("does not retry protocol failures", async () => {
    const pump = createAnalysisEventPump<Record<string, never>, number>({
      presentation: {
        getAnalysisSnapshot: async () => ({}),
        subscribeAnalysisEvents: () =>
          source([event(2, "NODE_READY"), event(1, "NODE_STARTED")]),
      },
      committer: {
        commit: async (decision) => ({
          disposition: decision.disposition,
          published: [],
        }),
      },
      activePlan: activePlan(),
    });
    await expect(pump.start("grounding-1")).rejects.toThrow(
      "WSGS_ANALYSIS_EVENT_SEQUENCE_OUT_OF_ORDER",
    );
  });
});

function activePlan() {
  return {
    upstreamAnalysisId: "upstream-analysis-1",
    planId: "plan-1",
    planHash: `sha256:${"1".repeat(64)}`,
    planRevision: 1,
  };
}

function event(
  sequence: number,
  eventType: WsgsAnalysisEventEnvelope["eventType"],
): WsgsAnalysisEventEnvelope {
  const payload = { sequence };
  return {
    schemaVersion: "sacs-wsgs-analysis-event/1.0",
    eventId: `event-${sequence}`,
    upstreamAnalysisId: "upstream-analysis-1",
    planId: "plan-1",
    planHash: `sha256:${"1".repeat(64)}`,
    planRevision: 1,
    sequence,
    eventType,
    correlationId: "correlation-1",
    occurredAt: "2026-08-30T00:00:00.000Z",
    payload,
    payloadHash: calculateCanonicalJsonHash(payload),
  };
}

async function* source(
  events: readonly WsgsAnalysisEventEnvelope[],
): AsyncGenerator<WsgsAnalysisEventEnvelope> {
  for (const value of events) yield value;
}

async function* failingSource(
  first: WsgsAnalysisEventEnvelope,
): AsyncGenerator<WsgsAnalysisEventEnvelope> {
  yield first;
  throw new Error("transient transport failure");
}
