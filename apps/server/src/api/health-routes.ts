import type { FastifyPluginAsync } from "fastify";

export interface HealthRoutesOptions {
  readonly readinessCheck?: () => Promise<boolean>;
}

export const registerHealthRoutes: FastifyPluginAsync<
  HealthRoutesOptions
> = async (server, options) => {
  server.get("/health", async () => ({ status: "ok" }));
  server.get("/ready", async (_request, reply) => {
    const postgres =
      options.readinessCheck === undefined
        ? undefined
        : await options.readinessCheck();
    if (postgres === false) {
      return reply.code(503).send({
        status: "not_ready",
        checks: { configuration: "ok", postgres: "unavailable" },
      });
    }
    return {
      status: "ready",
      checks: {
        configuration: "ok",
        ...(postgres === undefined ? {} : { postgres: "ok" }),
      },
    };
  });
};
