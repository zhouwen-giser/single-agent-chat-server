import type { FastifyPluginAsync } from "fastify";

export interface HealthRoutesOptions {
  readonly readinessCheck?: () => Promise<boolean>;
  readonly conversationModelReadinessCheck?: () => Promise<boolean>;
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
    const conversationModel =
      options.conversationModelReadinessCheck === undefined
        ? undefined
        : await options.conversationModelReadinessCheck();
    if (postgres === false || conversationModel === false) {
      return reply.code(503).send({
        status: "not_ready",
        checks: {
          configuration: "ok",
          ...(postgres === undefined
            ? {}
            : { postgres: postgres ? "ok" : "unavailable" }),
          ...(conversationModel === undefined
            ? {}
            : {
                conversationModel: conversationModel ? "ok" : "unavailable",
              }),
        },
      });
    }
    return {
      status: "ready",
      checks: {
        configuration: "ok",
        ...(postgres === undefined ? {} : { postgres: "ok" }),
        ...(conversationModel === undefined ? {} : { conversationModel: "ok" }),
      },
    };
  });
};
