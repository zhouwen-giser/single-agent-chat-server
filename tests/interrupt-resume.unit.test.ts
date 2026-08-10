import { describe, expect, it } from "@jest/globals";
import { EventType } from "@ag-ui/core";

import { AgUiEventProjection } from "../packages/ag-ui-interaction-adapter/src/index.js";

import { InteractionEventFactory } from "../packages/interaction-contract/src/index.js";
import {
  InterruptResumeService,
  persistInterruptsBeforeRunFinish,
  type InterruptResumeRepository,
} from "../packages/interaction-runtime/src/index.js";
import type {
  InterruptBinding,
  InterruptResolutionClaim,
  TaskBinding,
} from "../packages/persistence/src/index.js";
import type {
  FollowUpInput,
  NormalizedSendResult,
  NormalizedTask,
  SdarA2aClient,
} from "../packages/sdar-a2a-adapter/src/index.js";

describe("durable AG-UI Interrupt and Resume", () => {
  it("persists a phase-specific interrupt before yielding run finish input", async () => {
    const repository = new FakeInterruptRepository();
    const service = createService(repository, fakeClient([]));
    const event = inputRequiredEvent("awaiting_user_input", "input-1");
    const source = persistInterruptsBeforeRunFinish(events(event), {
      service,
      principalId: "principal-1",
    });

    const first = await source.next();

    expect(first.value).toMatchObject({
      eventId: event.eventId,
      eventType: "input.required",
      payload: {
        internalPhase: "awaiting_user_input",
        inputRequestId: "input-1",
        expiresAt: "2026-08-12T00:00:00.000Z",
      },
    });
    const projected = new AgUiEventProjection().project(required(first.value));
    expect(
      projected.find(({ type }) => type === EventType.RUN_FINISHED),
    ).toMatchObject({
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: "run-1:input-required",
            reason: "sdar.input_required",
            expiresAt: "2026-08-12T00:00:00.000Z",
          },
        ],
      },
    });
    expect(repository.operations).toEqual(["createInterrupt"]);
    expect(repository.interrupt).toMatchObject({
      interruptId: "run-1:input-required",
      taskId: "task-1",
      contextId: "context-1",
      internalPhase: "awaiting_user_input",
      reason: "sdar.input_required",
      inputRequestId: "input-1",
      status: "OPEN",
      expiresAt: "2026-08-12T00:00:00.000Z",
    });
  });

  it("claims, sends one strict Follow-up, commits, and replays idempotently", async () => {
    const repository = repositoryWithInterrupt("awaiting_user_input");
    const calls: FollowUpInput[] = [];
    const service = createService(repository, fakeClient(calls));
    const runInput = {
      threadId: "external-thread",
      runId: "resume-run",
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
      resume: [
        {
          interruptId: "run-1:input-required",
          status: "resolved" as const,
          payload: {
            action: "provide_input",
            text: "published answer",
            data: { answer: 42 },
            inputRequestId: "input-1",
          },
        },
      ],
    };

    await expect(
      service.resolveRunInput({
        runInput,
        principalId: "principal-1",
        threadId: "thread-1",
      }),
    ).resolves.toMatchObject({
      kind: "resolved",
      interrupt: { status: "RESOLVED" },
    });
    await expect(
      service.resolveRunInput({
        runInput,
        principalId: "principal-1",
        threadId: "thread-1",
      }),
    ).resolves.toMatchObject({ kind: "replay" });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      taskId: "task-1",
      contextId: "context-1",
      action: "provide_input",
      text: "published answer",
      inputRequestId: "input-1",
      data: { answer: 42 },
    });
    expect(calls[0]?.messageId).toMatch(/^resume-[a-f0-9]{48}$/u);
    expect(repository.operations).toEqual([
      "claim:acquired",
      "complete",
      "claim:replay",
    ]);
  });

  it("rejects conflict, cross identity, schema mismatch, and multi-resume before A2A", async () => {
    const repository = repositoryWithInterrupt("awaiting_user_input", {
      responseSchema: {
        type: "object",
        additionalProperties: false,
        required: ["action", "data", "inputRequestId"],
        properties: {
          action: { enum: ["provide_input"] },
          data: {
            type: "object",
            additionalProperties: false,
            required: ["answer"],
            properties: { answer: { type: "string" } },
          },
          inputRequestId: { enum: ["input-1"] },
        },
      },
    });
    const calls: FollowUpInput[] = [];
    const service = createService(repository, fakeClient(calls));
    const entry = {
      interruptId: "run-1:input-required",
      status: "resolved" as const,
      payload: {
        action: "provide_input",
        data: { answer: 42 },
        inputRequestId: "input-1",
      },
    };

    await expect(
      service.resolve({
        entry,
        principalId: "other-principal",
        threadId: "thread-1",
      }),
    ).rejects.toMatchObject({ code: "interrupt_not_found" });
    await expect(
      service.resolve({
        entry,
        principalId: "principal-1",
        threadId: "thread-1",
      }),
    ).rejects.toMatchObject({ code: "invalid_resume" });
    await expect(
      service.resolveRunInput({
        runInput: {
          threadId: "external-thread",
          runId: "resume-run",
          state: {},
          messages: [],
          tools: [],
          context: [],
          forwardedProps: {},
          resume: [entry, entry],
        },
        principalId: "principal-1",
        threadId: "thread-1",
      }),
    ).rejects.toMatchObject({ code: "invalid_resume" });
    expect(calls).toHaveLength(0);
    expect(repository.operations).toEqual([]);
  });

  it("rejects a stale durable phase after current getTask validation", async () => {
    const repository = repositoryWithInterrupt("paused");
    const calls: FollowUpInput[] = [];
    const client = fakeClient(calls);
    const service = new InterruptResumeService({
      repository,
      getClient: async () => ({
        ...client,
        getTask: async () => task("WORKING"),
      }),
    });

    await expect(
      service.resolve({
        entry: {
          interruptId: "run-1:input-required",
          status: "resolved",
          payload: { action: "resume" },
        },
        principalId: "principal-1",
        threadId: "thread-1",
      }),
    ).rejects.toMatchObject({ code: "interrupt_conflict" });
    expect(calls).toHaveLength(0);
    expect(repository.operations).toEqual([]);
  });

  it("cancels an interrupt locally without inferring SDAR cancellation", async () => {
    const repository = repositoryWithInterrupt("paused");
    const calls: FollowUpInput[] = [];
    const service = createService(repository, fakeClient(calls));
    const entry = {
      interruptId: "run-1:input-required",
      status: "cancelled",
    };

    await expect(
      service.resolve({
        entry,
        principalId: "principal-1",
        threadId: "thread-1",
      }),
    ).resolves.toMatchObject({
      kind: "cancelled",
      interrupt: { status: "CANCELLED" },
    });
    await expect(
      service.resolve({
        entry,
        principalId: "principal-1",
        threadId: "thread-1",
      }),
    ).resolves.toMatchObject({ kind: "replay" });
    expect(calls).toHaveLength(0);
  });

  it("leaves an uncertain Follow-up RESOLVING so restart cannot resend it", async () => {
    const repository = repositoryWithInterrupt("paused");
    let calls = 0;
    const client = fakeClient([], async () => {
      calls += 1;
      throw new Error("uncertain network result");
    });
    const service = createService(repository, client);
    const entry = {
      interruptId: "run-1:input-required",
      status: "resolved" as const,
      payload: { action: "resume" },
    };

    await expect(
      service.resolve({
        entry,
        principalId: "principal-1",
        threadId: "thread-1",
      }),
    ).rejects.toThrow("uncertain network result");
    await expect(
      createService(repository, client).resolve({
        entry,
        principalId: "principal-1",
        threadId: "thread-1",
      }),
    ).rejects.toMatchObject({ code: "interrupt_in_progress" });
    expect(calls).toBe(1);
    expect(repository.interrupt?.status).toBe("RESOLVING");
  });

  it("maps every supported internal phase to its frozen reason", async () => {
    for (const [phase, reason] of [
      ["awaiting_plan_confirmation", "sdar.plan_confirmation"],
      ["awaiting_user_input", "sdar.input_required"],
      ["paused", "sdar.paused"],
    ] as const) {
      const repository = new FakeInterruptRepository();
      const service = createService(repository, fakeClient([]));
      await service.persistInputRequired({
        event: inputRequiredEvent(
          phase,
          phase === "awaiting_user_input" ? "input-1" : undefined,
        ),
        principalId: "principal-1",
      });
      expect(repository.interrupt?.reason).toBe(reason);
    }
  });
});

