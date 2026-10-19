import { randomBytes, randomUUID, createHmac, createHash } from "node:crypto";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import pg from "pg";
import { describe, it, expect, jest } from "@jest/globals";
import { canonicalJson } from "../packages/world-explanation-contract/src/index.js";
import { parseAndVerifyAgUiSharedStateV03 } from "../packages/analysis-contract/src/index.js";
import {
  FrozenWorldAnalysisContract,
  WSGS_V12_HEADERS,
  publicResultHash,
  publicFindingSetHash,
  type GroundingRequest12,
  type GroundingResult12,
} from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import { frozenResult, publicExample } from "./helpers/frozen-wsgs-http.js";
const db = process.env.TEST_DATABASE_URL,
  container = process.env.SACS_TEST_POSTGRES_CONTAINER;
const suite = db && container ? describe : describe.skip;
jest.setTimeout(360000);
const exec = promisify(execFile),
  sha = (v: string) => "sha256:" + createHash("sha256").update(v).digest("hex");
type Message = {
  event: string;
  point?: string;
  pid: number;
  url?: string;
  [key: string]: unknown;
};
interface Worker {
  child: ChildProcess;
  pid: number;
  url: string;
  messages: Message[];
  exit?: { code: number | null; signal: NodeJS.Signals | null };
  wait: (point: string) => Promise<Message>;
}
interface Row {
  grounding_id: string;
  analysis_intent_json: { analysisId: string; revisionId: string };
  canonical_request_json: GroundingRequest12;
  request_hash: string;
  idempotency_key: string;
  wsgs_grounding_id: string | null;
  last_source_status: string | null;
  cancel_requested: boolean;
  lease_until: Date | null;
}
interface Job {
  name: string;
  request: GroundingRequest12;
  id: string;
  jobId: string;
  result: GroundingResult12;
  raws: string[];
  keys: string[];
  gets: number;
  cancelPosts: number;
  cancelled: boolean;
  held?: ServerResponse;
}
const deadline = async <T>(
  read: () => Promise<T | undefined>,
  ms = 30000,
): Promise<T> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error("FAULT_CHECK_DEADLINE");
};
suite("actual consumer subprocess crash and database recovery", () => {
  it("preserves all fault windows, cancellation, dual-worker fencing and late history with production lease/tick", async () => {
    const startedAt = Date.now(),
      name = "sacs_process_" + randomUUID().replaceAll("-", "");
    const admin = new pg.Pool({ connectionString: db, max: 1 });
    admin.on("error", () => undefined);
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(db!);
    url.pathname = "/" + name;
    const pool = new pg.Pool({
      connectionString: url.href,
      max: 3,
      connectionTimeoutMillis: 1500,
    });
    pool.on("error", () => undefined);
    const secrets = {
      chat: randomBytes(24).toString("hex"),
      agui: randomBytes(24).toString("hex"),
      jwt: randomBytes(24).toString("hex"),
    };
    const contract = new FrozenWorldAnalysisContract(),
      jobs = new Map<string, Job>(),
      workers: Worker[] = [],
      requestPromises: Promise<unknown>[] = [],
      trace: Record<string, unknown>[] = [];
    let upstream: Server | undefined,
      finish = false,
      sequence = 0;
    const evidence: {
      status: string;
      leaseMs: number;
      recoveryTickMs: number;
      cases: Record<string, unknown>[];
      lifecycle: Record<string, unknown>[];
      elapsedMs?: number;
      cleanup?: string;
      failure?: string;
    } = {
      status: "RUNNING",
      leaseMs: 180000,
      recoveryTickMs: 30000,
      cases: [],
      lifecycle: trace,
    };
    const headers = () => {
      const encode = (v: unknown) =>
          Buffer.from(JSON.stringify(v)).toString("base64url"),
        at = Math.floor(Date.now() / 1000),
        h = encode({ alg: "HS256", typ: "JWT" }),
        p = encode({
          iss: "open-webui",
          sub: "process-user",
          role: "user",
          iat: at - 1,
          exp: at + 599,
        });
      return {
        authorization: "Bearer " + secrets.agui,
        "x-openwebui-user-jwt":
          h +
          "." +
          p +
          "." +
          createHmac("sha256", secrets.jwt)
            .update(h + "." + p)
            .digest("base64url"),
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-sacs-ag-ui-profile": "sacs-ag-ui-v0.3",
      };
    };
    async function worker(point?: string): Promise<Worker> {
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) =>
            !/^(?:CHAT_|AG_UI_|OPENWEBUI_|SDAR_|WSGS_|SACS_|DATABASE_|POSTGRES_|CONVERSATION_|TEST_DATABASE_URL)/u.test(
              key,
            ),
        ),
      );
      Object.assign(environment, {
        NODE_ENV: "test",
        TEST_DATABASE_URL: url.href,
        SACS_TEST_CHAT_KEY: secrets.chat,
        SACS_TEST_AGUI_KEY: secrets.agui,
        SACS_TEST_JWT_KEY: secrets.jwt,
        SACS_TEST_WSGS_URL: upstreamUrl,
        SACS_TEST_FAULT_POINT: point ?? "",
      });
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "tests/harness/v06-source-process.ts"],
        {
          cwd: process.cwd(),
          env: environment,
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      const messages: Message[] = [];
      let output = "";
      child.stdout?.on("data", (chunk) => {
        output += String(chunk).slice(0, 1024);
      });
      child.stderr?.on("data", (chunk) => {
        output += String(chunk).slice(0, 1024);
      });
      child.on("message", (m) => messages.push(m as Message));
      const ready = await deadline(
        async () => messages.find((m) => m.event === "ready"),
        20000,
      ).catch((error) => {
        throw Error(
          "WORKER_BOOT_FAILED:" + sha(output) + ":" + (error as Error).message,
        );
      });
      const record: Worker = {
        child,
        pid: ready.pid,
        url: String(ready.url),
        messages,
        wait: async (p) =>
          deadline(
            async () =>
              messages.find((m) => m.event === "fault" && m.point === p),
            15000,
          ),
      };
      child.once("exit", (code, signal) => {
        record.exit = { code, signal };
        trace.push({
          event: "exit",
          pid: record.pid,
          code,
          signal,
          atMs: Date.now() - startedAt,
        });
      });
      workers.push(record);
      trace.push({
        event: "start",
        pid: record.pid,
        atMs: Date.now() - startedAt,
      });
      return record;
    }
    async function kill(w: Worker) {
      const exit = once(w.child, "exit");
      w.child.kill("SIGKILL");
      await exit;
      expect(w.exit?.signal).toBe("SIGKILL");
    }
    function start(w: Worker, label: string) {
      const promise = fetch(w.url + "/ag-ui", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          threadId: "thread-" + label,
          runId: "start-" + label,
          state: {},
          messages: [
            {
              id: "message-" + label,
              role: "user",
              content: "查询历史轨迹 fault-case-" + label,
            },
          ],
          tools: [],
          context: [],
          forwardedProps: { mode: "START" },
        }),
      })
        .then(async (response) => {
          await response.text();
        })
        .catch(() => undefined);
      requestPromises.push(promise);
    }
    const rowFor = async (label: string) =>
      (
        await pool.query<Row>(
          "SELECT grounding_id,analysis_intent_json,canonical_request_json,request_hash,idempotency_key,wsgs_grounding_id,last_source_status,cancel_requested,lease_until FROM chat_service.grounding_execution WHERE canonical_request_json->'source'->>'originalText' LIKE $1",
          ["%fault-case-" + label],
        )
      ).rows[0];
    async function snapshot(w: Worker, row: Row) {
      const response = await fetch(
        w.url +
          "/api/v1/analyses/" +
          row.analysis_intent_json.analysisId +
          "/snapshot",
        { headers: headers() },
      );
      if (!response.ok) return undefined;
      return parseAndVerifyAgUiSharedStateV03(
        JSON.parse(await response.text()),
      );
    }
    let upstreamUrl = "";
    try {
      upstream = createServer(async (req, res) => {
        let value: unknown;
        const reply = (v: unknown, status = 200) => {
          res.writeHead(status, {
            "content-type": "application/json",
            ...WSGS_V12_HEADERS,
          });
          res.end(JSON.stringify(v));
        };
        if (req.url === "/v1/capabilities") {
          reply(publicExample("capabilities"));
          return;
        }
        if (req.method === "POST" && req.url === "/v1/groundings") {
          const chunks: Buffer[] = [];
          for await (const part of req) chunks.push(Buffer.from(part));
          const raw = Buffer.concat(chunks).toString();
          const request = contract.parse("request", JSON.parse(raw));
          const label = /fault-case-([a-z]+)/u.exec(
            request.source.originalText,
          )?.[1];
          if (!label) {
            reply({}, 400);
            return;
          }
          const key = String(req.headers["idempotency-key"]);
          let job = jobs.get(key);
          if (job) {
            expect(canonicalJson(job.request)).toBe(canonicalJson(request));
            job.raws.push(raw);
            job.keys.push(key);
          } else {
            const result = frozenResult("trace", request);
            result.groundingId = "process-grounding-" + ++sequence;
            result.worldAnalysisFindings.findingSetHash = publicFindingSetHash(
              result.worldAnalysisFindings,
            );
            result.resultHash = publicResultHash(result);
            contract.parse("result", result);
            job = {
              name: label,
              request,
              id: result.groundingId,
              jobId: "process-job-" + sequence,
              result,
              raws: [raw],
              keys: [key],
              gets: 0,
              cancelPosts: 0,
              cancelled: false,
            };
            jobs.set(key, job);
          }
          if (label === "unsure" && job.raws.length === 1) {
            job.held = res;
            return;
          }
          value = {
            schemaVersion: "1.0",
            requestId: request.requestId,
            groundingId: job.id,
            jobId: job.jobId,
            status: "ACCEPTED",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          reply(contract.parse("job", value), 202);
          return;
        }
        const job = [...jobs.values()].find((j) =>
          req.url?.startsWith("/v1/groundings/" + j.id),
        );
        if (!job) {
          reply({}, 404);
          return;
        }
        if (req.method === "POST" && req.url?.endsWith(":cancel")) {
          job.cancelPosts++;
          job.cancelled = job.name !== "cancel" || job.cancelPosts > 1;
          if (job.name === "cancel" && job.cancelPosts === 1) {
            job.held = res;
            return;
          }
        } else job.gets++;
        const terminal =
          finish || job.name === "terminal" || job.name === "new";
        value = {
          schemaVersion: "1.0",
          requestId: job.request.requestId,
          groundingId: job.id,
          jobId: job.jobId,
          status: job.cancelled
            ? "CANCELLED"
            : terminal
              ? "COMPLETED"
              : "RUNNING",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...(job.cancelled || terminal
            ? { finishedAt: new Date().toISOString() }
            : {}),
          ...(!job.cancelled && terminal ? { result: job.result } : {}),
        };
        reply(contract.parse("job", value));
      });
      upstream.listen(0, "127.0.0.1");
      await once(upstream, "listening");
      const address = upstream.address();
      if (!address || typeof address === "string")
        throw Error("UPSTREAM_FIXTURE_FAILED");
      upstreamUrl = "http://127.0.0.1:" + address.port;
      const initial = new Map<string, Row>();
      for (const [label, point] of [
        ["prepare", "after-claim"],
        ["bind", "after-source-id"],
        ["running", "after-running"],
        ["terminal", "after-terminal"],
        ["late", "after-running"],
      ] as const) {
        const w = await worker(point);
        start(w, label);
        await w.wait(point);
        const row = await rowFor(label);
        expect(row).toBeDefined();
        expect(row.request_hash).toBe(
          sha(canonicalJson(row.canonical_request_json)).slice(7),
        );
        initial.set(label, row);
        await kill(w);
      }
      const uncertain = await worker();
      start(uncertain, "unsure");
      await deadline(async () =>
        [...jobs.values()].find((j) => j.name === "unsure" && j.held),
      );
      const uncertainRow = await rowFor("unsure");
      expect(uncertainRow.wsgs_grounding_id).toBeNull();
      initial.set("unsure", uncertainRow);
      await kill(uncertain);
      const cancelled = await worker();
      start(cancelled, "cancel");
      const cancelRow = await deadline(async () => {
        const row = await rowFor("cancel");
        return row?.last_source_status === "RUNNING" ? row : undefined;
      });
      initial.set("cancel", cancelRow);
      const cancelState = await snapshot(cancelled, cancelRow);
      expect(cancelState).toBeDefined();
      const cancelRequest = fetch(
        cancelled.url +
          "/api/v1/analyses/" +
          cancelRow.analysis_intent_json.analysisId +
          "/cancel",
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            commandId: "cancel-owned",
            idempotencyKey: "cancel-owned",
            expectedRevisionId: cancelState!.analysis.activeRevisionId,
            expectedRevisionNumber: 0,
            reason: "USER_REQUESTED",
          }),
        },
      )
        .then((r) => r.text())
        .catch(() => undefined);
      requestPromises.push(cancelRequest);
      await deadline(async () =>
        [...jobs.values()].find((j) => j.name === "cancel" && j.held),
      );
      expect((await rowFor("cancel")).cancel_requested).toBe(true);
      const pending = await snapshot(cancelled, cancelRow);
      expect(
        Object.values(pending!.analysis.runsById).some(
          (r) => r.status === "CANCEL_REQUESTED",
        ),
      ).toBe(true);
      expect((await rowFor("cancel")).last_source_status).not.toBe("CANCELLED");
      await kill(cancelled);
      const alive = await worker();
      start(alive, "outage");
      const outageRow = await deadline(async () => {
        const row = await rowFor("outage");
        return row?.last_source_status === "RUNNING" ? row : undefined;
      });
      initial.set("outage", outageRow);
      trace.push({
        event: "database-restart-begin",
        pid: alive.pid,
        atMs: Date.now() - startedAt,
      });
      await exec("docker", ["restart", "--time", "1", container!]);
      await deadline(async () => {
        try {
          await pool.query("SELECT 1");
          return true;
        } catch {
          return undefined;
        }
      }, 30000);
      expect(alive.exit).toBeUndefined();
      trace.push({
        event: "database-reopen",
        pid: alive.pid,
        atMs: Date.now() - startedAt,
      });
      const second = await worker();
      const old = initial.get("late")!,
        oldState = await snapshot(second, old);
      expect(oldState).toBeDefined();
      const proposal = {
        kind: "GROUNDING_SOURCE_QUERY",
        commandId: "late-replace",
        idempotencyKey: "late-replace",
        expectedRevisionId: oldState!.analysis.activeRevisionId,
        expectedRevisionNumber: 0,
        originalText: "查询历史轨迹 fault-case-new",
        contextMode: "REPLACE",
      };
      const responses = await Promise.all(
        [alive, second].map((w) =>
          fetch(
            w.url +
              "/api/v1/analyses/" +
              old.analysis_intent_json.analysisId +
              "/proposals",
            {
              method: "POST",
              headers: headers(),
              body: JSON.stringify(proposal),
            },
          ),
        ),
      );
      expect(responses.some((r) => r.status === 202)).toBe(true);
      for (const response of responses)
        expect([202, 409]).toContain(response.status);
      expect([...jobs.values()].filter((j) => j.name === "new")).toHaveLength(
        1,
      );
      const newState = await deadline(async () => {
        const state = await snapshot(second, old);
        return state?.analysis.session.latestRevisionNumber === 1 &&
          state.worldExplanation?.["status"] === "COMPLETED"
          ? state
          : undefined;
      });
      finish = true;
      process.stdout.write(
        JSON.stringify({
          event: "faults.staged",
          count: initial.size,
          leaseMs: 180000,
          recoveryTickMs: 30000,
        }) + "\n",
      );
      for (const [label, row] of initial) {
        const state = await deadline(async () => {
          try {
            const current = await rowFor(label);
            if (
              current.last_source_status !==
              (label === "cancel" ? "CANCELLED" : "COMPLETED")
            )
              return undefined;
            const state = await snapshot(second, current);
            if (!state) return undefined;
            if (
              label !== "late" &&
              state.worldExplanation?.["status"] !==
                (label === "cancel" ? "CANCELLED" : "COMPLETED")
            )
              return undefined;
            return state;
          } catch {
            return undefined;
          }
        }, 260000);
        const current = await rowFor(label),
          job = [...jobs.values()].find((j) => j.name === label)!;
        expect(current.request_hash).toBe(row.request_hash);
        expect(current.idempotency_key).toBe(row.idempotency_key);
        expect(canonicalJson(current.canonical_request_json)).toBe(
          canonicalJson(row.canonical_request_json),
        );
        if (label !== "prepare" && label !== "unsure")
          expect(current.wsgs_grounding_id).toBe(row.wsgs_grounding_id);
        expect(job.raws).toHaveLength(label === "unsure" ? 2 : 1);
        expect(
          new Set(job.raws.map((raw) => sha(canonicalJson(JSON.parse(raw)))))
            .size,
        ).toBe(1);
        expect(new Set(job.keys).size).toBe(1);
        if (label === "late")
          expect(state.analysis.activeRevisionId).toBe(
            newState.analysis.activeRevisionId,
          );
        evidence.cases.push({
          name: label,
          status: "PASS",
          canonicalRequestSha256: "sha256:" + current.request_hash,
          postAttempts: job.raws.length,
          logicalJobs: 1,
          getCalls: job.gets,
          cancelPosts: job.cancelPosts,
          sourceStatus: current.last_source_status,
          recoveredAtMs: Date.now() - startedAt,
        });
      }
      const history = await pool.query(
        "SELECT payload_json FROM chat_service.analysis_event WHERE analysis_id=$1 AND revision_id=$2 AND event_type='GROUNDING_SOURCE_OBSERVED'",
        [
          old.analysis_intent_json.analysisId,
          old.analysis_intent_json.revisionId,
        ],
      );
      expect(history.rows.length).toBeGreaterThan(0);
      const final = await snapshot(second, old);
      expect(final?.analysis.activeRevisionId).toBe(
        newState.analysis.activeRevisionId,
      );
      expect(final?.meta.snapshotHash).toBe(newState.meta.snapshotHash);
      const unique = await pool.query(
        "SELECT count(*)::int AS total FROM chat_service.grounding_execution",
      );
      expect(unique.rows[0].total).toBe(initial.size + 1);
      evidence.status = "PASS";
    } catch (error) {
      evidence.status = "FAILED";
      evidence.failure = error instanceof Error ? error.message : "UNKNOWN";
      throw error;
    } finally {
      for (const w of workers)
        if (!w.exit) {
          const ended = once(w.child, "exit");
          w.child.kill("SIGTERM");
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            ended,
            new Promise((resolve) => {
              timer = setTimeout(resolve, 5000);
            }),
          ]);
          if (timer) clearTimeout(timer);
          if (!w.exit) {
            w.child.kill("SIGKILL");
            await ended;
          }
        }
      upstream?.closeAllConnections();
      await new Promise<void>((resolve) =>
        upstream ? upstream.close(() => resolve()) : resolve(),
      );
      await Promise.all(requestPromises);
      await pool.end();
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
        evidence.cleanup = "PASS";
      } catch {
        evidence.cleanup = "DATABASE_DROP_FAILED_CONTAINER_OWNER_WILL_REMOVE";
      }
      await admin.end();
      evidence.elapsedMs = Date.now() - startedAt;
      const folder =
        process.env.SACS_PROCESS_EVIDENCE_DIR ?? ".tmp/v06-process";
      await mkdir(folder, { recursive: true });
      await writeFile(
        folder + "/EVIDENCE.json",
        JSON.stringify(evidence, null, 2) + "\n",
      );
    }
  });
});
