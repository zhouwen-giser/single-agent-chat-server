import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyOpenWebUiUserJwt } from "../auth/openwebui-user.js";
import type { ServerConfig } from "../config.js";
import type { FixedWindowRateLimiter } from "../operations/rate-limiter.js";
import { relayAnalysisRequest } from "./transport.js";

export interface BrowserAnalysisEntry {
  analysisId: string;
  title: string;
  status: string;
  revisionId: string;
  revisionNumber: number;
  threadId: string;
}
export interface AnalysisWebOptions {
  config: ServerConfig;
  rateLimiter: FixedWindowRateLimiter;
  now?: () => number;
  listAnalyses?: (identity: {
    userId: string;
    userRole: string;
  }) => Promise<readonly BrowserAnalysisEntry[]>;
}
const sessionSchema = z.strictObject({
  jwt: z.string().min(1).max(4096),
  csrf: z.string().regex(/^[a-f0-9]{48}$/u),
  expiresAt: z.number().int().positive(),
});
const cookieName = "sacs_analysis";
const id = "[A-Za-z0-9][A-Za-z0-9._:-]{0,255}";
const controlPath = new RegExp(
  `^/api/v1/analyses/(${id})(?:/(snapshot|proposals|cancel)|/interventions/(${id}):resolve)?$`,
  "u",
);
const directorySchema = z
  .array(
    z.strictObject({
      analysisId: z.string().min(1).max(256),
      title: z.string().max(512),
      status: z.string().max(64),
      revisionId: z.string().max(256),
      revisionNumber: z.number().int().nonnegative(),
      threadId: z.string().min(1).max(256),
    }),
  )
  .max(100);

export const registerAnalysisWebRoutes: FastifyPluginAsync<
  AnalysisWebOptions
