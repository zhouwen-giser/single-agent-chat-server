import type { AnalysisControlTransport } from "../../../packages/analysis-client/src/index.js";
export class BrowserTransport implements AnalysisControlTransport {
  csrf = "";
  async request(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (
      !path.startsWith("/analysis/") ||
      path.includes("?") ||
      path.includes("#")
    )
      throw Error("BROWSER_ROUTE_UNAVAILABLE");
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        ...(method === "POST" ? { "x-sacs-csrf": this.csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
    return response;
  }
  async json(
    path: string,
    method: "GET" | "POST" = "GET",
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await this.request(path, method, body);
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw Error(
        response.status === 401
          ? "BROWSER_SESSION_EXPIRED"
          : String(
              (result["error"] as Record<string, unknown> | undefined)?.[
                "code"
              ] ?? "BROWSER_REQUEST_FAILED",
            ),
      );
    return result;
  }
  async send(input: Parameters<AnalysisControlTransport["send"]>[0]) {
    if (!input.path.startsWith("/api/v1/analyses/"))
      throw Error("BROWSER_ROUTE_UNAVAILABLE");
    const response = await this.request(
      "/analysis" + input.path,
      input.method,
      input.body,
    );
    return {
      status: response.status,
      body: (await response.json()) as unknown,
    };
  }
}
