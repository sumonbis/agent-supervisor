import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScenario, validateScenario } from "../src/scenario";

function valid(): unknown {
  return {
    id: "demo", title: "Demo", tagline: "tiny", task: "do a thing", agent: "Agent",
    domain: "Web app", difficulty: "intro", estMinutes: 3, focus: ["S3", "S4"],
    steps: [
      {
        id: 1, title: "Agent acts", agentSays: "All done!",
        whatHappened: "It changed a protected file.", risk: "danger", ssm: ["S4"],
        explain: "Claim did not match reality.",
        decision: {
          prompt: "Trust it?", kind: "trust", ssm: "S4", actualSafe: false,
          options: [
            { id: "trust", label: "Trust", feedback: "Too quick.", outcome: "bad", predictsSafe: true },
            { id: "verify", label: "Verify", feedback: "Good.", outcome: "good", predictsSafe: false },
          ],
          correct: "verify",
        },
      },
    ],
    debrief: { summary: "Done.", lessons: ["Verify claims."] },
  };
}

test("a well-formed scenario validates with no problems", () => {
  assert.deepEqual(validateScenario(valid()), []);
  assert.doesNotThrow(() => parseScenario(valid()));
});

test("missing required fields are reported", () => {
  const s = valid() as Record<string, unknown>;
  delete s.title;
  assert.ok(validateScenario(s).some((p) => p.includes("title")));
});

test("a trust decision without actualSafe is rejected", () => {
  const s = valid() as any;
  delete s.steps[0].decision.actualSafe;
  assert.ok(validateScenario(s).some((p) => p.includes("actualSafe")));
});

test("decision.correct must reference a real option id", () => {
  const s = valid() as any;
  s.steps[0].decision.correct = "nope";
  assert.ok(validateScenario(s).some((p) => p.includes("not an option id")));
});

test("invalid risk level is caught", () => {
  const s = valid() as any;
  s.steps[0].risk = "explosive";
  assert.ok(validateScenario(s).some((p) => p.includes("risk must be one of")));
});

test("parseScenario throws on invalid input", () => {
  assert.throws(() => parseScenario({ id: "x" }), /Invalid scenario/);
});