class FakeInterruptRepository implements InterruptResumeRepository {
  interrupt: InterruptBinding | undefined;
  readonly operations: string[] = [];
  readonly task: TaskBinding = {
    bindingId: "binding-1",
    threadId: "thread-1",
    sdarTaskId: "task-1",
    sdarContextId: "context-1",
    status: "INPUT_REQUIRED",
    version: 0,
  };

  async createInterrupt(
    input: Parameters<InterruptResumeRepository["createInterrupt"]>[0],
  ): Promise<InterruptBinding> {
    this.operations.push("createInterrupt");
    this.interrupt = { ...input, status: "OPEN", version: 0 };
    return this.interrupt;
  }

  async findInterrupt(
    input: Parameters<InterruptResumeRepository["findInterrupt"]>[0],
  ): Promise<InterruptBinding | undefined> {
    return this.matches(input) ? this.interrupt : undefined;
  }

  async findOpenInterruptForTask(
    input: Parameters<InterruptResumeRepository["findOpenInterruptForTask"]>[0],
  ): Promise<InterruptBinding | undefined> {
    return this.interrupt?.status === "OPEN" && this.matches(input)
      ? this.interrupt
      : undefined;
  }

  async findAuthorizedTask(
    input: Parameters<InterruptResumeRepository["findAuthorizedTask"]>[0],
  ): Promise<TaskBinding | undefined> {
    return input.principalId === "principal-1" &&
      input.threadId === "thread-1" &&
      input.sdarTaskId === this.task.sdarTaskId
      ? this.task
      : undefined;
  }

