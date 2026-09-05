import { describe, expect, it } from "@jest/globals";

import {
  calculateCanonicalJsonHash,
  calculateSha256,
  defaultWsgsAnalysisHandoffStatus,
  evaluateWsgsAnalysisHandoff,
  verifyAuthoritativeWsgsAnalysisBundle,
  WSGS_ANALYSIS_ARTIFACT_NAMES,
  WSGS_ANALYSIS_HANDOFF_NOT_READY,
  WsgsAnalysisEventIntegrityGuard,
  type WsgsAnalysisControlPort,
  type WsgsAnalysisEventEnvelope,
  type WsgsAnalysisPresentationPort,
} from "../packages/wsgs-analysis-consumer/src/index.js";

const encoder = new TextEncoder();
const expectedWsgsSha = "a".repeat(40);
const authority = {
  source: "AUTHORITATIVE_WSGS_HANDOFF",
  expectedWsgsSha,
} as const;
const hash = `sha256:${"b".repeat(64)}`;

describe("v0.5 fail-closed WSGS analysis consumer", () => {
  it("publishes only the missing-authority blocker by default", () => {
    expect(defaultWsgsAnalysisHandoffStatus).toMatchObject({
      provenance: "TASK_PACKAGE_PROVISIONAL",
      status: "BLOCKED",
      marker: WSGS_ANALYSIS_HANDOFF_NOT_READY,
      observedAuthoritativeArtifacts: [],
    });
    expect(defaultWsgsAnalysisHandoffStatus.requiredArtifacts).toEqual(
      WSGS_ANALYSIS_ARTIFACT_NAMES,
    );
    expect(evaluateWsgsAnalysisHandoff(undefined, undefined)).toEqual({
      status: "BLOCKED",
      marker: WSGS_ANALYSIS_HANDOFF_NOT_READY,
      reasonCode: "AUTHORITATIVE_WSGS_ANALYSIS_HANDOFF_MISSING",
    });
  });

  it("requires explicit WSGS authority even when all eight files are present", () => {
    const bundle = readyBundle();
    expect(
      evaluateWsgsAnalysisHandoff(bundle, {
        source: "TASK_PACKAGE_PROVISIONAL",
        expectedWsgsSha,
      }),
    ).toEqual({
      status: "BLOCKED",
      marker: WSGS_ANALYSIS_HANDOFF_NOT_READY,
      reasonCode: "AUTHORITATIVE_WSGS_ANALYSIS_HANDOFF_REQUIRED",
    });
  });

  it("verifies exact raw bytes, bundle hash, profile, source SHA and schema hashes", () => {
    const bundle = readyBundle();
    const authorized = verifyAuthoritativeWsgsAnalysisBundle(bundle, authority);
    expect(authorized).toMatchObject({
      status: "READY",
      marker: "SACS_WSGS_ANALYSIS_CONSUMER_READY",
      profile: "sacs-wsgs-analysis-presentation/1.0",
      lock: {
        wsgsSha: expectedWsgsSha,
        transportMode: "STREAMING_EVENTS",
        status: "READY",
      },
    });
    expect(Object.keys(authorized.schemaDocuments)).toHaveLength(6);

    const tampered = { ...bundle };
    tampered["WSGS_ANALYSIS_EVENT_SCHEMA_LOCK.json"] = encoder.encode(
      `${decode(bundle["WSGS_ANALYSIS_EVENT_SCHEMA_LOCK.json"])} `,
    );
    expect(() =>
      verifyAuthoritativeWsgsAnalysisBundle(tampered, authority),
    ).toThrow("WSGS_ANALYSIS_CHECKSUM_DRIFT");

    expect(
      evaluateWsgsAnalysisHandoff(bundle, {
        ...authority,
        expectedWsgsSha: "c".repeat(40),
      }),
    ).toMatchObject({
      status: "BLOCKED",
      reasonCode: "WSGS_ANALYSIS_SHA_MISMATCH",
    });
  });

  it("rejects incomplete, expanded and internally inconsistent inventories", () => {
    const bundle = readyBundle();
    const missing = { ...bundle };
    delete missing["WSGS_CANCEL_SCHEMA_LOCK.json"];
    expect(() =>
      verifyAuthoritativeWsgsAnalysisBundle(missing, authority),
    ).toThrow("WSGS_ANALYSIS_HANDOFF_EXACT_INVENTORY_INVALID");

    const expanded = { ...bundle, "UNDECLARED.json": encoder.encode("{}") };
    expect(() =>
      verifyAuthoritativeWsgsAnalysisBundle(expanded, authority),
    ).toThrow("WSGS_ANALYSIS_HANDOFF_EXACT_INVENTORY_INVALID");

    const wrongSchemaHash = readyBundle((lock) => {
      lock.planSchemaHash = hash;
    });
    expect(() =>
      verifyAuthoritativeWsgsAnalysisBundle(wrongSchemaHash, authority),
    ).toThrow("WSGS_ANALYSIS_SCHEMA_HASH_MISMATCH");
  });

  it("requires declared semantics and transport-conditional routes", () => {
    const missingSemantics = readyBundle((lock) => {
      delete lock.idempotencySemantics;
    });
    expect(() =>
      verifyAuthoritativeWsgsAnalysisBundle(missingSemantics, authority),
    ).toThrow("WSGS_ANALYSIS_CONSUMER_LOCK_INVALID");

    const streamingWithoutEvents = readyBundle((lock) => {
      delete lock.endpoints.events;
    });
    expect(() =>
      verifyAuthoritativeWsgsAnalysisBundle(streamingWithoutEvents, authority),
    ).toThrow("WSGS_ANALYSIS_CONSUMER_LOCK_INVALID");

    const pollingWithEvents = readyBundle((lock) => {
      lock.transportMode = "POLLING_SNAPSHOT";
    });
    expect(() =>
      verifyAuthoritativeWsgsAnalysisBundle(pollingWithEvents, authority),
    ).toThrow("WSGS_ANALYSIS_CONSUMER_LOCK_INVALID");

    expect(() =>
      verifyAuthoritativeWsgsAnalysisBundle(
        readyBundle((lock) => {
          lock.transportMode = "POLLING_SNAPSHOT";
          delete lock.endpoints.events;
        }),
        authority,
      ),
    ).not.toThrow();
  });

  it("rejects unknown events, replays exact duplicates, and audits inactive plans", () => {
    const first = event();
    const guard = new WsgsAnalysisEventIntegrityGuard({
      upstreamAnalysisId: first.upstreamAnalysisId,
      planId: first.planId,
      planHash: first.planHash,
      planRevision: first.planRevision,
    });
    expect(guard.inspect(first).disposition).toBe("APPLY_TO_ACTIVE_PLAN");
    expect(guard.inspect(first).disposition).toBe("IDEMPOTENT_DUPLICATE");

    const lateOldPlan = event({
      eventId: "event-old",
      sequence: 2,
      planId: "plan-old",
      planHash: `sha256:${"d".repeat(64)}`,
      planRevision: 0,
    });
    expect(guard.inspect(lateOldPlan).disposition).toBe(
      "AUDIT_ONLY_INACTIVE_PLAN",
    );

    expect(() =>
      guard.inspect({ ...lateOldPlan, eventId: "event-collision" }),
    ).toThrow("WSGS_ANALYSIS_EVENT_SEQUENCE_COLLISION");
    expect(() =>
      guard.inspect({
        ...event({ eventId: "event-bad-hash", sequence: 3 }),
        payload: { changed: true },
      }),
    ).toThrow("WSGS_ANALYSIS_EVENT_PAYLOAD_HASH_MISMATCH");
    expect(() => guard.inspect({ ...first, eventType: "SECRET_STEP" })).toThrow(
      "WSGS_ANALYSIS_UNKNOWN_EVENT_TYPE",
    );
  });

  it("defines presentation and control ports without performing network I/O", async () => {
    const presentation: WsgsAnalysisPresentationPort<{ revision: number }> = {
      async getAnalysisSnapshot() {
        return { revision: 1 };
      },
      async *subscribeAnalysisEvents() {
        yield event();
      },
    };
    const control: WsgsAnalysisControlPort<string, string, string, string> = {
      async compileRevision(request) {
        return `compiled:${request}`;
      },
      async cancelRun(request) {
        return `cancelled:${request}`;
      },
      async resolveIntervention() {
        return undefined;
      },
    };

    await expect(
      presentation.getAnalysisSnapshot("grounding-1"),
    ).resolves.toEqual({ revision: 1 });
    await expect(control.compileRevision("revision-1")).resolves.toBe(
      "compiled:revision-1",
    );
    await expect(control.cancelRun("run-1")).resolves.toBe("cancelled:run-1");
  });
});

