import type { FastifyPluginAsync } from "fastify";

export interface HealthRoutesOptions {
  readonly readinessCheck?: () => Promise<boolean>;
  readonly conversationModelReadinessCheck?: () => Promise<boolean>;
  readonly analysisReadinessCheck?: () => Promise<
    "disabled" | "ready" | "unavailable"
  >;
}

export const registerHealthRoutes: FastifyPluginAsync<
  HealthRoutesOptions
> = async (server, options) => {
  server.get("/health", async () => ({ status: "ok" }));
  server.get("/ready", async (_request, reply) => {
    const [postgres, conversationModel, wsgsGrounding] = await Promise.all([
      options.readinessCheck?.(),
      options.conversationModelReadinessCheck?.(),
      options.analysisReadinessCheck?.(),
    ]);
    if (
      postgres === false ||
      conversationModel === false ||
      wsgsGrounding === "unavailable"
    ) {
      return reply.code(503).send({
        status: "not_ready",
        checks: {
          configuration: "ok",
          ...(wsgsGrounding === undefined ? {} : { wsgsGrounding }),
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
        ...(wsgsGrounding === undefined ? {} : { wsgsGrounding }),
        ...(postgres === undefined ? {} : { postgres: "ok" }),
        ...(conversationModel === undefined ? {} : { conversationModel: "ok" }),
      },
    };
  });
};
