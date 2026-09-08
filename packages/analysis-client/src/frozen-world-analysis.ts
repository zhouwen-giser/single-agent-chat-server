import type {
  AnalysisInterventionResolutionCommand,
  GroundingSourceProposalCommand,
} from "../../analysis-control-runtime/src/index.js";
import type { WorldAnalysisViewModel } from "../../world-explanation-runtime/src/analysis-view.js";
import type { FrozenChoiceView } from "../../world-explanation-runtime/src/frozen-analysis-view.js";

export interface FrozenAnalysisInteractionContext {
  readonly view: WorldAnalysisViewModel;
  readonly activeRevisionId: string;
  readonly activeRevisionNumber: number;
  /** Only the persisted pending intervention can open a selection control. */
  readonly interventionId?: string;
  readonly now?: () => number;
}

export type FrozenChoiceDisabledReason =
  "SELECTION_EXPIRED" | "ANALYSIS_REVISION_CONFLICT" | "SELECTION_UNAVAILABLE";

export interface FrozenChoicePresentation {
  readonly choice: FrozenChoiceView;
  readonly enabled: boolean;
  readonly disabledReason?: FrozenChoiceDisabledReason;
  readonly message: string;
  readonly refreshAction: "SUBMIT_NEW_QUERY";
}

export type FrozenSourceQueryCommand = GroundingSourceProposalCommand;

/**
 * UI advice only, never source authorization. In particular, a clipped Finding
 * list does not invalidate a retained selector. The control service re-reads the
 * complete authorized source and verifies all relationships before a new POST.
 */
export function presentFrozenChoice(
  context: FrozenAnalysisInteractionContext,
  choice: FrozenChoiceView,
): FrozenChoicePresentation {
  const reason = disabledReason(context, choice);
  return {
    choice: structuredClone(choice),
    enabled: reason === undefined,
    ...(reason === undefined ? {} : { disabledReason: reason }),
    message:
      reason === "SELECTION_EXPIRED"
        ? "此候选已过期，历史结果仍可阅读。请重新查询。"
        : reason === "ANALYSIS_REVISION_CONFLICT"
          ? "分析条件已变化，此历史候选不再属于当前 Revision。"
          : reason === "SELECTION_UNAVAILABLE"
            ? "选择来源或待处理选择不可用，请重新查询。"
            : "按已保存来源的候选身份选择；服务端将再次检查有效期与归属。",
    refreshAction: "SUBMIT_NEW_QUERY",
  };
}

export function presentFrozenAnalysis(
  context: FrozenAnalysisInteractionContext,
) {
  assertFrozenView(context.view);
  return {
    title: context.view.summary.title,
    text: context.view.summary.primaryText,
    qualifiers: [...context.view.summary.qualifiers],
    source: structuredClone(context.view.source),
    displayLimited: context.view.typedGaps.some((gap) =>
      [
        "CHOICE_LIMIT",
        "VIEW_BYTE_LIMIT",
        "MAP_LAYER_LIMIT",
        "TIMELINE_ITEM_LIMIT",
      ].includes(String(gap["messageCode"])),
    ),
    choices: context.view.choices.flatMap((choice) =>
      "selector" in choice ? [presentFrozenChoice(context, choice)] : [],
    ),
    actions: context.view.actionTargets.flatMap((action) => {
      if (action.findingKind !== "ACTION_TARGET_CANDIDATE") return [];
      // Do not turn a display model into a route-planning or execution command.
      if (
        action.executionAuthorized !== false ||
        action.requirements.currentValidationRequired !== true ||
        action.requirements.routePlanningRequired !== true ||
        action.requirements.executionConfirmationRequired !== true
      )
        throw new Error("HISTORICAL_ACTION_REQUIREMENTS_INVALID");
      return [
        {
          findingId: action.findingId,
          sourceFindingId: action.sourceFindingId,
          sourceCandidateId: action.sourceCandidateId,
          sourceRank: action.sourceRank,
          target: structuredClone(action.target),
          current: context.activeRevisionId === context.view.revisionId,
          title: "历史行动候选（未授权执行）",
          requirementLabels: ["当前环境验证", "路线规划", "执行确认"] as const,
          requirements: structuredClone(action.requirements),
          executionAuthorized: false as const,
        },
      ];
    }),
    refreshAction: "SUBMIT_NEW_QUERY" as const,
  };
}

