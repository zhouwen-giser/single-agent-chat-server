import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  AnalysisServiceError,
  createUnavailableAnalysisControlService,
  type AnalysisControlService,
  type AnalysisRequestScope,
} from "../../../../packages/analysis-control-runtime/src/index.js";
import { analysisPatchOperationSchema } from "../../../../packages/analysis-contract/src/index.js";
import {
  createOpenWebUiUserAuthenticator,
  requireOpenWebUiIdentity,
} from "../auth/openwebui-user.js";
import { createServiceKeyAuthenticator } from "../auth/service-key.js";
import type { ServerConfig } from "../config.js";
import type { FixedWindowRateLimiter } from "../operations/rate-limiter.js";

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

const proposalCommandSchema = z
  .object({
    commandId: identifier,
    proposalId: identifier,
    expectedRevisionId: identifier,
    expectedRevisionNumber: z.number().int().min(0),
    targetNodeId: identifier,
    publicArgsHash: sha256,
    editSchemaHash: sha256,
    patch: z.array(analysisPatchOperationSchema).min(1).max(64),
    mode: z.enum(["SUGGEST_NEXT_REVISION", "INTERRUPT_AND_APPLY"]),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict();

const cancelCommandSchema = z
  .object({
    commandId: identifier,
    expectedRevisionId: identifier,
    expectedRevisionNumber: z.number().int().min(0),
    idempotencyKey: z.string().min(1).max(256),
    reason: z.enum(["USER_REQUESTED", "REVISION_RESTART"]),
  })
  .strict();

const interventionResolutionSchema = z
  .object({
    commandId: identifier,
    idempotencyKey: z.string().min(1).max(256),
    response: z.record(z.string(), z.unknown()),
  })
  .strict();

export interface AnalysisRoutesOptions {
  readonly config: ServerConfig;
  readonly rateLimiter: FixedWindowRateLimiter;
  readonly service?: AnalysisControlService;
  readonly now?: () => number;
}

export const registerAnalysisRoutes: FastifyPluginAsync<
  AnalysisRoutesOptions
> = async (server, options) => {
  const service = options.service ?? createUnavailableAnalysisControlService();
  server.addHook(
    "preHandler",
    createServiceKeyAuthenticator(options.config.agUiServiceKey),
  );
  server.addHook(
    "preHandler",
    createOpenWebUiUserAuthenticator({
      secret: options.config.openWebUiUserJwtSecret,
      now: options.now ?? Date.now,
    }),
  );
  server.addHook("preHandler", async (request, reply) => {
    if (reply.sent) return;
    const identity = requireOpenWebUiIdentity(request);
    const decision = options.rateLimiter.consume(
      `analysis_control:${identity.userId}`,
    );
    if (!decision.allowed) {
      await reply
        .header("retry-after", decision.retryAfterSeconds)
        .code(429)
        .send(apiError("rate_limit_exceeded", "Rate limit exceeded."));
    }
  });

  server.get<{ Params: { analysisId: string } }>(
    "/api/v1/analyses/:analysisId",
    async (request, reply) => {
      return sendResult(reply, () =>
        service.getAnalysis(requestScope(request.params.analysisId, request)),
      );
    },
  );

  server.get<{ Params: { analysisId: string } }>(
    "/api/v1/analyses/:analysisId/snapshot",
    async (request, reply) => {
      return sendResult(reply, () =>
        service.getSnapshot(requestScope(request.params.analysisId, request)),
      );
    },
  );

  server.post<{ Params: { analysisId: string } }>(
    "/api/v1/analyses/:analysisId/proposals",
    async (request, reply) => {
      return sendResult(
        reply,
        () =>
          service.submitProposal(
            requestScope(request.params.analysisId, request),
            parseBody(proposalCommandSchema, request.body),
          ),
        202,
      );
    },
  );

  server.post<{ Params: { analysisId: string } }>(
    "/api/v1/analyses/:analysisId/cancel",
    async (request, reply) => {
      return sendResult(
        reply,
        () =>
          service.requestCancel(
            requestScope(request.params.analysisId, request),
            parseBody(cancelCommandSchema, request.body),
          ),
        202,
      );
    },
  );

  server.post<{
    Params: { analysisId: string; "*": string };
  }>("/api/v1/analyses/:analysisId/interventions/*", async (request, reply) => {
    return sendResult(reply, () =>
      service.resolveIntervention(
        {
          ...requestScope(request.params.analysisId, request),
          interventionId: parseInterventionResolutionPath(request.params["*"]),
        },
        parseBody(interventionResolutionSchema, request.body),
      ),
    );
  });
};

function parseInterventionResolutionPath(path: string): string {
  const suffix = ":resolve";
  if (!path.endsWith(suffix)) {
    throw new AnalysisServiceError(
      404,
      "ANALYSIS_INTERVENTION_NOT_FOUND",
      "Analysis intervention was not found.",
    );
  }
  const parsed = identifier.safeParse(path.slice(0, -suffix.length));
  if (!parsed.success) {
    throw new AnalysisServiceError(
      404,
      "ANALYSIS_INTERVENTION_NOT_FOUND",
      "Analysis intervention was not found.",
    );
  }
  return parsed.data;
}

function requestScope(
  rawAnalysisId: string,
  request: FastifyRequest,
): AnalysisRequestScope {
  const parsed = identifier.safeParse(rawAnalysisId);
  if (!parsed.success) {
    throw new AnalysisServiceError(
      404,
      "ANALYSIS_NOT_FOUND",
      "Analysis was not found.",
    );
  }
  const identity = requireOpenWebUiIdentity(request);
  return {
    analysisId: parsed.data,
    userId: identity.userId,
    userRole: identity.role,
  };
}

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AnalysisServiceError(
      400,
      "INVALID_ANALYSIS_COMMAND",
      "Invalid analysis command.",
    );
  }
  return parsed.data;
}

async function sendResult(
  reply: FastifyReply,
  operation: () => Promise<unknown | undefined>,
  successStatus = 200,
) {
  try {
    const result = await operation();
    if (result === undefined) {
      return reply
        .code(404)
        .send(apiError("ANALYSIS_NOT_FOUND", "Analysis was not found."));
    }
    return reply.code(successStatus).send(result);
  } catch (error) {
    if (error instanceof AnalysisServiceError) {
      return reply
        .code(error.statusCode)
        .send(apiError(error.code, error.message));
    }
    throw error;
  }
}

function apiError(code: string, message: string) {
  return { error: { code, message, type: "analysis_control_error" } };
}
