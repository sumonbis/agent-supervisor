// Integration test for the webview frontend (media/cockpit.js) using jsdom.
// Drives the real render/interaction code in a real DOM to catch runtime errors
// that the bundler and type-checker cannot see.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CODE = fs.readFileSync(path.join(ROOT, "media", "cockpit.js"), "utf8");
const SCENARIO_DIR = path.join(ROOT, "scenarios");

const INDEX = JSON.parse(fs.readFileSync(path.join(SCENARIO_DIR, "index.json"), "utf8"));
const SCENARIOS = INDEX.map((e) =>
  JSON.parse(fs.readFileSync(path.join(SCENARIO_DIR, e.file), "utf8")),
);

const AREAS = ["S1", "S2", "S3", "S4", "S5", "S6"];
function zeroProfile(overrides = {}) {
  const areas = {};
  for (const a of AREAS) areas[a] = { area: a, attempts: 0, correct: 0, accuracy: 0, level: 0 };
  return {
    areas,
    totalDecisions: 0,
    totalCorrect: 0,
    accuracy: 0,
    brier: null,
    overTrust: 0,
    overCaution: 0,
    completed: [],
    rank: "Trainee",
    ...overrides,
  };
}

/** Boot a fresh webview with cockpit.js loaded; returns helpers. */
function boot() {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="app" class="app"></div></body>`, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.Element.prototype.scrollIntoView = () => {};
  const posted = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => posted.push(m),
    getState: () => undefined,
    setState: () => {},
  });
  window.eval(CODE);
  const app = window.document.getElementById("app");
  const send = (data) =>
    window.dispatchEvent(new window.MessageEvent("message", { data }));
  return { window, app, posted, send };
}

test("posts 'ready' as soon as the script loads", () => {
  const { posted } = boot();
  assert.ok(posted.some((m) => m.type === "ready"), "expected a ready message");
});

test("init renders the home with scenarios and the calibration panel (no SSM)", () => {
  const { app, send } = boot();
  send({ type: "init", scenarios: SCENARIOS, profile: zeroProfile(), openScenarioId: null });
  assert.ok(app.querySelector(".calib-summary"), "calibration panel should render");
  assert.equal(app.querySelectorAll(".ssm-card").length, 0, "AgentLens has no SSM cards");
  assert.equal(app.querySelectorAll(".scenario").length, SCENARIOS.length);
  assert.ok(/really do|lens|calibrat/i.test(app.textContent));
});

test("deep-link via openScenarioId jumps straight into the player", () => {
  const { app, send } = boot();
  send({ type: "init", scenarios: SCENARIOS, profile: zeroProfile(), openScenarioId: "phantom-revert" });
  assert.ok(app.querySelector("#feed"), "player feed should render");
  assert.ok(/Phantom Revert/.test(app.querySelector(".player-title").textContent));
});

/**
 * Click through a scenario: at each turn, answer an open decision (choosing a
 * confidence first if asked), otherwise press Continue, until the player posts
 * completeScenario.
 */
function playToEnd(app, posted) {
  for (let i = 0; i < 50; i++) {
    if (posted.some((m) => m.type === "completeScenario")) return true;
    const opt = app.querySelector("#feed [data-opt]:not([disabled])");
    if (opt) {
      const conf = app.querySelector("#feed .conf-btn");
      if (conf) conf.click();
      opt.click();
      continue;
    }
    const continues = [...app.querySelectorAll("#feed [data-continue]")].filter(
      (b) => !b.disabled,
    );
    if (continues.length) {
      continues[continues.length - 1].click();
      continue;
    }
    break;
  }
  return posted.some((m) => m.type === "completeScenario");
}

for (const scenario of SCENARIOS) {
  test(`scenario "${scenario.id}" plays to completion and shows a debrief`, () => {
    const { app, posted, send } = boot();
    send({ type: "init", scenarios: SCENARIOS, profile: zeroProfile(), openScenarioId: scenario.id });

    const finished = playToEnd(app, posted);
    assert.ok(finished, `"${scenario.id}" never reached completion`);

    const done = posted.find((m) => m.type === "completeScenario");
    assert.equal(done.scenarioId, scenario.id);
    const decisionCount = scenario.steps.filter((s) => s.decision).length;
    assert.equal(
      done.records.length,
      decisionCount,
      `expected ${decisionCount} recorded decisions`,
    );
    // Every record must carry the fields the extension's scorer needs.
    for (const r of done.records) {
      assert.equal(typeof r.correct, "boolean");
      if (r.kind === "trust") {
        assert.equal(typeof r.predictedSafe, "boolean");
        assert.equal(typeof r.actualSafe, "boolean");
        assert.ok(r.confidence >= 0.5 && r.confidence <= 1);
      }
    }

    // Now simulate the extension's reply and verify the debrief renders.
    send({
      type: "scenarioComplete",
      scenarioId: scenario.id,
      calibration: { decisions: decisionCount, correct: decisionCount, accuracy: 1, brier: 0.05, overTrust: 0, overCaution: 0 },
      profile: zeroProfile({ completed: [scenario.id], totalDecisions: decisionCount, totalCorrect: decisionCount, accuracy: 1 }),
    });
    assert.ok(app.querySelector(".debrief"), "debrief should render");
    assert.equal(
      app.querySelectorAll(".lessons li").length,
      scenario.debrief.lessons.length,
      "all debrief lessons should render",
    );
  });
}

test("an over-trust answer is recorded and surfaced as a warning in the debrief", () => {
  const { app, posted, send } = boot();
  send({ type: "init", scenarios: SCENARIOS, profile: zeroProfile(), openScenarioId: "phantom-revert" });

  // Phantom Revert: step 1 is narrative (Continue), step 2 is a trust decision.
  app.querySelector("#feed [data-continue]").click(); // advance past the plan step
  const trustOpt = app.querySelector('#feed [data-opt="trust"]'); // the over-trusting choice
  assert.ok(trustOpt, "expected the 'trust' option");
  trustOpt.click();

  assert.ok(playToEnd(app, posted));
  const done = posted.find((m) => m.type === "completeScenario");
  const rec = done.records.find((r) => r.kind === "trust");
  assert.equal(rec.predictedSafe, true);
  assert.equal(rec.actualSafe, false); // ground truth: it was NOT safe

  send({
    type: "scenarioComplete",
    scenarioId: "phantom-revert",
    calibration: { decisions: 1, correct: 0, accuracy: 0, brier: 1, overTrust: 1, overCaution: 0 },
    profile: zeroProfile({ completed: ["phantom-revert"], totalDecisions: 1, overTrust: 1 }),
  });
  assert.ok(/over-trust/i.test(app.querySelector(".callout").textContent));
});

test("Back returns to the scenario grid", () => {
  const { app, send } = boot();
  send({ type: "init", scenarios: SCENARIOS, profile: zeroProfile(), openScenarioId: "phantom-revert" });
  assert.ok(app.querySelector("#feed"));
  app.querySelector("#backBtn").click();
  assert.equal(app.querySelectorAll(".scenario").length, SCENARIOS.length);
});
