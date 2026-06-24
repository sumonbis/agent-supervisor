// Trust-calibration scoring for AgentLens decisions: a Brier score plus
// over-trust vs over-caution counts and a calibration rank. Pure functions.
// No SSM here — the Supervision Skill Model lives in the report/analyzers (Coach).

import type {
  CalibrationProfile,
  CalibrationRank,
  CalibrationResult,
  DecisionRecord,
} from "./types";

export function normalizeConfidence(confidence: number | undefined): number {
  if (confidence === undefined || Number.isNaN(confidence)) {
    return 0.75;
  }
  return Math.min(1, Math.max(0.5, confidence));
}

export function probabilitySafe(record: DecisionRecord): number | null {
  if (record.predictedSafe === undefined) {
    return null;
  }
  const c = normalizeConfidence(record.confidence);
  return record.predictedSafe ? c : 1 - c;
}

export function computeCalibration(records: DecisionRecord[]): CalibrationResult {
  const decisions = records.length;
  const correct = records.filter((r) => r.correct).length;

  let brierSum = 0;
  let brierN = 0;
  let overTrust = 0;
  let overCaution = 0;

  for (const r of records) {
    if (r.predictedSafe !== undefined && r.actualSafe !== undefined) {
      const p = probabilitySafe(r);
      if (p !== null) {
        const actual = r.actualSafe ? 1 : 0;
        brierSum += (p - actual) ** 2;
        brierN += 1;
      }
      if (r.predictedSafe && !r.actualSafe) {
        overTrust += 1;
      } else if (!r.predictedSafe && r.actualSafe) {
        overCaution += 1;
      }
    }
  }

  return {
    decisions,
    correct,
    accuracy: decisions === 0 ? 0 : correct / decisions,
    brier: brierN === 0 ? null : brierSum / brierN,
    overTrust,
    overCaution,
  };
}

/** Calibration rank — themed to "seeing what agents really do", not SSM. */
export function rankFor(totalDecisions: number, accuracy: number): CalibrationRank {
  if (totalDecisions >= 12 && accuracy >= 0.85) {
    return "Eagle-eye";
  }
  if (totalDecisions >= 8 && accuracy >= 0.7) {
    return "Inspector";
  }
  if (totalDecisions >= 4 && accuracy >= 0.5) {
    return "Watcher";
  }
  return "Rookie";
}

export function buildCalibrationProfile(
  records: DecisionRecord[],
  completed: string[],
): CalibrationProfile {
  const cal = computeCalibration(records);
  return {
    totalDecisions: cal.decisions,
    totalCorrect: cal.correct,
    accuracy: cal.accuracy,
    brier: cal.brier,
    overTrust: cal.overTrust,
    overCaution: cal.overCaution,
    completed: [...new Set(completed)].sort(),
    rank: rankFor(cal.decisions, cal.accuracy),
  };
}
