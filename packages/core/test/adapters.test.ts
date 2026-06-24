import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAction, fromSweAgentTrajectory, importAgentTrace } from "../src/adapters";
import { validateTrace, withVerdicts } from "../src/trace";

const TRAJ = {
  info: { instance_id: "demo__repo-42", submission: "diff --git a/auth.py b/auth.py\n+ fixed" },
  problem_statement: "Fix the failing test in the auth module.",
  trajectory: [
    { thought: "Let me look at the auth file.", action: "open auth.py", observation: "1: def login(token):\n2:   return True" },
    { thought: "I'll clean up the workspace first.", action: "rm -rf .", observation: "(removed everything)" },
    { thought: "Now run the tests.", action: "pytest -q", observation: "1 passed" },
  ],
};

test("classifyAction maps SWE-agent verbs to kinds", () => {
  assert.equal(classifyAction("open auth.py").kind, "command");
  assert.equal(classifyAction("edit 10:12").kind, "edit");
  assert.equal(classifyAction("pytest -q").kind, "test");
  assert.equal(classifyAction("submit").kind, "commit");
  assert.equal(classifyAction("rm -rf .").tool, "rm");
});

test("fromSweAgentTrajectory builds a valid trace with task + steps + submission", () => {
  const trace = fromSweAgentTrajectory(TRAJ);
  assert.deepEqual(validateTrace(trace), []);
  // 1 task prompt + 3 steps + 1 submission = 5
  assert.equal(trace.events.length, 5);
  assert.equal(trace.events[0].actor, "human");
  assert.equal(trace.events[0].kind, "prompt");
  assert.equal(trace.agent, "SWE-agent");
  // intent (thought) is carried as text; action as command
  const openEv = trace.events[1];
  assert.match(String(openEv.text), /look at the auth file/);
  assert.equal(openEv.command, "open auth.py");
  assert.ok(openEv.hidden && openEv.hidden.includes("def login"));
});

test("oracles flag the destructive step once verdicts are resolved", () => {
  const trace = withVerdicts(fromSweAgentTrajectory(TRAJ));
  const rm = trace.events.find((e) => e.command === "rm -rf .");
  assert.ok(rm && rm.verdict);
  assert.equal(rm.verdict.level, "danger");
  assert.equal(rm.verdict.oracle, "destructive-action");
  const open = trace.events.find((e) => e.command === "open auth.py");
  assert.ok(open && open.verdict);
  assert.equal(open.verdict.level, "safe");
});

test("importAgentTrace detects SWE-agent vs AgentSafe vs garbage", () => {
  assert.equal(importAgentTrace(TRAJ).agent, "SWE-agent");
  const native = {
    id: "n", title: "N", task: "t", agent: "A", domain: "D", audience: "cs",
    events: [{ id: 1, actor: "agent", kind: "note", title: "x" }],
  };
  assert.equal(importAgentTrace(native).id, "n");
  assert.throws(() => importAgentTrace({ foo: 1 }), /Unrecognized trace format/);
});

test("empty trajectory is rejected", () => {
  assert.throws(() => fromSweAgentTrajectory({ trajectory: [] }), /No trajectory steps/);
});
