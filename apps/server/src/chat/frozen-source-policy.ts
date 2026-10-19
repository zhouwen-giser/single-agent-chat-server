import type { WorldGroundingMutationTurn } from "../../../../packages/world-grounding-runtime/src/index.js";

const ordinal = "第(?:[一二三四五六七八九十]|[1-9][0-9]?)个";
const selectionCommand = new RegExp(
  "^(?:" +
    ordinal +
    "|(?:采用|选择|选|确认)" +
    ordinal +
    "(?:候选)?|(?:将|把|让(?:无人车|车辆|车|机器人)(?:返回|前往))?" +
    ordinal +
    "作为历史(?:返回)?目标)$",
  "u",
);

/** Only narrow, source-bound commands bypass normal turn classification. */
export function isFrozenSourceContinuation(text: string): boolean {
  const command = text.trim().replace(/[。.!！]$/u, "");
  return (
    /^(?:展开卡片|聚焦地图|排除暂停(?:重新查询|后重查)?)$/u.test(command) ||
    selectionCommand.test(command)
  );
}

function referencesWorldTarget(text: string): boolean {
  return new RegExp(
    ordinal +
      "|(?:这个|那个|该|此|刚才的?|之前的?|历史)(?:候选|位置|目标|地点)" +
      "|那里|该处|此处|刚才(?:的)?(?:位置|地点)" +
      "|\\b(?:there|here|that candidate|(?:previous|historical|earlier) (?:target|location|candidate))\\b",
    "iu",
  ).test(text);
}

/** Positive provenance is required while a read-only world Source is active. */
export function isIndependentSdarMutation(
  input: WorldGroundingMutationTurn,
): boolean {
  if (
    referencesWorldTarget(input.userText) ||
    (input.taskText !== undefined && referencesWorldTarget(input.taskText))
  )
    return false;
  if (input.explicitTaskReference) return true;
  const command = input.userText.trim();
  if (input.requestKind === "cancel")
    return /^(?:取消(?:当前|这个|该|此)?任务|cancel (?:the )?(?:current )?task)[。.!！]?$/iu.test(
      command,
    );
  if (input.requestKind === "follow_up")
    return /^(?:(?:确认|批准|拒绝|继续)(?:当前|这个|该|此)?(?:任务|计划|方案)|(?:approve|reject|resume) (?:the )?(?:current )?(?:task|plan))[。.!！]?$/iu.test(
      command,
    );
  const independent =
    /^(?:(?:创建|新建|启动|开始)(?:一个)?独立(?:SDAR)?任务|(?:create|start) (?:an? )?independent (?:SDAR )?task)\s*[：:]\s*(.+)$/iu.exec(
      command,
    );
  if (!independent) return false;
  // Model-authored rewrites cannot smuggle a historical target into an independent request.
  return (
    input.taskText === undefined ||
    input.taskText.trim() === command ||
    input.taskText.trim() === independent[1]?.trim()
  );
}

export const HISTORICAL_SOURCE_MUTATION_CLARIFICATION =
  "当前世界分析和历史候选不能提供执行授权。这里只能继续只读分析；实际执行需当前验证、路线规划和执行确认。如要处理独立任务，请明确任务编号，或使用“创建独立任务：…”说明与历史候选无关的新任务。";
