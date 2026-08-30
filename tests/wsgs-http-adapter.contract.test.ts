import { describe, expect, it, jest } from "@jest/globals";

import {
  createWsgsHttpClient,
  WsgsHttpError,
  type WsgsGroundingRequest,
} from "../packages/wsgs-http-adapter/src/index.js";

const sha = `sha256:${"a".repeat(64)}`;

describe("isolated WSGS HTTP adapter", () => {
  it("checks the exact frozen capabilities and fixed endpoint", async () => {
    const fetchImpl = jest.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe("http://127.0.0.1:8080/v1/capabilities");
      return jsonResponse(capabilities());
    });
    const client = createWsgsHttpClient({
      baseUrl: "http://127.0.0.1:8080",
      fetchImpl,
    });
    await expect(client.capabilities()).resolves.toMatchObject({
      contractVersion: "sacs-wsgs-grounding/1.0",
      requiredCapabilitiesReady: true,
    });
  });

  it("sends only a strict GroundingRequest with transport-derived auth", async () => {
    const fetchImpl = jest.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("http://wsgs.test/v1/groundings");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("idempotency-key")).toBe("idem-1");
      expect(headers.get("prefer")).toBe("respond-async");
      expect(headers.get("authorization")).toBe("Bearer secret-token");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).not.toHaveProperty("actor");
      expect(body).not.toHaveProperty("permissions");
      return jsonResponse(job("ACCEPTED"), 202);
    });
    const client = createWsgsHttpClient({
      baseUrl: "http://wsgs.test",
      bearerToken: "secret-token",
      fetchImpl,
    });
    await expect(
      client.createGrounding(request(), "idem-1"),
    ).resolves.toMatchObject({
      status: "ACCEPTED",
      groundingId: "grounding-1",
    });
  });

  it("rejects authority fields anywhere in the request body", async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    const client = createWsgsHttpClient({
      baseUrl: "http://wsgs.test",
      fetchImpl,
    });
    const value = request() as unknown as Record<string, unknown>;
    value["actor"] = "forbidden";
    await expect(
      client.createGrounding(
        value as unknown as WsgsGroundingRequest,
        "idem-1",
      ),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds async polling and stops on a terminal job", async () => {
    let polls = 0;
    const fetchImpl = jest.fn<typeof fetch>(async () => {
      polls += 1;
      return jsonResponse(job(polls === 1 ? "RUNNING" : "COMPLETED"));
    });
    const sleepImpl = jest.fn(async () => undefined);
    const client = createWsgsHttpClient({
      baseUrl: "http://wsgs.test",
      fetchImpl,
      sleepImpl,
      maxPollAttempts: 3,
    });
    await expect(client.waitForGrounding("grounding-1")).resolves.toMatchObject(
      {
        status: "COMPLETED",
      },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when polling exceeds the configured bound", async () => {
    const client = createWsgsHttpClient({
      baseUrl: "http://wsgs.test",
      fetchImpl: async () => jsonResponse(job("RUNNING")),
      sleepImpl: async () => undefined,
      maxPollAttempts: 2,
    });
    await expect(client.waitForGrounding("grounding-1")).rejects.toMatchObject({
      code: "WSGS_POLL_LIMIT_EXCEEDED",
      retryable: true,
    });
  });

  it("returns sanitized typed protocol errors without remote messages", async () => {
    const client = createWsgsHttpClient({
      baseUrl: "http://wsgs.test",
      fetchImpl: async () =>
        jsonResponse(
          {
            schemaVersion: "1.0",
            requestId: "request-1",
            error: {
              code: "NOT_READY",
              message: "sensitive backend detail",
              retryable: true,
              stage: "PERSISTENCE",
            },
          },
          503,
        ),
    });
    const error = await client.capabilities().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(WsgsHttpError);
    expect(error).toMatchObject({
      code: "NOT_READY",
      statusCode: 503,
      retryable: true,
      stage: "PERSISTENCE",
      message: "WSGS request failed: NOT_READY",
    });
    expect(String(error)).not.toContain("sensitive backend detail");
  });

  it("uses only the frozen cancel route", async () => {
    const fetchImpl = jest.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        "http://wsgs.test/v1/groundings/grounding-1:cancel",
      );
      expect(init?.method).toBe("POST");
      return jsonResponse(job("CANCELLED"));
    });
    const client = createWsgsHttpClient({
      baseUrl: "http://wsgs.test",
      fetchImpl,
    });
    await expect(client.cancelGrounding("grounding-1")).resolves.toMatchObject({
      status: "CANCELLED",
    });
  });
});

function request(): WsgsGroundingRequest {
  return {
    schemaVersion: "1.0",
    requestId: "request-1",
    operation: "GROUND_REFERENCES",
    source: {
      conversationRef: "conversation-1",
      messageId: "message-1",
      originalText: "Where is the road?",
      originalTextSha256: sha,
      locale: "en-US",
      createdAt: "2026-08-28T01:00:00.000Z",
    },
    requestedProducts: ["MENTIONS", "RESOLVED_REFERENCES"],
    contextCapsule: {
      knownWorldReferences: [],
      priorGroundings: [],
      mapSelections: [],
      externalCorrelationHints: [],
      externalPredicates: [],
    },
    executionPolicy: {
      readOnly: true,
      deadlineMs: 30_000,
      maxQueryOperations: 16,
      maxCandidatesPerMention: 5,
      maxResultBytes: 1_048_576,
      allowApproximation: false,
    },
  };
}

function job(
  status:
    | "ACCEPTED"
    | "RUNNING"
    | "COMPLETED"
    | "PARTIAL"
    | "AMBIGUOUS"
    | "UNRESOLVED"
    | "FAILED"
    | "CANCELLED",
) {
  return {
    schemaVersion: "1.0",
    jobId: "job-1",
    groundingId: "grounding-1",
    requestId: "request-1",
    status,
    createdAt: "2026-08-28T01:00:00.000Z",
    updatedAt: "2026-08-28T01:00:01.000Z",
  };
}

function capabilities() {
  return {
    service: "world-semantic-grounding-service",
    version: "0.1.0",
    contractVersion: "sacs-wsgs-grounding/1.0",
    supportedOperations: [
      "GROUND_REFERENCES",
      "COMPILE_WORLD_QUERY",
      "EXECUTE_WORLD_QUERY",
      "VALIDATE_REFERENCES",
    ],
    supportedProducts: [
      "MENTIONS",
      "REFERENCE_PRODUCTS",
      "WORLD_EVIDENCE",
      "AMBIGUITIES",
      "CAPABILITY_GAPS",
    ],
    gowmContract: {
      softwareVersion: "0.4.0",
      commit: "db575f79c874a69f65a2043a7e463338524b713d",
      sourcePackageArtifacts: 33,
    },
    requiredCapabilitiesReady: true,
    optionalCapabilities: [],
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
