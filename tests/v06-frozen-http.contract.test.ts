import { describe, it, expect } from "@jest/globals";
import {
  createWsgsHttpClient,
  WsgsHttpError,
} from "../packages/wsgs-http-adapter/src/index.js";
import { GroundingJobAnalysisSourceAdapter } from "../packages/wsgs-analysis-adapter/src/grounding-job.js";
import { parseGroundingAnalysisConfig } from "../packages/wsgs-analysis-adapter/src/config.js";
import {
  publicCanonicalHash,
  publicResultHash,
  type GroundingCapabilities12,
  WSGS_V12_HEADERS,
} from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import {
  sourceStatusMapping,
  type AnalysisSourceStatus,
} from "../packages/analysis-contract/src/source.js";
import {
  frozenRequest,
  frozenResult,
  frozenJob,
  publicExample,
  startFrozenWsgsPeer,
  type WireReply,
} from "./helpers/frozen-wsgs-http.js";

const start = () => ({
  analysisId: "a1",
  revisionId: "r1",
  principalId: "p1",
  threadId: "t1",
  requestId: frozenRequest().requestId,
  canonicalGroundingRequest: frozenRequest(),
  requestHash: publicCanonicalHash(frozenRequest()),
  idempotencyKey: "stable-key-1",
});
const http = (baseUrl: string) =>
  createWsgsHttpClient({
    baseUrl,
    contractVersion: "sacs-wsgs-grounding/1.2",
    operationTimeoutMs: 500,
  });