  async claimInterruptResolution(
    input: Parameters<InterruptResumeRepository["claimInterruptResolution"]>[0],
  ): Promise<InterruptResolutionClaim> {
    const interrupt = this.interrupt;
    if (interrupt === undefined || !this.matches(input)) {
      return { outcome: "not_found" };
    }
    if (interrupt.status === "RESOLVED") {
      const outcome =
        interrupt.resolutionHash === input.resolutionHash
          ? "replay"
          : "conflict";
      this.operations.push(`claim:${outcome}`);
      return { outcome, interrupt };
    }
    if (interrupt.status === "RESOLVING") {
      const outcome =
        interrupt.resolutionHash === input.resolutionHash
          ? "in_progress"
          : "conflict";
      this.operations.push(`claim:${outcome}`);
      return { outcome, interrupt };
    }
    this.interrupt = {
      ...interrupt,
      status: "RESOLVING",
      resolutionHash: input.resolutionHash,
      resolutionClaimedAt: "2026-08-11T00:00:00.000Z",
      version: interrupt.version + 1,
    };
    this.operations.push("claim:acquired");
    return { outcome: "acquired", interrupt: this.interrupt };
  }

  async completeInterruptResolution(
    input: Parameters<
      InterruptResumeRepository["completeInterruptResolution"]
    >[0],
  ): Promise<InterruptBinding> {
    const interrupt = required(this.interrupt);
    this.interrupt = {
      ...interrupt,
      status: "RESOLVED",
      resolvedAt: "2026-08-11T00:00:01.000Z",
      version: interrupt.version + 1,
    };
    expect(input.resolutionHash).toBe(interrupt.resolutionHash);
    this.operations.push("complete");
    return this.interrupt;
  }

