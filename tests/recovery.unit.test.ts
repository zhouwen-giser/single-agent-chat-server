import { EventEmitter } from "node:events";

import { describe, expect, it, jest } from "@jest/globals";
import Fastify from "fastify";

import { createLazySdarClient } from "../apps/server/src/chat/lazy-sdar-client.js";
import { installGracefulShutdown } from "../apps/server/src/shutdown.js";
import type { SdarA2aClient } from "../packages/sdar-a2a-adapter/src/index.js";

describe("runtime recovery helpers", () => {
  it("shares an in-flight SDAR discovery and retries after a temporary outage", async () => {
    const client = { endpoint: "http://sdar.test/a2a" } as SdarA2aClient;
    const factory = jest
      .fn<() => Promise<SdarA2aClient>>()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValue(client);
    const getClient = createLazySdarClient(factory);

    const first = getClient();
    const concurrent = getClient();
    expect(first).toBe(concurrent);
    await expect(first).rejects.toThrow("temporary outage");
    await expect(getClient()).resolves.toBe(client);
    await expect(getClient()).resolves.toBe(client);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("closes Fastify exactly once and removes shutdown listeners", async () => {
    const server = Fastify();
    let closeCount = 0;
    server.addHook("onClose", async () => {
      closeCount += 1;
    });
    const signals = new EventEmitter() as EventEmitter & {
      exitCode?: string | number | null;
    };
    const control = installGracefulShutdown(server, signals);

    const first = control.shutdown("SIGTERM");
    const second = control.shutdown("SIGINT");
    expect(first).toBe(second);
    await first;

    expect(closeCount).toBe(1);
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });
});
