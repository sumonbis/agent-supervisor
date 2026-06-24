// SupervisionReport helpers — the JSON contract shared with the SIGCSE Python tool.

import type { AreaResult, SSMArea, SSMScore, SupervisionReport, AiUsageResult } from "./types";
import { RUBRIC_LABELS, SSM_ORDER } from "./ssm";

export function emptyAreas(): Record<SSMArea, AreaResult> {
  const areas = {} as Record<SSMArea, AreaResult>;
  for (const a of SSM_ORDER) {
    areas[a] = { area: a, score: -1, reasoning: "Not assessed." };
  }
  return areas;
}

/** Overall = mean of assessed (>= 0) area scores; label from the rounded mean. */
export function overallFromAreas(areas: Record<SSMArea, AreaResult>): {
  overall: number;
  label: string;
} {
  const valid = SSM_ORDER.map((a) => areas[a].score).filter((s) => s >= 0) as number[];
  const overall = valid.length ? valid.reduce((x, y) => x + y, 0) / valid.length : 0;
  return {
    overall: Math.round(overall * 100) / 100,
    label: RUBRIC_LABELS[Math.round(overall)] ?? "?",
  };
}

export interface ReportMeta {
  repoId: string;
  remoteUrl?: string;
  totalCommits: number;
  implFileCount: number;
  testFileCount: number;
  hasCi: boolean;
}

export function buildReport(
  meta: ReportMeta,
  areas: Record<SSMArea, AreaResult>,
  aiUsage?: AiUsageResult,
): SupervisionReport {
  const scores = {} as Record<SSMArea, SSMScore>;
  for (const a of SSM_ORDER) {
    scores[a] = areas[a].score;
  }
  const { overall, label } = overallFromAreas(areas);
  return {
    ...meta,
    scores,
    overall,
    overallLabel: label,
    areas,
    aiUsage,
  };
}
