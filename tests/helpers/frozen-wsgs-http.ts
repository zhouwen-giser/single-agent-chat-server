import { createServer, type IncomingHttpHeaders } from "node:http";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import {
  WSGS_V12_HEADERS,
  type GroundingRequest12,
  type GroundingResult12,
  publicResultHash,
} from "../../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";

export const publicExample = <T>(name: string): T =>
  JSON.parse(
    readFileSync(
      `dependencies/wsgs-world-analysis-v1/public/examples/${name}.json`,
      "utf8",
    ),
  ) as T;
export const frozenRequest = () =>
  publicExample<GroundingRequest12>("request-first");
export function frozenResult(
  name = "ranking",
  request = frozenRequest(),
): GroundingResult12 {
  const result = publicExample<GroundingResult12>(name);
  result.requestId = request.requestId;
  result.source = {
    messageId: request.source.messageId,
    originalTextSha256: request.source.originalTextSha256,
  };
  result.resultHash = publicResultHash(result);
  return result;
}
export function frozenJob(status = "ACCEPTED", result?: GroundingResult12) {
  return {
    ...publicExample<Record<string, unknown>>("job-accepted"),
    requestId: frozenRequest().requestId,
    status,
    ...(result
      ? {
          requestId: result.requestId,
          groundingId: result.groundingId,
          status: result.status,
          result,
          finishedAt: "2026-09-06T10:00:00.000+08:00",
        }
      : {}),
  };
}
export interface CapturedWsgsRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}
export interface WireReply {
  value?: unknown;
  status?: number;
  headers?: Record<string, string | string[]>;
  raw?: string;
  drop?: boolean;
}
/** Network peer only. Tests use the production HTTP/Source/runtime implementations. */
export async function startFrozenWsgsPeer(
  reply: (request: CapturedWsgsRequest, index: number) => WireReply,
) {
  const captured: CapturedWsgsRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const part of request) chunks.push(Buffer.from(part));
    const item = {
      method: request.method!,
      path: request.url!,
      headers: request.headers,
      body: Buffer.concat(chunks).toString(),
    };
    captured.push(item);
    const next = reply(item, captured.length - 1);
    if (next.drop) {
      response.destroy();
      return;
    }
    response.writeHead(next.status ?? 200, {
      "content-type": "application/json",
      ...(next.headers ?? WSGS_V12_HEADERS),
    });
    response.end(next.raw ?? JSON.stringify(next.value));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("FIXTURE_LISTEN_FAILED");
  return {
    captured,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
