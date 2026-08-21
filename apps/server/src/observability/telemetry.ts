import {
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Counter,
  type Histogram,
  type Meter,
  type Span,
  type Tracer,
  type UpDownCounter,
} from "@opentelemetry/api";

const allowedAttributeKeys = new Set([
  "operation",
  "outcome",
  "route",
  "status_class",
  "stream_kind",
]);

export function lowCardinalityAttributes(
  input: Readonly<Record<string, string>>,
): Attributes {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) =>
        allowedAttributeKeys.has(key) && /^[a-z0-9_.:/-]{1,64}$/u.test(value),
    ),
  );
}

export interface TimedOperation {
  end(outcome?: "ok" | "error" | "aborted"): void;
}

export class SecureTelemetry {
  private readonly tracer: Tracer | undefined;
  private readonly apiLatency: Pick<Histogram, "record">;
  private readonly chatLatency: Pick<Histogram, "record">;
  private readonly llmLatency: Pick<Histogram, "record">;
  private readonly a2aLatency: Pick<Histogram, "record">;
  private readonly requests: Pick<Counter, "add">;
  private readonly activeStreams: Pick<UpDownCounter, "add">;
  private activeTasks = 0;

  constructor(
    input: {
      readonly serviceName?: string;
      readonly meter?: Meter;
      readonly tracer?: Tracer;
      readonly now?: () => number;
    } = {},
  ) {
    const serviceName = input.serviceName ?? "single-agent-chat-server";
    const meter =
      input.meter ?? safelyValue(() => metrics.getMeter(serviceName));
    this.tracer =
      input.tracer ?? safelyValue(() => trace.getTracer(serviceName));
    this.now = input.now ?? Date.now;
    this.apiLatency =
      safelyValue(() =>
        meter?.createHistogram("chat_server.api.duration", { unit: "ms" }),
      ) ?? noOpHistogram;
    this.chatLatency =
      safelyValue(() =>
        meter?.createHistogram("chat_server.chat.duration", { unit: "ms" }),
      ) ?? noOpHistogram;
    this.llmLatency =
      safelyValue(() =>
        meter?.createHistogram("chat_server.llm.duration", { unit: "ms" }),
      ) ?? noOpHistogram;
    this.a2aLatency =
      safelyValue(() =>
        meter?.createHistogram("chat_server.a2a.duration", { unit: "ms" }),
      ) ?? noOpHistogram;
    this.requests =
      safelyValue(() => meter?.createCounter("chat_server.api.requests")) ??
      noOpCounter;
    this.activeStreams =
      safelyValue(() =>
        meter?.createUpDownCounter("chat_server.streams.active"),
      ) ?? noOpCounter;
    const activeTaskGauge = safelyValue(() =>
      meter?.createObservableGauge("chat_server.tasks.active"),
    );
    safely(() =>
      activeTaskGauge?.addCallback((observer) => {
        observer.observe(this.activeTasks);
      }),
    );
  }

  private readonly now: () => number;

  setActiveTasks(count: number): void {
    this.activeTasks = Math.max(0, Math.floor(count));
  }

  recordApi(input: {
    readonly route: string;
    readonly statusCode: number;
    readonly durationMs: number;
  }): void {
    const attributes = lowCardinalityAttributes({
      route: normalizeRoute(input.route),
      status_class: `${Math.floor(input.statusCode / 100)}xx`,
    });
    safely(() => this.apiLatency.record(input.durationMs, attributes));
    safely(() => this.requests.add(1, attributes));
  }

  beginChat(): TimedOperation {
    return this.begin("chat", this.chatLatency, {});
  }

  beginLlm(
    operation:
      "decide_turn" | "answer_general" | "summarize" | "explain_result",
  ): TimedOperation {
    return this.begin("llm", this.llmLatency, { operation });
  }

  beginA2a(operation: string): TimedOperation {
    return this.begin("a2a", this.a2aLatency, { operation });
  }

  streamStarted(kind: "a2a" | "openai"): void {
    safely(() =>
      this.activeStreams.add(
        1,
        lowCardinalityAttributes({ stream_kind: kind }),
      ),
    );
  }

  streamEnded(kind: "a2a" | "openai"): void {
    safely(() =>
      this.activeStreams.add(
        -1,
        lowCardinalityAttributes({ stream_kind: kind }),
      ),
    );
  }

  private begin(
    spanName: string,
    histogram: Pick<Histogram, "record">,
    attributes: Readonly<Record<string, string>>,
  ): TimedOperation {
    const startedAt = this.now();
    const safeAttributes = lowCardinalityAttributes(attributes);
    const span = safelyValue(() =>
      this.tracer?.startSpan(`chat_server.${spanName}`, {
        attributes: safeAttributes,
      }),
    );
    let ended = false;
    return {
      end: (outcome = "ok") => {
        if (ended) return;
        ended = true;
        const duration = Math.max(0, this.now() - startedAt);
        const finalAttributes = {
          ...safeAttributes,
          ...lowCardinalityAttributes({ outcome }),
        };
        safely(() => histogram.record(duration, finalAttributes));
        endSpan(span, outcome);
      },
    };
  }
}

const noOpHistogram = { record: () => undefined };
const noOpCounter = { add: () => undefined };

function endSpan(
  span: Span | undefined,
  outcome: "ok" | "error" | "aborted",
): void {
  if (span === undefined) return;
  safely(() =>
    span.setStatus({
      code: outcome === "error" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
    }),
  );
  safely(() => span.setAttribute("outcome", outcome));
  safely(() => span.end());
}

function normalizeRoute(route: string): string {
  return ["/health", "/ready", "/v1/models", "/v1/chat/completions"].includes(
    route,
  )
    ? route
    : "other";
}

function safely(operation: () => void): void {
  try {
    operation();
  } catch {
    // Telemetry must never affect the request path.
  }
}

function safelyValue<T>(operation: () => T): T | undefined {
  try {
    return operation();
  } catch {
    return undefined;
  }
}
