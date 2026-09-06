import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import pg from "pg";
import {
  AnalysisRepository,
  GroundingPersistenceRepository,
  InteractionPersistenceRepository,
  runMigrations,
} from "../packages/persistence/src/index.js";
import { WorldGroundingRuntime } from "../packages/world-grounding-runtime/src/index.js";
import {
  createWsgsHttpClient,
  type WsgsGroundingRequest,
} from "../packages/wsgs-http-adapter/src/index.js";
import { WSGS_V11_HEADERS } from "../packages/wsgs-geospatial-consumer/src/authoritative.js";
import { hashCanonicalJson } from "../packages/world-explanation-contract/src/index.js";
import type { AnalysisSourceSnapshot } from "../packages/analysis-contract/src/source.js";
const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
suite("v06 durable Grounding lifecycle", () => {
  const name = "sacs_v06_lifecycle_" + randomUUID().replaceAll("-", "");
  const url = new URL(connectionString!);
  url.pathname = "/" + name;
  const admin = new pg.Pool({ connectionString, max: 1 });
  const pool = new pg.Pool({ connectionString: url.href });
  const grounding = new GroundingPersistenceRepository(pool, 180_000);
  const requests = new InteractionPersistenceRepository(pool, 180_000, 8);
  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${name}"`);
    await runMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  });
  async function seed() {
    const id = randomUUID();
    const principalId = "p-" + id;
    const threadId = "t-" + id;
    const interactionRequestId = "ir-" + id;
    await pool.query(
      "INSERT INTO chat_service.principal(principal_id,issuer,subject,role) VALUES($1,'v06',$1,'user')",
      [principalId],
    );
    await pool.query(
      "INSERT INTO chat_service.conversation_thread(thread_id,principal_id) VALUES($1,$2)",
      [threadId, principalId],
    );
    await pool.query(
      "INSERT INTO chat_service.interaction_request(request_id,protocol,external_request_id,principal_id,thread_id,request_hash,status,lease_owner,lease_until) VALUES($1,'openai',$1,$2,$3,$4,'CLAIMED','owner',now()+interval '1 hour')",
      [interactionRequestId, principalId, threadId, "a".repeat(64)],
    );
    const body = {
      ...read(
        "dependencies/wsgs-v06/legacy/examples/01-reference-name-grounding.json",
      ),
      requestId: "request-" + id,
    } as WsgsGroundingRequest;
    return {
      principalId,
      threadId,
      interactionRequestId,
      groundingExecutionId: "local-" + id,
      analysisId: "a-" + id,
      revisionId: "r-" + id,
      requestId: body.requestId,
      canonicalGroundingRequest: body,
      requestHash: hashCanonicalJson(body),
      idempotencyKey: "key-" + id,
      leaseOwner: "owner-1",
    };
  }
  function runtime(fetchImpl: typeof fetch) {
    return new WorldGroundingRuntime({
      grounding,
      requests,
      wsgs: createWsgsHttpClient({
        baseUrl: "http://wsgs.test",
        contractVersion: "sacs-wsgs-grounding/1.1",
        fetchImpl,
      }),
      sdarCompatibilityLock: read(
        "dependencies/sdar-grounding-extension-compatibility-lock.json",
      ),
    });
  }
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: WSGS_V11_HEADERS });
  function job(input: Awaited<ReturnType<typeof seed>>, status = "ACCEPTED") {
    return {
      schemaVersion: "1.0",
      jobId: "job-" + input.requestId,
      groundingId: "remote-" + input.requestId,
      requestId: input.requestId,
      status,
      createdAt: "2026-09-06T00:00:00Z",
      updatedAt: "2026-09-06T00:00:00Z",
    };
  }
  const scope = (input: Awaited<ReturnType<typeof seed>>) => ({
    groundingId: input.groundingExecutionId,
    principalId: input.principalId,
    threadId: input.threadId,
  });
  it("persists exact intent before network, returns ACCEPTED and replays without resubmission", async () => {
    const input = await seed();
    const fetchImpl = jest.fn<typeof fetch>(async (url) => {
      expect((await grounding.get(scope(input)))?.canonicalRequest).toEqual(
        input.canonicalGroundingRequest,
      );
      return String(url).endsWith("capabilities")
        ? json(
            read(
              "dependencies/wsgs-v06/examples/capabilities-response-v1.1.json",
            ),
          )
        : json(job(input), 202);
    });
    const r = runtime(fetchImpl);
    expect(await r.beginWorldGrounding(input)).toMatchObject({
      lastSourceStatus: "ACCEPTED",
      state: "GROUNDING_PENDING",
    });
    await r.beginWorldGrounding(input);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const altered = {
      ...input.canonicalGroundingRequest,
      requestId: "different",
    };
    await expect(
      r.beginWorldGrounding({
        ...input,
        requestId: "different",
        canonicalGroundingRequest: altered,
        requestHash: hashCanonicalJson(altered),
      }),
    ).rejects.toThrow("idempotency");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("recovers the post-send/pre-bind crash using identical canonical bytes and key", async () => {
    const input = await seed();
    const sends: string[] = [];
    let crash = true;
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url).endsWith("capabilities"))
        return json(
          read(
            "dependencies/wsgs-v06/examples/capabilities-response-v1.1.json",
          ),
        );
      sends.push(
        String(init?.body) +
          "|" +
          new Headers(init?.headers).get("idempotency-key"),
      );
      if (crash) throw Error("simulated response loss");
      return json(job(input), 202);
    };
    await expect(runtime(fetchImpl).beginWorldGrounding(input)).rejects.toThrow(
      "WSGS_TRANSPORT_ERROR",
    );
    await pool.query(
      "UPDATE chat_service.grounding_execution SET lease_until=now()-interval '1 second',version=version+1 WHERE grounding_id=$1",
      [input.groundingExecutionId],
    );
    crash = false;
    const reclaimed = await grounding.claimRecoverable({
      leaseOwner: "owner-2",
    });
    expect(
      reclaimed.some(
        (e) =>
          e.groundingId === input.groundingExecutionId &&
          e.canonicalRequest !== undefined,
      ),
    ).toBe(true);
    await runtime(fetchImpl).beginWorldGrounding({
      ...input,
      leaseOwner: "owner-2",
    });
    expect(sends).toHaveLength(2);
    expect(sends[0]).toBe(sends[1]);
  });
  it("deduplicates source observations, rejects terminal reopening and denies another scope", async () => {
    const input = await seed();
    await runtime(async (url) =>
      String(url).endsWith("capabilities")
        ? json(
            read(
              "dependencies/wsgs-v06/examples/capabilities-response-v1.1.json",
            ),
          )
        : json(job(input), 202),
    ).beginWorldGrounding(input);
    const snapshot: AnalysisSourceSnapshot = {
      identity: {
        kind: "WSGS_GROUNDING_JOB",
        sourceId: job(input).groundingId,
        sourceHash: input.requestHash,
        upstreamRunId: job(input).jobId,
      },
      sourceStatus: "RUNNING",
      terminal: false,
      observedAt: new Date().toISOString(),
    };
    expect(
      (
        await grounding.recordSourceSnapshot({
          ...scope(input),
          leaseOwner: input.leaseOwner,
          snapshot,
        })
      ).changed,
    ).toBe(true);
    const count = (await grounding.events(scope(input))).length;
    expect(
      (
        await grounding.recordSourceSnapshot({
          ...scope(input),
          leaseOwner: input.leaseOwner,
          snapshot,
        })
      ).changed,
    ).toBe(false);
    expect(await grounding.events(scope(input))).toHaveLength(count);
    await grounding.recordSourceSnapshot({
      ...scope(input),
      leaseOwner: input.leaseOwner,
      snapshot: { ...snapshot, sourceStatus: "CANCELLED", terminal: true },
    });
    await expect(
      grounding.recordSourceSnapshot({
        ...scope(input),
        leaseOwner: input.leaseOwner,
        snapshot,
      }),
    ).rejects.toThrow("ANALYSIS_SOURCE_TERMINAL_IMMUTABLE");
    expect(
      await grounding.get({ ...scope(input), threadId: "unknown" }),
    ).toBeUndefined();
  });
  it("keeps cancel intent across process recovery without claiming cancellation", async () => {
    const input = await seed();
    await runtime(async (url) =>
      String(url).endsWith("capabilities")
        ? json(
            read(
              "dependencies/wsgs-v06/examples/capabilities-response-v1.1.json",
            ),
          )
        : json(job(input), 202),
    ).beginWorldGrounding(input);
    await grounding.requestSourceCancellation(scope(input));
    expect(
      await new GroundingPersistenceRepository(pool, 180_000).get(scope(input)),
    ).toMatchObject({
      cancelRequested: true,
      lastSourceStatus: "ACCEPTED",
      state: "GROUNDING_PENDING",
    });
    await expect(
      pool.query(
        "UPDATE chat_service.grounding_execution SET canonical_request_json='{}',version=version+1 WHERE grounding_id=$1",
        [input.groundingExecutionId],
      ),
    ).rejects.toThrow("GROUNDING_SOURCE_INTENT_IMMUTABLE");
  });
  it("atomically binds a scoped revision/run and projects each semantic observation once", async () => {
    const input = await seed();
    const execution = await runtime(async (url) =>
      String(url).endsWith("capabilities")
        ? json(
            read(
              "dependencies/wsgs-v06/examples/capabilities-response-v1.1.json",
            ),
          )
        : json(job(input), 202),
    ).beginWorldGrounding(input);
    const analysis = new AnalysisRepository(pool);
    const analysisScope = {
      analysisId: input.analysisId,
      principalId: input.principalId,
      threadId: input.threadId,
    };
    const binding = {
      scope: analysisScope,
      groundingExecutionId: input.groundingExecutionId,
      revisionId: input.revisionId,
      runId: "run-" + input.requestId,
      leaseOwner: input.leaseOwner,
      title: "World analysis",
    };
    await analysis.bindGroundingSource(binding);
    await analysis.bindGroundingSource(binding);
    expect(
      await analysis.getRevisionSource(analysisScope, input.revisionId),
    ).toMatchObject({
      kind: "WSGS_GROUNDING_JOB",
      sourceId: job(input).groundingId,
    });
    const projection = await analysis.projectGroundingSource({
      ...binding,
      observationHash: execution.lastObservationHash!,
      state: { status: "RUNNING" },
    });
    expect(projection?.lastEventSequence).toBe(1);
    expect(
      (
        await analysis.projectGroundingSource({
          ...binding,
          observationHash: execution.lastObservationHash!,
          state: { status: "RUNNING" },
        })
      )?.lastEventSequence,
    ).toBe(1);
    expect(
      await analysis.projectGroundingSource({
        ...binding,
        runId: "old-run",
        observationHash: execution.lastObservationHash!,
        state: { status: "RUNNING" },
      }),
    ).toBeUndefined();
    await expect(
      analysis.bindGroundingSource({
        ...binding,
        scope: { ...analysisScope, principalId: "foreign" },
      }),
    ).rejects.toThrow("ANALYSIS_NOT_FOUND");
  });
});
