import type {
  WsgsAnalysisEventDecision,
  WsgsAnalysisEventEnvelope,
  WsgsAnalysisPresentationPort,
} from "../../wsgs-analysis-consumer/src/index.js";
import { WsgsAnalysisEventIntegrityGuard } from "../../wsgs-analysis-consumer/src/index.js";

export interface PersistedAnalysisEmission<TPublished> {
  readonly disposition: WsgsAnalysisEventDecision["disposition"];
  readonly published: readonly TPublished[];
}

export interface AnalysisEventCommitter<TPublished> {
  commit(
    decision: WsgsAnalysisEventDecision,
  ): Promise<PersistedAnalysisEmission<TPublished>>;
}

export type AnalysisEmissionListener<TPublished> = (event: TPublished) => void;

export class AnalysisEventPump<TSnapshot, TPublished> {
  private readonly listeners = new Set<AnalysisEmissionListener<TPublished>>();
  private readonly stopController = new AbortController();
  private started = false;
  private completed: Promise<void> | undefined;

  constructor(
    private readonly presentation: WsgsAnalysisPresentationPort<TSnapshot>,
    private readonly committer: AnalysisEventCommitter<TPublished>,
    private readonly guard: WsgsAnalysisEventIntegrityGuard,
  ) {}

  start(groundingId: string, afterSequence = 0): Promise<void> {
    if (this.started) throw new Error("ANALYSIS_EVENT_PUMP_ALREADY_STARTED");
    this.started = true;
    this.completed = this.run(groundingId, afterSequence);
    return this.completed;
  }

  subscribe(listener: AnalysisEmissionListener<TPublished>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): void {
    this.stopController.abort();
  }

  get completion(): Promise<void> | undefined {
    return this.completed;
  }

  private async run(groundingId: string, afterSequence: number): Promise<void> {
    let retryCount = 0;
    let cursor = afterSequence;
    for (;;) {
      try {
        for await (const rawEvent of this.presentation.subscribeAnalysisEvents(
          groundingId,
          cursor === 0 ? undefined : cursor,
        )) {
          if (this.stopController.signal.aborted) return;
          const decision = this.guard.prepare(rawEvent);
          if (decision.disposition === "IDEMPOTENT_DUPLICATE") {
            cursor = Math.max(cursor, decision.event.sequence);
            continue;
          }
          const persisted = await this.committer.commit(decision);
          if (persisted.disposition !== decision.disposition) {
            throw new Error("ANALYSIS_EVENT_COMMIT_DISPOSITION_MISMATCH");
          }
          this.guard.accept(decision);
          cursor = Math.max(cursor, decision.event.sequence);
          for (const published of persisted.published) {
            for (const listener of this.listeners) listener(published);
          }
        }
        return;
      } catch (error) {
        if (this.stopController.signal.aborted) return;
        if (retryCount >= 1 || isProtocolFailure(error)) throw error;
        retryCount += 1;
      }
    }
  }
}

export function createAnalysisEventPump<TSnapshot, TPublished>(input: {
  readonly presentation: WsgsAnalysisPresentationPort<TSnapshot>;
  readonly committer: AnalysisEventCommitter<TPublished>;
  readonly activePlan: ConstructorParameters<
    typeof WsgsAnalysisEventIntegrityGuard
  >[0];
}): AnalysisEventPump<TSnapshot, TPublished> {
  return new AnalysisEventPump(
    input.presentation,
    input.committer,
    new WsgsAnalysisEventIntegrityGuard(input.activePlan),
  );
}

export function isWsgsAnalysisEvent(
  value: unknown,
): value is WsgsAnalysisEventEnvelope {
  return (
    value !== null &&
    typeof value === "object" &&
    "schemaVersion" in value &&
    value.schemaVersion === "sacs-wsgs-analysis-event/1.0"
  );
}

function isProtocolFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(?:COLLISION|OUT_OF_ORDER|MISMATCH|UNKNOWN_EVENT|INVALID)/u.test(
      error.message,
    )
  );
}
