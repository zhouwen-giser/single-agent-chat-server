import {
  timelineProjectionSchema,
  type TimelineProjection,
} from "../../analysis-contract/src/index.js";

export interface LocalPlaybackState {
  readonly cursor?: string;
  readonly rate: number;
  readonly playing: boolean;
}

export function projectSharedTimeline(
  input: TimelineProjection,
): TimelineProjection {
  const parsed = timelineProjectionSchema.parse(input);
  if (parsed.analysisTimeWindow === undefined) return parsed;
  if (
    Date.parse(parsed.analysisTimeWindow.start) >
    Date.parse(parsed.analysisTimeWindow.end)
  ) {
    throw new Error("ANALYSIS_TIME_WINDOW_INVALID");
  }
  return {
    ...parsed,
    sources: Object.fromEntries(
      Object.entries(parsed.sources).map(([sourceId, source]) => [
        sourceId,
        source.sourceKind === "GDPS"
          ? { ...source, displayRole: "CURRENT_BACKGROUND" as const }
          : source,
      ]),
    ),
  };
}

export function updateLocalPlayback(
  current: LocalPlaybackState,
  patch: Partial<LocalPlaybackState>,
): LocalPlaybackState {
  const rate = patch.rate ?? current.rate;
  if (!Number.isFinite(rate) || rate <= 0 || rate > 64) {
    throw new Error("PLAYBACK_RATE_INVALID");
  }
  return { ...current, ...patch, rate };
}

export function requiresAnalysisRevisionForTimeWindowChange(
  previous: TimelineProjection["analysisTimeWindow"],
  next: TimelineProjection["analysisTimeWindow"],
): boolean {
  return JSON.stringify(previous) !== JSON.stringify(next);
}
