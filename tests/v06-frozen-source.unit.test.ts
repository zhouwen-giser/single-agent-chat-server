import { readFileSync } from "node:fs";
import { describe, it, expect, jest } from "@jest/globals";
import {
  WorldGroundingRuntime,
  type WorldGroundingRuntimeOptions,
} from "../packages/world-grounding-runtime/src/index.js";
import { createGroundingClientSelector } from "../packages/wsgs-analysis-adapter/src/contract-identity.js";
import { parseGroundingContractIdentity } from "../packages/analysis-contract/src/source.js";
import { WSGS_V11_HEADERS } from "../packages/wsgs-geospatial-consumer/src/authoritative.js";
import { publicCanonicalHash } from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import type { WsgsGroundingRequest } from "../packages/wsgs-http-adapter/src/index.js";
import {
  frozenRequest,
  frozenResult,
  frozenJob,
  publicExample,
  startFrozenWsgsPeer,
} from "./helpers/frozen-wsgs-http.js";
import { MemoryGrounding } from "./helpers/memory-grounding.js";
const load = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const v11 = parseGroundingContractIdentity({
  contractVersion: "sacs-wsgs-grounding/1.1",
  resultProfile: "sacs-wsgs-geospatial-findings/1.0",
});
const v12 = parseGroundingContractIdentity({
  contractVersion: "sacs-wsgs-grounding/1.2",
  resultProfile: "wsgs-world-analysis-findings/1.0",
});
const requestPorts: WorldGroundingRuntimeOptions["requests"] = {
  claimRequest: async () => {
    throw Error("UNEXPECTED_PORT");
  },
  completeRequest: async () => {
    throw Error("UNEXPECTED_PORT");
  },
  authorizedRequestCreatedAt: async () => {
    throw Error("UNEXPECTED_PORT");
  },
};
const intent = (canonicalGroundingRequest = frozenRequest(), suffix = "1") => ({
  canonicalGroundingRequest,
  analysisId: "a" + suffix,
  revisionId: "r" + suffix,
  groundingExecutionId: "g" + suffix,
  interactionRequestId: "i" + suffix,
  leaseOwner: "owner",
  principalId: "p1",
  threadId: "t1",
  requestId: canonicalGroundingRequest.requestId,
  requestHash: publicCanonicalHash(canonicalGroundingRequest),
  idempotencyKey: "key" + suffix,
});
const observe = (id = "g1") => ({
  groundingExecutionId: id,
  principalId: "p1",
  threadId: "t1",
  leaseOwner: "owner",
});
describe("frozen source durable-port boundary (not PostgreSQL restart)", () => {
  it("AC-032 uncertain cancel can recover through bounded GET without forging cancellation", async () => {
    const peer = await startFrozenWsgsPeer((r) =>
      r.path.endsWith(":cancel")
        ? { status: 503, value: {} }
        : r.path.includes("capabilities")
          ? { value: publicExample("capabilities") }
          : r.method === "POST"
            ? { status: 202, value: frozenJob() }
            : { value: frozenJob("COMPLETED", frozenResult("empty")) },
    );
    try {
      const store = new MemoryGrounding();
      const clients = createGroundingClientSelector({ baseUrl: peer.baseUrl });
      const world = new WorldGroundingRuntime({
        requests: requestPorts,
        grounding: store,
        wsgs: clients(v12),
        clientForContract: clients,
        sdarCompatibilityLock: load(
          "dependencies/sdar-grounding-extension-compatibility-lock.json",
        ),
      });
      await world.beginWorldGrounding(intent());
      await store.requestSourceCancellation({
        groundingId: "g1",
        principalId: "p1",
        threadId: "t1",
      });
      const snapshots = [];
      for await (const value of world.observeWorldGrounding(observe()))
        snapshots.push(value);
      expect(snapshots.map((s) => s.sourceStatus)).toEqual([
        "ACCEPTED",
        "ACCEPTED",
        "COMPLETED",
      ]);
      expect(snapshots[1]!.observationReasonCode).toBe(
        "WSGS_CANCEL_OBSERVATION_UNCONFIRMED",
      );
      expect(store.rows.get("g1")!.lastSourceStatus).toBe("COMPLETED");
      expect(
        peer.captured.filter((r) => r.path.endsWith(":cancel")),
      ).toHaveLength(1);
    } finally {
      await peer.close();
    }
  });
  it("AC-005 AC-033 keeps saved 1.1 GET/cancel after default changes, and uses 1.2 only for new work", async () => {
    const oldBody = load(
      "dependencies/wsgs-v06/legacy/examples/01-reference-name-grounding.json",
    ) as WsgsGroundingRequest;
    const oldJob = {
      schemaVersion: "1.0",
      groundingId: "old-grounding",
      requestId: oldBody.requestId,
      jobId: "old-job",
      status: "ACCEPTED",
      createdAt: "2026-09-06T00:00:00Z",
      updatedAt: "2026-09-06T00:00:00Z",
    };
    const store = new MemoryGrounding();
    const peer = await startFrozenWsgsPeer((r) => {
      if (r.headers["wsgs-contract-version"] === v11.contractVersion)
        return {
          headers: { ...WSGS_V11_HEADERS },
          status: r.path === "/v1/groundings" ? 202 : 200,
          value: r.path.includes("capabilities")
            ? load(
                "dependencies/wsgs-v06/examples/capabilities-response-v1.1.json",
              )
            : r.method === "GET"
              ? { ...oldJob, status: "CANCELLED" }
              : oldJob,
        };
      return {
        value: r.path.includes("capabilities")
          ? publicExample("capabilities")
          : frozenResult("empty"),
      };
    });
    try {
      const clients = createGroundingClientSelector({ baseUrl: peer.baseUrl });
      const options = {
        requests: requestPorts,
        grounding: store,
        sdarCompatibilityLock: load(
          "dependencies/sdar-grounding-extension-compatibility-lock.json",
        ),
        clientForContract: clients,
        sourcePolling: {
          pollIntervalMs: 10,
          maxDurationMs: 100,
          maxConsecutiveFailures: 2,
        },
      };
      const old = new WorldGroundingRuntime({ ...options, wsgs: clients(v11) });
      const oldIntent = {
        ...intent(),
        canonicalGroundingRequest: oldBody,
        requestId: oldBody.requestId,
        requestHash: publicCanonicalHash(oldBody),
      };
      const row = await old.beginWorldGrounding(oldIntent);
      expect(row.analysisIntent?.["contractIdentity"]).toEqual(v11);
      await store.requestSourceCancellation({
        groundingId: "g1",
        principalId: "p1",
        threadId: "t1",
      });
      const rebuilt = new WorldGroundingRuntime({
        ...options,
        wsgs: clients(v12),
        clientForContract: createGroundingClientSelector({
          baseUrl: peer.baseUrl,
        }),
      });
      await rebuilt.beginWorldGrounding({
        ...oldIntent,
        contractIdentity: v11,
      });
      const snapshots = [];
      for await (const snapshot of rebuilt.observeWorldGrounding(observe()))
        snapshots.push(snapshot);
      expect(snapshots.map((s) => s.sourceStatus)).toEqual([
        "ACCEPTED",
        "CANCELLED",
      ]);
      const newRow = await rebuilt.beginWorldGrounding(
        intent(frozenRequest(), "2"),
      );
      expect(newRow.analysisIntent?.["contractIdentity"]).toEqual(v12);
      const oldRequests = peer.captured.filter(
        (r) => r.headers["wsgs-contract-version"] === v11.contractVersion,
      );
      expect(oldRequests.map((r) => r.path)).toEqual([
        "/v1/capabilities",
        "/v1/groundings",
        "/v1/groundings/old-grounding:cancel",
        "/v1/groundings/old-grounding",
      ]);
      expect(
        peer.captured.filter((r) => r.path === "/v1/groundings"),
      ).toHaveLength(2);
      expect(store.rows.get("g1")!.groundingResult).toBeUndefined();
    } finally {
      await peer.close();
    }
  });
  it("AC-007 AC-008 AC-033 persists sync result without JobId, replay/terminal reconnect makes no POST or GET", async () => {
    const peer = await startFrozenWsgsPeer((r) => ({
      value: r.path.includes("capabilities")
        ? publicExample("capabilities")
        : frozenResult("empty"),
    }));
    try {
      const store = new MemoryGrounding();
      const clientForContract = createGroundingClientSelector({
        baseUrl: peer.baseUrl,
      });
      const onSourceStarted = jest.fn<
        NonNullable<WorldGroundingRuntimeOptions["onSourceStarted"]>
      >(async () => undefined);
      const options = {
        requests: requestPorts,
        grounding: store,
        wsgs: clientForContract(v12),
        clientForContract,
        sdarCompatibilityLock: load(
          "dependencies/sdar-grounding-extension-compatibility-lock.json",
        ),
        onSourceStarted,
      };
      const first = new WorldGroundingRuntime(options);
      const saved = await first.beginWorldGrounding(intent());
      expect(saved).toMatchObject({
        state: "GROUNDING_READY",
        lastSourceStatus: "COMPLETED",
        groundingResultHash: frozenResult("empty").resultHash,
      });
      expect(saved.sourceJobId).toBeUndefined();
      expect(onSourceStarted).toHaveBeenCalledTimes(1);
      const rebuilt = new WorldGroundingRuntime(options);
      await rebuilt.beginWorldGrounding(intent());
      const events = [];
      for await (const snapshot of rebuilt.observeWorldGrounding(observe()))
        events.push(snapshot);
      expect(events).toHaveLength(1);
      expect(events[0]!.result).toEqual(frozenResult("empty"));
      expect(peer.captured.map((r) => r.path)).toEqual([
        "/v1/capabilities",
        "/v1/groundings",
      ]);
      expect(store.publications).toHaveLength(1);
    } finally {
      await peer.close();
    }
  });
  it("AC-005 AC-009 refuses unidentified history and foreign scope without network", async () => {
    const peer = await startFrozenWsgsPeer((r) => ({
      value: r.path.includes("capabilities")
        ? publicExample("capabilities")
        : frozenJob(),
      status: r.path === "/v1/groundings" ? 202 : 200,
    }));
    try {
      const store = new MemoryGrounding();
      const clientForContract = createGroundingClientSelector({
        baseUrl: peer.baseUrl,
      });
      const world = new WorldGroundingRuntime({
        requests: requestPorts,
        grounding: store,
        wsgs: clientForContract(v12),
        clientForContract,
        sdarCompatibilityLock: load(
          "dependencies/sdar-grounding-extension-compatibility-lock.json",
        ),
      });
      const saved = await world.beginWorldGrounding(intent());
      store.rows.set("g1", {
        ...saved,
        analysisIntent: { analysisId: "a1", revisionId: "r1" },
      });
      await expect(
        world.observeWorldGrounding(observe())[Symbol.asyncIterator]().next(),
      ).rejects.toThrow("ANALYSIS_SOURCE_CONTRACT_IDENTITY_INVALID");
      await expect(
        world
          .observeWorldGrounding({ ...observe(), principalId: "foreign" })
          [Symbol.asyncIterator]()
          .next(),
      ).rejects.toThrow("ANALYSIS_NOT_FOUND");
      expect(peer.captured).toHaveLength(2);
    } finally {
      await peer.close();
    }
  });
});
