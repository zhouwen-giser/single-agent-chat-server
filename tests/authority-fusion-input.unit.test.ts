import { describe, expect, it } from "@jest/globals";

import {
  PlanRealityRequirementCompiler,
  SdarTaskObservationAssembler,
} from "../packages/authority-fusion/src/index.js";
import type { ConversationWorldFocus } from "../packages/conversation-world-focus/src/index.js";
import type {
  JsonValue,
  NormalizedTask,
  NormalizedTaskState,
} from "../packages/sdar-a2a-adapter/src/index.js";

const observedAt = "2026-08-29T08:00:00.000Z";
const schemaHash = "sha256:" + "a".repeat(64);

describe("SACS v0.4 S09 Task observation and requirement compiler", () => {
  it.each([
    "INPUT_REQUIRED",
    "WORKING",
    "COMPLETED",
    "FAILED",
    "CANCELED",
  ] satisfies readonly NormalizedTaskState[])(
    "preserves official NormalizedTask state %s",
    (state) => {
      const observation = assembler().assemble(task(state));
      expect(observation).toMatchObject({
        schemaVersion: "2.0",
        taskId: "task-1",
        taskState: state,
        internalPhase: "phase-1",
        phaseMessage: "Published phase message",
        observedAt,
        correlation: {
          system: "SDAR",
          externalTaskId: "task-1",
          contextId: "context-1",
        },
      });
    },
  );

  it("compiles deterministic task/context hints and only published structured predicates", () => {
    const observation = assembler().assemble(
      task("COMPLETED", {
        predicates: [
          {
            schemaUri: "urn:gowm:v0.4:external-predicate",
            schemaHash,
            value: {
              subject: "vehicle-2",
              relation: "within",
              object: "zone-a",
            },
          },
        ],
      }),
    );
    const requirements = new PlanRealityRequirementCompiler().compile(
      observation,
      focus(),
    );

    expect(requirements.comparability).toBe("COMPARABLE");
    expect(requirements.correlationHints).toEqual([
      expect.objectContaining({
        externalAuthority: "SDAR",
        kind: "EXTERNAL_TASK",
        value: "task-1",
      }),
      expect.objectContaining({
        externalAuthority: "SDAR",
        kind: "OPERATION_CORRELATION",
        value: "context-1",
      }),
    ]);
    expect(requirements.predicates).toEqual([
      expect.objectContaining({
        schemaUri: "urn:gowm:v0.4:external-predicate",
        schemaHash,
      }),
    ]);
  });

  it("keeps free-text plans NOT_COMPARABLE and never invents a hard predicate", () => {
    const observation = assembler().assemble({
      ...task("INPUT_REQUIRED"),
      phaseMessage: "让2号车去A区巡逻",
    });
    const requirements = new PlanRealityRequirementCompiler().compile(
      observation,
      focus(),
    );

    expect(requirements).toMatchObject({
      comparability: "NOT_COMPARABLE",
      predicates: [],
      reasonCodes: ["PUBLISHED_STRUCTURED_PLAN_ABSENT"],
    });
    expect(requirements.correlationHints).toHaveLength(2);
  });

  it("fails closed on malformed structured predicate input", () => {
    const observation = assembler().assemble(
      task("COMPLETED", {
        predicates: [{ schemaUri: "untrusted", value: { inferred: true } }],
      }),
    );
    const requirements = new PlanRealityRequirementCompiler().compile(
      observation,
      focus(),
    );
    expect(requirements).toMatchObject({
      comparability: "NOT_COMPARABLE",
      predicates: [],
      reasonCodes: ["PUBLISHED_STRUCTURED_PLAN_INVALID"],
    });
  });

  it("does not include the local observation clock in taskSnapshotHash", () => {
    const first = new SdarTaskObservationAssembler({
      now: () => new Date("2026-08-29T08:00:00.000Z"),
    }).assemble(task("WORKING", undefined, false));
    const second = new SdarTaskObservationAssembler({
      now: () => new Date("2026-08-29T09:00:00.000Z"),
    }).assemble(task("WORKING", undefined, false));
    const compiler = new PlanRealityRequirementCompiler();
    expect(first.observedAt).not.toBe(second.observedAt);
    expect(compiler.compile(first, focus()).taskSnapshotHash).toBe(
      compiler.compile(second, focus()).taskSnapshotHash,
    );
  });
});

function assembler(): SdarTaskObservationAssembler {
  return new SdarTaskObservationAssembler({
    now: () => new Date(observedAt),
  });
}

function task(
  state: NormalizedTaskState,
  publishedStructuredPlan?: JsonValue,
  withTimestamp = true,
): NormalizedTask {
  return {
    taskId: "task-1",
    contextId: "context-1",
    state,
    internalPhase: "phase-1",
    phaseMessage: "Published phase message",
    ...(withTimestamp ? { statusTimestamp: observedAt } : {}),
    ...(publishedStructuredPlan === undefined
      ? {}
      : { publishedStructuredPlan }),
    artifacts: [],
  };
}

function focus(): ConversationWorldFocus {
  return {
    schemaVersion: "1.0",
    principalId: "principal-1",
    threadId: "thread-1",
    revision: 0,
    references: [],
    updatedAt: observedAt,
  };
}
