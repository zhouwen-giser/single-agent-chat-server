/** Exact same-process loopback bridge. No user URL or inbound headers are forwarded. */
export function relayAnalysisRequest(input: {
  port: number;
  ipv6: boolean;
  path: string;
  method: "GET" | "POST";
  jwt: string;
  serviceKey: string;
  body?: unknown;
  signal: AbortSignal;
}): Promise<Response> {
  if (
    !Number.isInteger(input.port) ||
    input.port < 1 ||
    input.port > 65535 ||
    !input.path.startsWith("/") ||
    input.path.startsWith("//")
  )
    throw Error("BROWSER_BRIDGE_TARGET_INVALID");
  return fetch(
    `http://${input.ipv6 ? "[::1]" : "127.0.0.1"}:${input.port}${input.path}`,
    {
      method: input.method,
      signal: input.signal,
      redirect: "error",
      headers: {
        authorization: "Bearer " + input.serviceKey,
        "x-openwebui-user-jwt": input.jwt,
        "content-type": "application/json",
        accept:
          input.path === "/ag-ui" ? "text/event-stream" : "application/json",
        "x-sacs-ag-ui-profile": "sacs-ag-ui-v0.3",
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    },
  );
}
