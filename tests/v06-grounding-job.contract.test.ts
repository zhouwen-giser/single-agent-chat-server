import {
  readFileSync,
  mkdtempSync,
  cpSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, jest } from "@jest/globals";
import {
  createWsgsHttpClient,
  type WsgsGroundingRequest,
} from "../packages/wsgs-http-adapter/src/index.js";
import {
  WsgsAuthoritativeContract,
  WSGS_V11_HEADERS,
} from "../packages/wsgs-geospatial-consumer/src/authoritative.js";
import { GroundingJobAnalysisSourceAdapter } from "../packages/wsgs-analysis-adapter/src/grounding-job.js";
import { hashCanonicalJson } from "../packages/world-explanation-contract/src/index.js";
const read = (file: string) =>
  JSON.parse(readFileSync("dependencies/wsgs-v06/" + file, "utf8"));
const result = () =>
  read("examples/grounding-result-with-geospatial-findings.json");
const body = () =>
  ({
    ...read("legacy/examples/01-reference-name-grounding.json"),
    requestId: result().requestId,
  }) as WsgsGroundingRequest;
const request = () => ({
  analysisId: "a1",
  revisionId: "r1",
  principalId: "p1",
  threadId: "t1",
  requestId: body().requestId,
  canonicalGroundingRequest: body(),
  requestHash: hashCanonicalJson(body()),
  idempotencyKey: "stable-key-1",
});
const job = (status = "ACCEPTED") => ({
  schemaVersion: "1.0",
  requestId: result().requestId,
  groundingId: result().groundingId,
  jobId: "job-1",
  status,
  createdAt: "2026-09-06T00:00:00Z",
  updatedAt: "2026-09-06T00:00:00Z",
  ...(status === "COMPLETED" ? { result: result() } : {}),
});
const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = { ...WSGS_V11_HEADERS },
) => new Response(JSON.stringify(value), { status, headers });
const client = (fetchImpl: typeof fetch) =>
  createWsgsHttpClient({
    contractVersion: "sacs-wsgs-grounding/1.1",
    baseUrl: "http://wsgs.test",
    fetchImpl,
  });
