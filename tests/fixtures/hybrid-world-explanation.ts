import {
  parseAuthorityFusionResultV2,
  parseSdarTaskObservationV2,
} from "../../packages/authority-fusion/src/index.js";
import type { WorldExplanationChatResult } from "../../packages/interaction-runtime/src/index.js";
import type { WorldExplanationV1 } from "../../packages/world-explanation-contract/src/index.js";
import { buildHybridAuthoritySeparatedResult } from "../../packages/world-grounding-runtime/src/index.js";

export function hybridWorldExplanationFixture(
  explanation: WorldExplanationV1,
  options: {
    readonly internalPhase?: string;
    readonly phaseMessage?: string;
  } = {},
): WorldExplanationChatResult {
  const task = parseSdarTaskObservationV2({
    schemaVersion: "2.0",
    taskId: "task-hybrid-projection-1",
    taskState: "COMPLETED",
    internalPhase: options.internalPhase ?? "completed",
    phaseMessage:
      options.phaseMessage ??
      "Published plan snapshot for protocol projection.",
    observedAt: explanation.createdAt,
    correlation: {
      system: "SDAR",
      externalTaskId: "task-hybrid-projection-1",
      contextId: "context-hybrid-projection-1",
    },
  });
  const fusion = parseAuthorityFusionResultV2({
    schemaVersion: "2.0",
    task: {
      authority: "SDAR",
      taskId: task.taskId,
      state: task.taskState,
      internalPhase: task.internalPhase,
      observedAt: task.observedAt,
    },
    reality: {
      authority: "GOWM",
      groundingId: explanation.grounding.groundingId,
      resultHash: explanation.grounding.resultHash,
      observedAt: explanation.createdAt,
    },
    checks: [
      {
        checkId: "check-hybrid-projection-1",
        type: "PLAN_PREDICATE",
        required: true,
        expected: "published predicate",
        observed: "supported",
        evaluation: "SATISFIED",
        evidenceItemIds: ["evidence-typed-predicate-1"],
      },
    ],
    overall: "CONSISTENT",
    unknowns: [],
  });
  const structured = buildHybridAuthoritySeparatedResult({
    task,
    explanation,
    fusion,
  });
  return { kind: "world_explanation", ...structured };
}