describe("frozen 1.2 actual HTTP consumer C01", () => {
  it("AC-004 exact config and pair, no old default promotion", () => {
    expect(parseGroundingAnalysisConfig({})).toMatchObject({
      enabled: false,
      contractVersion: WSGS_V12_HEADERS["wsgs-contract-version"],
      resultProfile: WSGS_V12_HEADERS["wsgs-result-profile"],
    });
    expect(() =>
      parseGroundingAnalysisConfig({
        SACS_WSGS_ANALYSIS_CONTRACT_VERSION: "sacs-wsgs-grounding/1.1",
      }),
    ).toThrow("ANALYSIS_SOURCE_CONTRACT_IDENTITY_INVALID");
    expect(
      parseGroundingAnalysisConfig({
        SACS_WSGS_ANALYSIS_CONTRACT_VERSION: "sacs-wsgs-grounding/1.1",
        SACS_WSGS_ANALYSIS_RESULT_PROFILE: "sacs-wsgs-geospatial-findings/1.0",
      }),
    ).toMatchObject({ contractVersion: "sacs-wsgs-grounding/1.1" });
  });
  it("AC-004 capabilities POST GET cancel keep both headers and wire version", async () => {
    const peer = await startFrozenWsgsPeer((r) => ({
      value:
        r.path === "/v1/capabilities"
          ? publicExample("capabilities")
          : r.path.endsWith(":cancel")
            ? {
                ...frozenJob("CANCELLED"),
                finishedAt: "2026-09-06T10:00:00.000+08:00",
              }
            : frozenJob(),
      status: r.path === "/v1/groundings" ? 202 : 200,
    }));
    try {
      const adapter = new GroundingJobAnalysisSourceAdapter(http(peer.baseUrl));
      await adapter.capabilities();
      const initial = await adapter.start(start());
      await adapter.get(initial.identity);
      await adapter.cancel({
        identity: initial.identity,
        commandId: "cancel-1",
        idempotencyKey: "cancel-key-1",
        reason: "USER_REQUESTED",
      });
      expect(peer.captured.map((r) => [r.method, r.path])).toEqual([
        ["GET", "/v1/capabilities"],
        ["POST", "/v1/groundings"],
        ["GET", "/v1/groundings/grounding-1"],
        ["POST", "/v1/groundings/grounding-1:cancel"],
      ]);
      for (const r of peer.captured)
        for (const [key, expected] of Object.entries(WSGS_V12_HEADERS))
          expect(r.headers[key]).toBe(expected);
      expect(JSON.parse(peer.captured[1]!.body).schemaVersion).toBe("1.0");
    } finally {
      await peer.close();
    }
  });
  it.each([
    {},
    { ...WSGS_V12_HEADERS, "wsgs-contract-version": "sacs-wsgs-grounding/1.1" },
    {
      ...WSGS_V12_HEADERS,
      "wsgs-result-profile": "sacs-wsgs-geospatial-findings/1.0",
    },
    {
      ...WSGS_V12_HEADERS,
      "wsgs-contract-version": [
        WSGS_V12_HEADERS["wsgs-contract-version"],
        WSGS_V12_HEADERS["wsgs-contract-version"],
      ],
    },
  ])(
    "AC-004 rejects missing/mismatched/duplicate response negotiation %#",
    async (headers) => {
      const peer = await startFrozenWsgsPeer(() => ({
        value: frozenResult(),
        headers,
      }));
      try {
        await expect(
          http(peer.baseUrl).createGrounding(frozenRequest(), "k1"),
        ).rejects.toThrow("WSGS_CONTRACT_RESPONSE_HEADER_MISMATCH");
        expect(peer.captured).toHaveLength(1);
      } finally {
        await peer.close();
      }
    },
  );
  it("AC-006 decodes supported versus available without disabling unrelated references", async () => {
    const capabilities = publicExample<GroundingCapabilities12>("capabilities");
    capabilities.requiredCapabilitiesReady = false;
    const peer = await startFrozenWsgsPeer((r) => ({
      value: r.path.includes("capabilities")
        ? capabilities
        : frozenResult("empty"),
    }));
    try {
      const adapter = new GroundingJobAnalysisSourceAdapter(http(peer.baseUrl));
      const value = await adapter.capabilities();
      expect(value.requiredReady).toBe(false);
      expect(value.optionalAvailable).toEqual([]);
      expect(value.optionalUnavailable).toHaveLength(6);
      expect(value.optionalUnavailable[0]).toMatchObject({
        reasonCode: "FEATURE_DISABLED",
      });
      expect(await adapter.start(start())).toMatchObject({
        terminal: true,
        sourceStatus: "COMPLETED",
      });
    } finally {
      await peer.close();
    }
  });
  it("AC-007 AC-010 sync result and retry preserve full body/key without invented JobId", async () => {
    const peer = await startFrozenWsgsPeer(() => ({ value: frozenResult() }));
    try {
      const adapter = new GroundingJobAnalysisSourceAdapter(http(peer.baseUrl));
      const one = await adapter.start(start());
      const two = await adapter.start(start());
      expect(one.identity).not.toHaveProperty("upstreamRunId");
      expect(one.result?.resultHash).toBe(two.result?.resultHash);
      expect(peer.captured[0]!.body).toBe(peer.captured[1]!.body);
      expect(peer.captured.map((r) => r.headers["idempotency-key"])).toEqual([
        "stable-key-1",
        "stable-key-1",
      ]);
      const wrong = frozenRequest();
      wrong.source.originalText += " changed";
      await expect(
        adapter.start({ ...start(), canonicalGroundingRequest: wrong }),
      ).rejects.toThrow("ANALYSIS_SOURCE_REQUEST_HASH_MISMATCH");
      await expect(
        http(peer.baseUrl).createGrounding(wrong, "new-key"),
      ).rejects.toThrow("WSGS_ORIGINAL_TEXT_HASH_MISMATCH");
      expect(peer.captured).toHaveLength(2);
    } finally {
      await peer.close();
    }
  });
  it("AC-008 observes accepted/running/terminal and deduplicates repeated snapshots", async () => {
    const peer = await startFrozenWsgsPeer((_r, i) => ({
      value:
        i < 2
          ? frozenJob()
          : i < 4
            ? frozenJob("RUNNING")
            : frozenJob("COMPLETED", frozenResult("empty")),
      status: i === 0 ? 202 : 200,
    }));
    try {
      const adapter = new GroundingJobAnalysisSourceAdapter(
        http(peer.baseUrl),
        { pollIntervalMs: 10 },
      );
      const initial = await adapter.start(start());
      const events = [];
      for await (const item of adapter.observe({
        analysisId: "a1",
        revisionId: "r1",
        runId: "run1",
        identity: initial.identity,
      }))
        events.push(item);
      expect(events.map((e) => e.sourceStatus)).toEqual([
        "ACCEPTED",
        "RUNNING",
        "COMPLETED",
      ]);
      expect(events.at(-1)!.result).toEqual(frozenResult("empty"));
      expect(peer.captured).toHaveLength(5);
    } finally {
      await peer.close();
    }
  });
  it.each([403, 406, 409])(
    "AC-009 preserves safe protocol reason at HTTP %i without retries or fallback",
    async (status) => {
      const peer = await startFrozenWsgsPeer(() => ({
        status,
        value: {
          schemaVersion: "1.0",
          requestId: frozenRequest().requestId,
          error: {
            code: "PUBLIC_CONFLICT",
            message: "not echoed",
            retryable: false,
            stage: "REQUEST_VALIDATION",
          },
        },
      }));
      try {
        await expect(
          http(peer.baseUrl).createGrounding(frozenRequest(), "key1"),
        ).rejects.toMatchObject({
          code: "PUBLIC_CONFLICT",
          statusCode: status,
          retryable: false,
        });
        expect(peer.captured).toHaveLength(1);
      } finally {
        await peer.close();
      }
    },
  );
  it.each([
    "requestId",
    "groundingId",
    "jobId",
    "resultHash",
    "malformed",
    "source",
  ])(
    "AC-009 rejects foreign or malformed %s before projection",
    async (kind) => {
      const good = frozenResult();
      let reply: WireReply = { value: frozenJob("COMPLETED", good) };
      if (kind === "malformed") reply = { raw: "{not-json" };
      else if (kind === "resultHash") {
        good.resultHash = "sha256:" + "f".repeat(64);
      } else if (kind === "source") {
        good.source.messageId = "foreign-message";
        good.resultHash = publicResultHash(good);
      } else {
        const value = reply.value as Record<string, unknown>;
        value[kind] = "foreign-1";
        if (kind === "requestId") {
          good.requestId = "foreign-1";
          good.resultHash = publicResultHash(good);
        }
        if (kind === "groundingId") {
          good.groundingId = "foreign-1";
          good.resultHash = publicResultHash(good);
        }
      }
      const peer = await startFrozenWsgsPeer((_r, i) =>
        i === 0 ? { value: frozenJob(), status: 202 } : reply,
      );
      try {
        const adapter = new GroundingJobAnalysisSourceAdapter(
          http(peer.baseUrl),
        );
        const initial = await adapter.start(start());
        await expect(adapter.get(initial.identity)).rejects.toThrow();
        expect(peer.captured).toHaveLength(2);
      } finally {
        await peer.close();
      }
    },
  );
  it.each(["AMBIGUOUS", "UNRESOLVED", "PARTIAL"] as const)(
    "AC-030 terminal %s stops observation, not device completion",
    async (status) => {
      const result = frozenResult(
        status === "PARTIAL" ? "projection-pending" : "empty",
      );
      result.status = status;
      result.resultHash = publicResultHash(result);
      const peer = await startFrozenWsgsPeer((_r, i) => ({
        status: i === 0 ? 202 : 200,
        value: i === 0 ? frozenJob() : frozenJob(status, result),
      }));
      try {
        const adapter = new GroundingJobAnalysisSourceAdapter(
          http(peer.baseUrl),
        );
        const initial = await adapter.start(start());
        const events = [];
        for await (const e of adapter.observe({
          analysisId: "a1",
          revisionId: "r1",
          runId: "run1",
          identity: initial.identity,
        }))
          events.push(e);
        expect(events).toHaveLength(1);
        expect(events[0]!.terminal).toBe(true);
        expect(
          sourceStatusMapping[status as AnalysisSourceStatus].view,
        ).not.toContain("DEVICE");
        expect(peer.captured).toHaveLength(2);
      } finally {
        await peer.close();
      }
    },
  );
  it("AC-031 bounded retry failures preserve accepted state and never send cancel", async () => {
    const peer = await startFrozenWsgsPeer((_r, i) =>
      i === 0 ? { value: frozenJob(), status: 202 } : { drop: true },
    );
    try {
      const adapter = new GroundingJobAnalysisSourceAdapter(
        http(peer.baseUrl),
        { pollIntervalMs: 10, maxConsecutiveFailures: 2 },
      );
      const initial = await adapter.start(start());
      const collect = async () => {
        for await (const _e of adapter.observe({
          analysisId: "a1",
          revisionId: "r1",
          runId: "run1",
          identity: initial.identity,
        })) {
          /* No synthetic failed snapshot. */
        }
      };
      await expect(collect()).rejects.toThrow(
        "ANALYSIS_SOURCE_OBSERVATION_LIMIT_EXCEEDED",
      );
      expect(initial.sourceStatus).toBe("ACCEPTED");
      expect(peer.captured.every((r) => !r.path.endsWith(":cancel"))).toBe(
        true,
      );
      expect(peer.captured).toHaveLength(3);
    } finally {
      await peer.close();
    }
  });
  it("AC-031 abort/detach and local timeout do not cancel or manufacture remote state", async () => {
    const peer = await startFrozenWsgsPeer((_r, i) => ({
      value: frozenJob(),
      status: i === 0 ? 202 : 200,
    }));
    try {
      const adapter = new GroundingJobAnalysisSourceAdapter(
        http(peer.baseUrl),
        { pollIntervalMs: 10, maxDurationMs: 40 },
      );
      const initial = await adapter.start(start());
      const abort = new AbortController();
      const it = adapter
        .observe({
          analysisId: "a1",
          revisionId: "r1",
          runId: "run1",
          identity: initial.identity,
          signal: abort.signal,
        })
        [Symbol.asyncIterator]();
      await it.next();
      abort.abort();
      await expect(it.next()).rejects.toThrow();
      const collect = async () => {
        for await (const _e of adapter.observe({
          analysisId: "a1",
          revisionId: "r1",
          runId: "run1",
          identity: initial.identity,
        })) {
          /* Bound only local observation. */
        }
      };
      await expect(collect()).rejects.toThrow(
        "ANALYSIS_SOURCE_OBSERVATION_LIMIT_EXCEEDED",
      );
      expect(initial.sourceStatus).toBe("ACCEPTED");
      expect(peer.captured.every((r) => !r.path.endsWith(":cancel"))).toBe(
        true,
      );
    } finally {
      await peer.close();
    }
  });
  it("AC-018 enforces caller result budget on POST and subsequent GET", async () => {
    const peer = await startFrozenWsgsPeer(() => ({ value: frozenResult() }));
    try {
      const request = frozenRequest();
      request.executionPolicy.maxResultBytes = 1024;
      await expect(
        http(peer.baseUrl).createGrounding(request, "budget-key"),
      ).rejects.toBeInstanceOf(WsgsHttpError);
    } finally {
      await peer.close();
    }
    const later = await startFrozenWsgsPeer((_r, i) => ({
      status: i === 0 ? 202 : 200,
      value: i === 0 ? frozenJob() : frozenJob("COMPLETED", frozenResult()),
    }));
    try {
      const request = frozenRequest();
      request.executionPolicy.maxResultBytes = 1024;
      const adapter = new GroundingJobAnalysisSourceAdapter(
        http(later.baseUrl),
      );
      const initial = await adapter.start({
        ...start(),
        canonicalGroundingRequest: request,
        requestHash: publicCanonicalHash(request),
      });
      await expect(adapter.get(initial.identity)).rejects.toBeInstanceOf(
        WsgsHttpError,
      );
    } finally {
      await later.close();
    }
  });
});
