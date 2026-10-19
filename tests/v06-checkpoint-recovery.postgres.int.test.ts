import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect } from "@jest/globals";
import pg from "pg";
import { createPostgresCheckpointer } from "../packages/persistence/src/checkpoint.js";
const db = process.env.TEST_DATABASE_URL,
  container = process.env.SACS_TEST_POSTGRES_CONTAINER;
const suite = db && container ? describe : describe.skip;
const exec = promisify(execFile);
suite(
  "checkpoint persisted state across actual private PostgreSQL restart",
  () => {
    it("retains saved channels and uses a fresh connection after idle clients die", async () => {
      const name = "sacs_checkpoint_" + randomUUID().replaceAll("-", "");
      const admin = new pg.Pool({ connectionString: db, max: 1 });
      admin.on("error", () => undefined);
      await admin.query(`CREATE DATABASE "${name}"`);
      const url = new URL(db!);
      url.pathname = "/" + name;
      const cp = await createPostgresCheckpointer(url.href, {
        poolMax: 2,
        operationTimeoutMs: 1500,
      });
      try {
        const saved = await cp.put(
          {
            configurable: { thread_id: "checkpoint-proof", checkpoint_ns: "" },
          },
          {
            v: 4,
            id: randomUUID(),
            ts: new Date().toISOString(),
            channel_values: { answer: "published state" },
            channel_versions: { answer: 1 },
            versions_seen: {},
          },
          { source: "input", step: 0, parents: {} },
          { answer: 1 },
        );
        const before = await cp.getTuple(saved);
        expect(before?.checkpoint.channel_values["answer"]).toBe(
          "published state",
        );
        await exec("docker", ["restart", "--time", "1", container!]);
        let after: typeof before;
        const end = Date.now() + 20000;
        while (Date.now() < end) {
          try {
            after = await cp.getTuple(saved);
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        expect(after?.checkpoint.id).toBe(before?.checkpoint.id);
        expect(after?.checkpoint.channel_values).toEqual(
          before?.checkpoint.channel_values,
        );
      } finally {
        await cp.end();
        await admin.query(`DROP DATABASE "${name}"`);
        await admin.end();
      }
    });
  },
);