describe("v06 authoritative Grounding Job wire boundary", () => {
  it("verifies all locked bytes and rejects a tampered schema before network", () => {
    expect(new WsgsAuthoritativeContract().consumerLock).toMatchObject({
      provenance: "AUTHORITATIVE_WSGS_HANDOFF",
      status: "READY",
    });
    const root = mkdtempSync(join(tmpdir(), "v06-contract-"));
    try {
      cpSync("dependencies/wsgs-v06", root, { recursive: true });
      writeFileSync(join(root, "world-finding.schema.json"), "{}");
      expect(() => new WsgsAuthoritativeContract(root)).toThrow(
        "WSGS_CONTRACT_SCHEMA_HASH_MISMATCH",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("sends exact negotiation and stable replay body/key using only the documented route", async () => {
    const seen: string[] = [];
    const fetchImpl = jest.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("http://wsgs.test/v1/groundings");
      const h = new Headers(init?.headers);
      for (const [key, value] of Object.entries(WSGS_V11_HEADERS))
        expect(h.get(key)).toBe(value);
      expect(h.get("idempotency-key")).toBe("stable-key-1");
      seen.push(String(init?.body));
      return json(result());
    });
    const adapter = new GroundingJobAnalysisSourceAdapter(client(fetchImpl));
    expect(await adapter.start(request())).toMatchObject({
      sourceStatus: "COMPLETED",
      terminal: true,
      identity: {
        kind: "WSGS_GROUNDING_JOB",
        sourceHash: request().requestHash,
      },
    });
    await adapter.start(request());
    expect(seen[0]).toBe(seen[1]);
    await expect(
      adapter.start({ ...request(), requestHash: "sha256:" + "f".repeat(64) }),
    ).rejects.toThrow("ANALYSIS_SOURCE_REQUEST_HASH_MISMATCH");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([
    {},
    { ...WSGS_V11_HEADERS, "wsgs-contract-version": "sacs-wsgs-grounding/1.0" },
    {
      ...WSGS_V11_HEADERS,
      "wsgs-result-profile":
        "sacs-wsgs-geospatial-findings/1.0, sacs-wsgs-geospatial-findings/1.0",
    },
  ])("rejects absent, downgraded or duplicated headers", async (headers) => {
    await expect(
      client(async () => json(result(), 200, headers)).createGrounding(
        body(),
        "key-1",
      ),
    ).rejects.toMatchObject({ code: "WSGS_CONTRACT_RESPONSE_HEADER_MISMATCH" });
  });
  it("does not retry unauthorized 1.1 as 1.0", async () => {
    const fetchImpl = jest.fn<typeof fetch>(async () =>
      json({ error: { code: "CONTRACT_CONSUMER_UNAUTHORIZED" } }, 403, {}),
    );
    await expect(client(fetchImpl).capabilities()).rejects.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("validates capabilities and result collection receipt integrity", async () => {
    expect(
      await client(async () =>
        json(read("examples/capabilities-response-v1.1.json")),
      ).capabilities(),
    ).toMatchObject({ requiredCapabilitiesReady: true });
    const invalid = result();
    invalid.geospatialFindings.findings[0].value = 123;
    await expect(
      client(async () => json(invalid)).createGrounding(body(), "key-1"),
    ).rejects.toThrow("WSGS_CONTRACT_PAYLOAD_INVALID");
  });
  it("separates optional availability from required readiness without exposing raw reasons", async () => {
    const caps = read("examples/capabilities-response-v1.1.json");
    caps.optionalCapabilities = [
      { operationId: "history.test@1", available: true },
      {
        operationId: "selection.test@1",
        available: false,
        reason: "internal-sensitive-detail",
      },
    ];
    const preflight = await new GroundingJobAnalysisSourceAdapter(
      client(async () => json(caps)),
    ).capabilities();
    expect(preflight).toMatchObject({
      requiredReady: true,
      optionalAvailable: ["history.test@1"],
      optionalUnavailable: [
        {
          operationId: "selection.test@1",
          reasonCode: "OPTIONAL_CAPABILITY_UNAVAILABLE",
        },
      ],
      nativeReady: false,
    });
    expect(JSON.stringify(preflight)).not.toContain("internal-sensitive");
  });
  it("normalizes asynchronous job identity, deduplicates polls and preserves terminal result", async () => {
    const calls: string[] = [];
    let polls = 0;
    const adapter = new GroundingJobAnalysisSourceAdapter(
      client(async (url, init) => {
        calls.push((init?.method ?? "GET") + " " + String(url));
        return init?.method === "POST"
          ? json(job(), 202)
          : json(job(++polls < 3 ? "RUNNING" : "COMPLETED"));
      }),
      { pollIntervalMs: 10 },
    );
    const start = await adapter.start(request());
    expect(start.identity.upstreamRunId).toBe("job-1");
    const events = [];
    for await (const e of adapter.observe({
      analysisId: "a1",
      revisionId: "r1",
      runId: "run1",
      identity: start.identity,
    }))
      events.push(e);
    expect(events.map((e) => e.sourceStatus)).toEqual(["RUNNING", "COMPLETED"]);
    expect(events.every((e) => e.sourceSequence === undefined)).toBe(true);
    expect(
      calls.every((c) =>
        /^POST http:\/\/wsgs.test\/v1\/groundings$|^GET http:\/\/wsgs.test\/v1\/groundings\/grounding.sacs.001$/u.test(
          c,
        ),
      ),
    ).toBe(true);
  });
  it.each([
    "ACCEPTED",
    "RUNNING",
    "COMPLETED",
    "PARTIAL",
    "AMBIGUOUS",
    "UNRESOLVED",
    "FAILED",
    "CANCELLED",
  ])("preserves %s without inventing progress", async (status) => {
    const adapter = new GroundingJobAnalysisSourceAdapter(
      client(async () => json(job(status), 202)),
    );
    expect(await adapter.start(request())).toMatchObject({
      sourceStatus: status,
      terminal: !["ACCEPTED", "RUNNING"].includes(status),
    });
  });
  it("rejects foreign job identity", async () => {
    const adapter = new GroundingJobAnalysisSourceAdapter(
      client(async () => json({ ...job(), jobId: "other" })),
    );
    await expect(
      adapter.get({
        kind: "WSGS_GROUNDING_JOB",
        sourceId: job().groundingId,
        sourceHash: request().requestHash,
        upstreamRunId: "job-1",
      }),
    ).rejects.toThrow("ANALYSIS_SOURCE_RESPONSE_CONTRACT_VIOLATION");
  });
  it("bounds configuration, observation duration and response size", async () => {
    expect(
      () =>
        new GroundingJobAnalysisSourceAdapter(
          client(async () => json(job())),
          { pollIntervalMs: 0 },
        ),
    ).toThrow();
    const adapter = new GroundingJobAnalysisSourceAdapter(
      client(async () => json(job())),
      { pollIntervalMs: 10, maxDurationMs: 20 },
    );
    const consume = async () => {
      for await (const e of adapter.observe({
        analysisId: "a1",
        revisionId: "r1",
        runId: "run1",
        identity: {
          kind: "WSGS_GROUNDING_JOB",
          sourceId: job().groundingId,
          sourceHash: request().requestHash,
        },
      }))
        void e;
    };
    await expect(consume()).rejects.toThrow(
      "ANALYSIS_SOURCE_OBSERVATION_LIMIT_EXCEEDED",
    );
    const c = createWsgsHttpClient({
      baseUrl: "http://wsgs.test",
      maxResponseBytes: 1024,
      fetchImpl: async () => json({ text: "x".repeat(2048) }),
    });
    await expect(c.capabilities()).rejects.toBeDefined();
  });
  it("aborts observation without sending cancellation", async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn<typeof fetch>(async () => json(job()));
    const adapter = new GroundingJobAnalysisSourceAdapter(client(fetchImpl), {
      pollIntervalMs: 10,
    });
    const observe = async () => {
      for await (const e of adapter.observe({
        analysisId: "a1",
        revisionId: "r1",
        runId: "run1",
        identity: {
          kind: "WSGS_GROUNDING_JOB",
          sourceId: job().groundingId,
          sourceHash: request().requestHash,
        },
        signal: controller.signal,
      })) {
        expect(e.sourceStatus).toBe("ACCEPTED");
        controller.abort();
      }
    };
    await expect(observe()).rejects.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