> = async (server, options) => {
  if (!options.config.analysisWebEnabled) return;
  const origin = options.config.analysisWebOrigin;
  if (!origin || options.config.authMode === "development-anonymous")
    throw Error("SACS_ANALYSIS_WEB_TRUSTED_IDENTITY_REQUIRED");
  const now = options.now ?? Date.now;
  const secret = options.config.openWebUiUserJwtSecret;
  const sign = (encoded: string) =>
    createHmac("sha256", secret)
      .update("analysis-web/session/v1:" + encoded)
      .digest("base64url");
  const identityFor = (jwt: string) =>
    verifyOpenWebUiUserJwt({
      token: jwt,
      secret,
      nowSeconds: Math.floor(now() / 1000),
      maximumLifetimeSeconds: 600,
      futureIatToleranceSeconds: 30,
    });
  const cookie = (value: string, age: number) =>
    `${cookieName}=${value}; Path=/analysis; Max-Age=${age}; HttpOnly; SameSite=Strict${origin.startsWith("https:") ? "; Secure" : ""}`;
  const readSession = (request: FastifyRequest) => {
    const raw = request.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (!raw || raw.length > 8192) return undefined;
    const [encoded, signature, extra] = raw.split(".");
    if (
      !encoded ||
      !signature ||
      extra !== undefined ||
      !/^[A-Za-z0-9_-]+$/u.test(signature)
    )
      return undefined;
    const actual = Buffer.from(signature, "base64url"),
      expected = Buffer.from(sign(encoded), "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return undefined;
    try {
      const parsed = sessionSchema.parse(
        JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
      );
      const identity = identityFor(parsed.jwt);
      if (
        !identity ||
        parsed.expiresAt <= Math.floor(now() / 1000) ||
        parsed.expiresAt > identity.expiresAt
      )
        return undefined;
      return { ...parsed, identity };
    } catch {
      return undefined;
    }
  };
  server.addHook("onRequest", async (request, reply) => {
    reply
      .header(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      )
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer")
      .header("cache-control", "no-store");
    if (
      request.headers["sec-fetch-site"] === "cross-site" ||
      (request.method === "POST" && request.headers.origin !== origin)
    )
      return reply
        .code(403)
        .send({ error: { code: "BROWSER_ORIGIN_REJECTED" } });
  });
  for (const [route, file, mime] of [
    ["/analysis", "index.html", "text/html; charset=utf-8"],
    ["/analysis/", "index.html", "text/html; charset=utf-8"],
    ["/analysis/app.js", "app.js", "application/javascript; charset=utf-8"],
    ["/analysis/style.css", "style.css", "text/css; charset=utf-8"],
  ])
    server.get(route!, async (_request, reply) => {
      const bytes = await readFile(
        resolve("dist/apps/analysis-web/public", file!),
      );
      return reply.type(mime!).send(bytes);
    });
  server.post("/analysis/session", async (request, reply) => {
    const limit = options.rateLimiter.consume("browser_login:" + request.ip);
    if (!limit.allowed)
      return reply.code(429).send({ error: { code: "RATE_LIMIT_EXCEEDED" } });
    const payload = z
      .strictObject({ jwt: z.string().min(1).max(4096) })
      .safeParse(request.body);
    const identity = payload.success
      ? identityFor(payload.data.jwt)
      : undefined;
    if (!payload.success || !identity)
      return reply
        .code(401)
        .send({ error: { code: "INVALID_SIGNED_IDENTITY" } });
    const expiresAt = Math.min(
      identity.expiresAt,
      Math.floor(now() / 1000) + 300,
    );
    const session = {
      jwt: payload.data.jwt,
      csrf: randomBytes(24).toString("hex"),
      expiresAt,
    };
    const encoded = Buffer.from(JSON.stringify(session)).toString("base64url");
    return reply
      .header(
        "set-cookie",
        cookie(
          encoded + "." + sign(encoded),
          expiresAt - Math.floor(now() / 1000),
        ),
      )
      .send({ csrf: session.csrf, expiresAt, userId: identity.userId });
  });
  server.get("/analysis/session", async (request, reply) => {
    const session = readSession(request);
    if (!session)
      return reply
        .code(401)
        .send({ error: { code: "BROWSER_SESSION_EXPIRED" } });
    return {
      csrf: session.csrf,
      expiresAt: session.expiresAt,
      userId: session.identity.userId,
    };
  });
  const authenticate = (request: FastifyRequest) => {
    const session = readSession(request);
    if (!session)
      throw Object.assign(Error("BROWSER_SESSION_EXPIRED"), {
        statusCode: 401,
      });
    if (
      request.method === "POST" &&
      request.headers["x-sacs-csrf"] !== session.csrf
    )
      throw Object.assign(Error("BROWSER_CSRF_REJECTED"), { statusCode: 403 });
    return session;
  };
  server.post("/analysis/logout", async (request, reply) => {
    authenticate(request);
    return reply.header("set-cookie", cookie("", 0)).send({ loggedOut: true });
  });
  server.get("/analysis/api/v1/analyses", async (request, reply) => {
    const { identity } = authenticate(request);
    if (!options.listAnalyses)
      return reply
        .code(503)
        .send({ error: { code: "ANALYSIS_DIRECTORY_UNAVAILABLE" } });
    return {
      analyses: directorySchema.parse(
        await options.listAnalyses({
          userId: identity.userId,
          userRole: identity.role,
        }),
      ),
    };
  });
  server.route({
    method: ["GET", "POST"],
    url: "/analysis/api/v1/*",
    handler: relay,
  });
  server.post("/analysis/ag-ui", relay);

  async function relay(
    request: FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) {
    const session = authenticate(request);
    let path: string;
    try {
      path = decodeURIComponent(request.url.slice("/analysis".length));
    } catch {
      return reply
        .code(404)
        .send({ error: { code: "BROWSER_ROUTE_UNAVAILABLE" } });
    }
    if (
      path.includes("?") ||
      path.includes("%") ||
      !(
        (request.method === "POST" && path === "/ag-ui") ||
        (request.method === "GET" &&
          path === "/api/v1/analysis-capabilities") ||
        (controlPath.test(path) &&
          ((request.method === "GET" &&
            !path.endsWith("/proposals") &&
            !path.endsWith("/cancel") &&
            !path.endsWith(":resolve")) ||
            (request.method === "POST" &&
              (path.endsWith("/proposals") ||
                path.endsWith("/cancel") ||
                path.endsWith(":resolve")))))
      )
    )
      return reply
        .code(404)
        .send({ error: { code: "BROWSER_ROUTE_UNAVAILABLE" } });
    // Restrict the reference browser to source queries; Native control is separate.
    if (
      path.endsWith("/proposals") &&
      (!request.body ||
        typeof request.body !== "object" ||
        (request.body as Record<string, unknown>)["kind"] !==
          "GROUNDING_SOURCE_QUERY")
    )
      return reply
        .code(400)
        .send({ error: { code: "BROWSER_QUERY_REQUIRED" } });
    const address = server.server.address();
    if (!address || typeof address === "string")
      throw Error("BROWSER_BRIDGE_NOT_LISTENING");
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(120000, session.expiresAt * 1000 - now()),
    );
    const detach = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.once("close", detach);
    let handedOff = false;
    try {
      const response = await relayAnalysisRequest({
        port: address.port,
        ipv6: address.family === "IPv6",
        path,
        method: request.method as "GET" | "POST",
        jwt: session.jwt,
        serviceKey: options.config.agUiServiceKey,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: controller.signal,
      });
      reply
        .code(response.status)
        .type(response.headers.get("content-type") ?? "application/json");
      if (
        response.headers.get("content-type")?.startsWith("text/event-stream")
      ) {
        reply
          .header("x-sacs-ag-ui-profile", "sacs-ag-ui-v0.3")
          .header("x-accel-buffering", "no");
        if (!response.body) throw Error("BROWSER_STREAM_UNAVAILABLE");
        // Stream through immediately; disconnect detaches the existing observer.
        const stream = Readable.fromWeb(
          response.body as import("node:stream/web").ReadableStream,
        );
        const cleanup = () => {
          clearTimeout(timer);
          reply.raw.off("close", detach);
        };
        handedOff = true;
        stream.once("end", cleanup);
        stream.once("close", cleanup);
        stream.once("error", cleanup);
        return reply.send(stream);
      }
      return reply.send(await response.json());
    } catch {
      return reply
        .code(502)
        .send({ error: { code: "BROWSER_BRIDGE_UNAVAILABLE" } });
    } finally {
      if (!handedOff) {
        clearTimeout(timer);
        reply.raw.off("close", detach);
      }
    }
  }
};