/** Carries identities, never coordinates, rank, provider objects or a clipped list index. */
export function createFrozenChoiceResolution(input: {
  readonly context: FrozenAnalysisInteractionContext;
  readonly choices: readonly FrozenChoiceView[];
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly originalText: string;
}): AnalysisInterventionResolutionCommand {
  assertRevisionNumber(input.context.activeRevisionNumber);
  if (input.choices.length < 1 || input.choices.length > 8)
    throw new Error("SELECTION_INVALID");
  if (
    new Set(input.choices.map((choice) => choice.choiceId)).size !==
    input.choices.length
  )
    throw new Error("SELECTION_CONFLICT");
  for (const choice of input.choices) {
    const reason = disabledReason(input.context, choice);
    if (reason) throw new Error(reason);
  }
  return {
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    response: {
      expectedRevisionId: input.context.activeRevisionId,
      expectedRevisionNumber: input.context.activeRevisionNumber,
      originalText: input.originalText,
      analysisSelections: input.choices.map(({ selector }) => ({
        priorGroundingId: selector.priorGroundingId,
        priorResultHash: selector.priorResultHash,
        findingSetHash: selector.findingSetHash,
        choiceId: selector.choiceId,
        candidateId: selector.candidateId,
      })),
    },
  };
}

/** Requery never copies expired selectors or silently relabels historical targets. */
export function createFrozenSourceQuery(input: {
  readonly context: FrozenAnalysisInteractionContext;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly originalText: string;
  readonly contextMode: "CONTINUE" | "REPLACE";
}): FrozenSourceQueryCommand {
  assertFrozenView(input.context.view);
  assertRevisionNumber(input.context.activeRevisionNumber);
  if (input.context.view.revisionId !== input.context.activeRevisionId)
    throw new Error("ANALYSIS_REVISION_CONFLICT");
  return {
    kind: "GROUNDING_SOURCE_QUERY",
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    expectedRevisionId: input.context.activeRevisionId,
    expectedRevisionNumber: input.context.activeRevisionNumber,
    originalText: input.originalText,
    contextMode: input.contextMode,
  };
}

function disabledReason(
  context: FrozenAnalysisInteractionContext,
  choice: FrozenChoiceView,
): FrozenChoiceDisabledReason | undefined {
  assertFrozenView(context.view);
  if (context.activeRevisionId !== context.view.revisionId)
    return "ANALYSIS_REVISION_CONFLICT";
  if (
    !context.interventionId ||
    choice.selector.priorGroundingId !== context.view.groundingId ||
    choice.selector.priorResultHash !== context.view.source.resultHash ||
    choice.selector.findingSetHash !== context.view.source.findingSetHash ||
    choice.selector.choiceId !== choice.choiceId ||
    choice.selector.candidateId !== choice.candidateId
  )
    return "SELECTION_UNAVAILABLE";
  const deadline = Date.parse(choice.validUntil);
  const now = context.now?.() ?? Date.now();
  if (!Number.isFinite(deadline) || !Number.isFinite(now) || now >= deadline)
    return "SELECTION_EXPIRED";
  return undefined;
}

function assertFrozenView(view: WorldAnalysisViewModel): void {
  if (
    view.source.contractVersion !== "sacs-wsgs-grounding/1.2" ||
    view.source.resultProfile !== "wsgs-world-analysis-findings/1.0"
  )
    throw new Error("ANALYSIS_SOURCE_CONTRACT_IDENTITY_INVALID");
}

function assertRevisionNumber(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("ANALYSIS_REVISION_CONFLICT");
}
