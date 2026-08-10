import { randomUUID } from "node:crypto";

import type { RunAgentInput } from "../../ag-ui-api-contract/src/index.js";
import {
  InteractionEventFactory,
  isSdarInteractionEvent,
  type SdarInteractionEvent,
} from "../../interaction-contract/src/index.js";
import {
  hashJson,
  type InteractionPersistenceRepository,
  type InteractionRun,
  type JsonValue,
} from "../../persistence/src/index.js";

export interface DurableAgUiRunContext {
  readonly input: RunAgentInput;
  readonly principalId: string;
  readonly threadId: string;
  readonly signal: AbortSignal;
}

export type DurableAgUiEventSource = (
  context: DurableAgUiRunContext,
) => AsyncIterable<SdarInteractionEvent>;

export interface DurableAgUiRunServiceOptions {
  readonly repository: InteractionPersistenceRepository;
  readonly execute: DurableAgUiEventSource;
  readonly recoverTask: (
    context: DurableAgUiRunContext,
    taskId: string,
  ) => AsyncIterable<SdarInteractionEvent>;
}

export class DurableAgUiRunService {
  constructor(private readonly options: DurableAgUiRunServiceOptions) {}

  async *run(
    context: DurableAgUiRunContext,
  ): AsyncGenerator<SdarInteractionEvent> {
    const requestHash = hashJson(context.input as unknown as JsonValue);
    const leaseOwner = randomUUID();
    const claim = await this.options.repository.claimRequest({
      protocol: "ag_ui",
      externalRequestId: context.input.runId,
      principalId: context.principalId,
      threadId: context.threadId,
      requestHash,
      leaseOwner,
    });
    if (claim.outcome === "conflict") {
      yield* safeRunFailure(
        context,
        "run_id_conflict",
        "The AG-UI run ID was reused with different input.",
      );
      return;
    }
    if (claim.outcome === "in_progress") {
      yield* safeRunFailure(
        context,
        "run_in_progress",
        "This AG-UI run is already being processed.",
      );
      return;
    }

    const run = await this.options.repository.startOrGetRun({
      runId: context.input.runId,
      protocol: "ag_ui",
      principalId: context.principalId,
      threadId: context.threadId,
      externalRequestId: context.input.runId,
    });
    const taskId = claim.outcome === "replay" ? claim.resultTaskId : run.taskId;
    if (taskId !== undefined) {
      const recovered: SdarInteractionEvent[] = [];
      for await (const event of this.options.recoverTask(context, taskId)) {
        recovered.push(event);
        if (run.status === "RUNNING") {
          await this.options.repository.updateRunProgress({
            runId: run.runId,
            principalId: context.principalId,
            lastSequence: event.sequence,
            taskId,
            ...(event.contextId === undefined
              ? {}
              : { contextId: event.contextId }),
          });
        }
        yield event;
        if (context.signal.aborted) break;
      }
      if (!context.signal.aborted && run.status === "RUNNING") {
        await this.options.repository.finishRun({
          runId: run.runId,
          principalId: context.principalId,
          status: terminalRunStatus(recovered),
          lastSequence: recovered.at(-1)?.sequence ?? run.lastSequence,
          outcome: { events: asJsonValue(recovered) },
          taskId,
          ...(run.contextId === undefined ? {} : { contextId: run.contextId }),
        });
      }
      if (claim.outcome === "acquired") {
        await this.options.repository.completeRequest({
          requestId: claim.requestId,
          principalId: context.principalId,
          leaseOwner,
          resultTaskId: taskId,
        });
      }
      return;
    }
    if (run.status !== "RUNNING") {
      const replay = replayEvents(run);
      if (replay.length === 0) {
        yield* safeRunFailure(
          context,
          "run_outcome_unavailable",
          "The durable AG-UI run outcome is unavailable.",
        );
      } else {
        yield* replay;
      }
      if (claim.outcome === "acquired") {
        await this.options.repository.completeRequest({
          requestId: claim.requestId,
          principalId: context.principalId,
          leaseOwner,
        });
      }
      return;
    }

    const events: SdarInteractionEvent[] = [];
    let latestTaskId: string | undefined;
    let latestContextId: string | undefined;
    let observationDisconnected = false;
    try {
      for await (const event of this.options.execute(context)) {
        events.push(event);
        latestTaskId = event.taskId ?? latestTaskId;
        latestContextId = event.contextId ?? latestContextId;
        await this.options.repository.updateRunProgress({
          runId: run.runId,
          principalId: context.principalId,
          lastSequence: event.sequence,
          ...(latestTaskId === undefined ? {} : { taskId: latestTaskId }),
          ...(latestContextId === undefined
            ? {}
            : { contextId: latestContextId }),
        });
        yield event;
        if (context.signal.aborted) break;
      }
    } finally {
      const submittedTaskId = await this.options.repository.findRequestResult({
        protocol: "ag_ui",
        externalRequestId: taskRequestId(context.input.runId),
        principalId: context.principalId,
        threadId: context.threadId,
      });
      latestTaskId = submittedTaskId ?? latestTaskId;
      if (latestTaskId !== undefined) {
        const binding = await this.options.repository.findAuthorizedTask({
          principalId: context.principalId,
          threadId: context.threadId,
          sdarTaskId: latestTaskId,
        });
        latestContextId = binding?.sdarContextId ?? latestContextId;
        await this.options.repository.updateRunProgress({
          runId: run.runId,
          principalId: context.principalId,
          lastSequence: events.at(-1)?.sequence ?? run.lastSequence,
          taskId: latestTaskId,
          ...(latestContextId === undefined
            ? {}
            : { contextId: latestContextId }),
        });
      }
      if (context.signal.aborted) {
        if (latestTaskId !== undefined && claim.outcome === "acquired") {
          await this.options.repository.completeRequest({
            requestId: claim.requestId,
            principalId: context.principalId,
            leaseOwner,
            resultTaskId: latestTaskId,
          });
        }
        observationDisconnected = true;
      }
    }
    if (observationDisconnected) return;

    const status = terminalRunStatus(events);
    await this.options.repository.finishRun({
      runId: run.runId,
      principalId: context.principalId,
      status,
      lastSequence: events.at(-1)?.sequence ?? run.lastSequence,
      outcome: { events: asJsonValue(events) },
      ...(latestTaskId === undefined ? {} : { taskId: latestTaskId }),
      ...(latestContextId === undefined ? {} : { contextId: latestContextId }),
    });
    if (claim.outcome === "acquired") {
      await this.options.repository.completeRequest({
        requestId: claim.requestId,
        principalId: context.principalId,
        leaseOwner,
        ...(latestTaskId === undefined ? {} : { resultTaskId: latestTaskId }),
      });
    }
  }
}