type MutableLock = Record<string, unknown> & {
  endpoints: Record<string, unknown>;
  transportMode: string;
  idempotencySemantics?: string;
  planSchemaHash: string;
};

function readyBundle(
  mutateLock?: (lock: MutableLock) => void,
): Record<string, Uint8Array> {
  const schemaFiles = {
    "WSGS_ANALYSIS_PLAN_SCHEMA_LOCK.json": jsonBytes({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:wsgs:analysis-plan:1.0",
      type: "object",
    }),
    "WSGS_ANALYSIS_EVENT_SCHEMA_LOCK.json": jsonBytes({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:wsgs:analysis-event:1.0",
      type: "object",
    }),
    "WSGS_TOOL_INTERACTION_SCHEMA_LOCK.json": jsonBytes({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:wsgs:tool-interaction:1.0",
      type: "object",
    }),
    "WSGS_REVISION_CONTROL_SCHEMA_LOCK.json": jsonBytes({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:wsgs:revision-control:1.0",
      type: "object",
    }),
    "WSGS_CANCEL_SCHEMA_LOCK.json": jsonBytes({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:wsgs:cancel:1.0",
      type: "object",
    }),
    "WSGS_INTERVENTION_SCHEMA_LOCK.json": jsonBytes({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:wsgs:intervention:1.0",
      type: "object",
    }),
  };
  const lock: MutableLock = {
    schemaVersion: "sacs-wsgs-analysis-consumer-lock/1.0",
    profile: "sacs-wsgs-analysis-presentation/1.0",
    provenance: "AUTHORITATIVE_WSGS_HANDOFF",
    wsgsSha: expectedWsgsSha,
    transportMode: "STREAMING_EVENTS",
    planSchemaHash: calculateSha256(
      schemaFiles["WSGS_ANALYSIS_PLAN_SCHEMA_LOCK.json"],
    ),
    eventSchemaHash: calculateSha256(
      schemaFiles["WSGS_ANALYSIS_EVENT_SCHEMA_LOCK.json"],
    ),
    toolInteractionSchemaHash: calculateSha256(
      schemaFiles["WSGS_TOOL_INTERACTION_SCHEMA_LOCK.json"],
    ),
    revisionControlSchemaHash: calculateSha256(
      schemaFiles["WSGS_REVISION_CONTROL_SCHEMA_LOCK.json"],
    ),
    cancelSchemaHash: calculateSha256(
      schemaFiles["WSGS_CANCEL_SCHEMA_LOCK.json"],
    ),
    interventionSchemaHash: calculateSha256(
      schemaFiles["WSGS_INTERVENTION_SCHEMA_LOCK.json"],
    ),
    endpoints: {
      snapshot: "/v1/groundings/{groundingId}/analysis",
      events: "/v1/groundings/{groundingId}/analysis/events",
      compileRevision: "/v1/groundings/{groundingId}/analysis:compile-revision",
      cancel: "/v1/groundings/{groundingId}/analysis:cancel",
      resolveIntervention:
        "/v1/groundings/{groundingId}/analysis/interventions/{id}:resolve",
    },
    sequenceSemantics: "MONOTONIC_PER_UPSTREAM_ANALYSIS_ID",
    idempotencySemantics: "EVENT_ID_AND_SEQUENCE_PAYLOAD_HASH",
    recoverySemantics: "SNAPSHOT_THEN_LIVE_EVENTS",
    status: "READY",
  };
  mutateLock?.(lock);
  const files: Record<string, Uint8Array> = {
    "WSGS_ANALYSIS_CONSUMER_LOCK.json": jsonBytes(lock),
    ...schemaFiles,
  };
  const checkedHashes = Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [
      name,
      calculateSha256(bytes),
    ]),
  );
  files["CHECKSUMS.json"] = jsonBytes({
    schemaVersion: "wsgs-analysis-handoff-checksums/1.0",
    algorithm: "SHA-256",
    files: Object.entries(checkedHashes).map(([path, sha256]) => ({
      path,
      sha256,
    })),
    bundleHash: calculateCanonicalJsonHash(checkedHashes),
  });
  return files;
}

function event(
  overrides: Partial<WsgsAnalysisEventEnvelope> = {},
): WsgsAnalysisEventEnvelope {
  return {
    schemaVersion: "sacs-wsgs-analysis-event/1.0",
    eventId: "event-1",
    upstreamAnalysisId: "analysis-1",
    planId: "plan-1",
    planHash: hash,
    planRevision: 1,
    sequence: 1,
    eventType: "NODE_STARTED",
    nodeId: "node-1",
    correlationId: "correlation-1",
    occurredAt: "2026-08-30T00:00:00.000Z",
    payload: {},
    payloadHash: calculateCanonicalJsonHash({}),
    ...overrides,
  };
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function decode(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
