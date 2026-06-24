import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCalibrationProfile,
  computeCalibration,
  normalizeConfidence,
  probabilitySafe,
  rankFor,
} from "../src/scoring";
import type { DecisionRecord } from "../src/types";

function rec(p: Partial<DecisionRecord>): DecisionRecord {
  return {
    scenarioId: "s", stepId: 1, kind: "trust",
    chosenOptionId: "a", chosenOutcome: "good", correct: true, ...p,
  };
}

test("normalizeConfidence clamps to [0.5, 1] and defaults to 0.75", () => {
  assert.equal(normalizeConfidence(undefined), 0.75);
  assert.equal(normalizeConfidence(0.1), 0.5);
  assert.equal(normalizeConfidence(2), 1);
  assert.equal(normalizeConfidence(0.8), 0.8);
});

test("probabilitySafe inverts confidence when prediction is 'unsafe'", () => {
  assert.equal(probabilitySafe(rec({ predictedSafe: true, confidence: 0.9 })), 0.9);
  assert.ok(Math.abs((probabilitySafe(rec({ predictedSafe: false, confidence: 0.8 })) ?? -1) - 0.2) < 1e-9);
  assert.equal(probabilitySafe(rec({ predictedSafe: undefined })), null);
});

test("computeCalibration: accuracy, Brier, over-trust, over-caution", () => {
  const records: DecisionRecord[] = [
    rec({ correct: true, predictedSafe: true, actualSafe: true, confidence: 0.8 }),
    rec({ correct: false, predictedSafe: true, actualSafe: false, confidence: 1 }),
    rec({ correct: false, predictedSafe: false, actualSafe: true, confidence: 0.6 }),
    rec({ kind: "gate", correct: true, predictedSafe: undefined, actualSafe: undefined }),
  ];
  const c = computeCalibration(records);
  assert.equal(c.decisions, 4);
  assert.equal(c.correct, 2);
  assert.equal(c.accuracy, 0.5);
  assert.equal(c.overTrust, 1);
  assert.equal(c.overCaution, 1);
  assert.ok(c.brier !== null && Math.abs(c.brier - 1.4 / 3) < 1e-9);
});

test("rankFor escalates with evidence and accuracy (non-SSM ranks)", () => {
  assert.equal(rankFor(12, 0.85), "Eagle-eye");
  assert.equal(rankFor(8, 0.7), "Inspector");
  assert.equal(rankFor(4, 0.5), "Watcher");
  assert.equal(rankFor(3, 0.99), "Rookie");
  assert.equal(rankFor(20, 0.4), "Rookie");
});

test("buildCalibrationProfile dedupes completed ids and rolls up totals (no SSM areas)", () => {
  const p = buildCalibrationProfile(
    [rec({ correct: true, predictedSafe: true, actualSafe: false }), rec({ correct: false })],
    ["a", "a", "b"],
  );
  assert.deepEqual(p.completed, ["a", "b"]);
  assert.equal(p.totalDecisions, 2);
  assert.equal(p.accuracy, 0.5);
  assert.equal(p.overTrust, 1);
  assert.equal(p.rank, "Rookie");
  assert.equal("areas" in p, false);
});
