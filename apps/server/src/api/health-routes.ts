import type { FastifyPluginAsync } from "fastify";

export const registerHealthRoutes: FastifyPluginAsync = async (server) => {
  server.get("/health", async () => ({ status: "ok" }));
  server.get("/ready", async () => ({
    status: "ready",
    checks: { configuration: "ok" },
  }));
};