  async cancelInterrupt(
    input: Parameters<InterruptResumeRepository["cancelInterrupt"]>[0],
  ): Promise<InterruptResolutionClaim> {
    const interrupt = this.interrupt;
    if (interrupt === undefined || !this.matches(input)) {
      return { outcome: "not_found" };
    }
    if (interrupt.status === "CANCELLED") {
      return interrupt.resolutionHash === input.resolutionHash
        ? { outcome: "replay", interrupt }
        : { outcome: "conflict", interrupt };
    }
    this.interrupt = {
      ...interrupt,
      status: "CANCELLED",
      resolutionHash: input.resolutionHash,
      resolvedAt: "2026-08-11T00:00:00.000Z",
      version: interrupt.version + 1,
    };
    return { outcome: "acquired", interrupt: this.interrupt };
  }

  private matches(input: {
    readonly principalId: string;
    readonly threadId: string;
    readonly interruptId?: string;
    readonly taskId?: string;
  }): boolean {
    return (
      this.interrupt !== undefined &&
      input.principalId === this.interrupt.principalId &&
      input.threadId === this.interrupt.threadId &&
      (input.interruptId === undefined ||
        input.interruptId === this.interrupt.interruptId) &&
      (input.taskId === undefined || input.taskId === this.interrupt.taskId)
    );
  }
}

function createService(
  repository: FakeInterruptRepository,
  client: SdarA2aClient,
): InterruptResumeService {
  return new InterruptResumeService({
    repository,
    getClient: async () => ({
      ...client,
      getTask: async () => ({
        ...task("INPUT_REQUIRED"),
        ...(repository.interrupt?.internalPhase === undefined
          ? {}
          : { internalPhase: repository.interrupt.internalPhase }),
        ...(repository.interrupt?.inputRequestId === undefined
          ? {}
          : { inputRequestId: repository.interrupt.inputRequestId }),
      }),
    }),
    now: () => new Date("2026-08-11T00:00:00.000Z"),
  });
}

function repositoryWithInterrupt(
  phase: InterruptBinding["internalPhase"],
  overrides: Partial<InterruptBinding> = {},
): FakeInterruptRepository {
  const repository = new FakeInterruptRepository();
  repository.interrupt = {
    interruptId: "run-1:input-required",
    runId: "run-1",
    principalId: "principal-1",
    threadId: "thread-1",
    taskId: "task-1",
    contextId: "context-1",
    internalPhase: phase,
    reason:
      phase === "awaiting_plan_confirmation"
        ? "sdar.plan_confirmation"
        : phase === "awaiting_user_input"
          ? "sdar.input_required"
          : "sdar.paused",
    ...(phase === "awaiting_user_input" ? { inputRequestId: "input-1" } : {}),
    expiresAt: "2026-08-12T00:00:00.000Z",
    status: "OPEN",
    version: 0,
    ...overrides,
  };
  return repository;
}

function fakeClient(
  calls: FollowUpInput[],
  send: (input: FollowUpInput) => Promise<NormalizedSendResult> = async () => ({
    kind: "task",
    task: task("WORKING"),
  }),
): SdarA2aClient {
  return {
    protocolBinding: "HTTP+JSON",
    protocolVersion: "1.0",
    endpoint: "http://sdar.test/a2a",
    submitTaskStream: async function* () {
      yield* [];
    },
    sendFollowUp: async (input) => {
      calls.push(input);
      return send(input);
    },
    getTask: async () => task("WORKING"),
    cancelTask: async () => task("CANCELED"),
  };
}

function inputRequiredEvent(
  phase: InterruptBinding["internalPhase"],
  inputRequestId?: string,
) {
  const factory = new InteractionEventFactory({
    runId: "run-1",
    threadId: "thread-1",
    now: () => new Date("2026-08-11T00:00:00.000Z"),
  });
  return required(
    factory.create(
      "input.required",
      {
        internalPhase: phase,
        ...(inputRequestId === undefined ? {} : { inputRequestId }),
      },
      { task: { taskId: "task-1", contextId: "context-1" } },
    ),
  );
}

async function* events<T>(...values: T[]): AsyncGenerator<T> {
  yield* values;
}

function task(state: NormalizedTask["state"]): NormalizedTask {
  return {
    taskId: "task-1",
    contextId: "context-1",
    state,
    artifacts: [],
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected value");
  return value;
}