export function taskRequestId(runId: string): string {
  return `${runId}:task`;
}

function terminalRunStatus(
  events: readonly SdarInteractionEvent[],
): "FINISHED" | "ERROR" | "INTERRUPTED" {
  const last = events.at(-1)?.eventType;
  if (last === "run.error") return "ERROR";
  if (last === "input.required") return "INTERRUPTED";
  return "FINISHED";
}

function replayEvents(run: InteractionRun): readonly SdarInteractionEvent[] {
  const outcome = run.outcome;
  if (
    outcome === undefined ||
    outcome === null ||
    typeof outcome !== "object" ||
    Array.isArray(outcome)
  ) {
    return [];
  }
  const events = outcome.events;
  if (!Array.isArray(events)) return [];
  const replay: SdarInteractionEvent[] = [];
  for (const event of events) {
    if (isSdarInteractionEvent(event)) replay.push(event);
  }
  return replay;
}

function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function safeRunFailure(
  context: DurableAgUiRunContext,
  code: string,
  message: string,
): readonly SdarInteractionEvent[] {
  const factory = new InteractionEventFactory({
    runId: context.input.runId,
    threadId: context.input.threadId,
  });
  return [
    factory.create("run.started", { boundary: "bounded_interaction" }),
    factory.create("run.error", { code, message }),
  ].filter((event): event is SdarInteractionEvent => event !== undefined);
}
