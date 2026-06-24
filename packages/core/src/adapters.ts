// Adapters that turn a real agent run into the AgentSafe Trace schema, so the
// Trace Explorer can visualize and supervise it. First target: SWE-agent
// trajectories (.traj / .json). The agent's `thought` is its observable intent;
// the `action` is the command; the `observation` is the under-the-hood detail.

import type { EventKind, Trace, TraceEvent } from "./types";
import { parseTrace } from "./trace";

export interface ImportOptions {
  id?: string;
  task?: string;
  agent?: string;
  /** Truncate long observations to keep the view readable. */
  maxObservationChars?: number;
}

function firstLine(s: string, max = 100): string {
  const line = (s || "").split("\n").find((l) => l.trim()) ?? (s || "");
  const t = line.trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function clamp(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + `\n… (${s.length - max} more characters)` : s;
}

/** Map a SWE-agent action string to an event kind + a short tool label. */
export function classifyAction(action: string): { kind: EventKind; tool: string } {
  const a = action.trim();
  const first = (a.split(/\s+/)[0] || "").toLowerCase();
  if (/^(edit|insert|append|create|str_replace|replace|delete_lines?)/.test(first)) {
    return { kind: "edit", tool: first };
  }
  if (first === "submit") {
    return { kind: "commit", tool: "submit" };
  }
  if (/(pytest|tox|unittest|jest|go\s+test|npm\s+test|\btest\b)/i.test(a)) {
    return { kind: "test", tool: "test" };
  }
  if (/^(open|goto|scroll_up|scroll_down|search_dir|search_file|find_file|ls|cat|tree|grep)/.test(first)) {
    return { kind: "command", tool: first };
  }
  if (/^(python3?|node|bash|sh|sudo|pip3?|npm|yarn|cargo|make|git|mv|cp|rm|mkdir|touch|curl|wget)\b/.test(first)) {
    return { kind: "command", tool: first };
  }
  return { kind: "command", tool: first || "action" };
}

interface SweStep {
  action?: string;
  Action?: string;
  thought?: string;
  Thought?: string;
  response?: string;
  observation?: string;
  Observation?: string;
}

/** Convert a parsed SWE-agent trajectory object into a Trace. */
export function fromSweAgentTrajectory(raw: any, opts: ImportOptions = {}): Trace {
  const maxObs = opts.maxObservationChars ?? 1400;
  const steps: SweStep[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.trajectory)
      ? raw.trajectory
      : Array.isArray(raw?.Trajectory)
        ? raw.Trajectory
        : [];
  if (steps.length === 0) {
    throw new Error("No trajectory steps found (expected a `trajectory` array).");
  }

  const events: TraceEvent[] = [];
  let nextId = 1;

  const task =
    opts.task ||
    raw?.problem_statement ||
    raw?.info?.problem_statement ||
    raw?.environment?.problem_statement ||
    "";
  if (task) {
    events.push({
      id: nextId++,
      actor: "human",
      kind: "prompt",
      title: "The task",
      text: clamp(String(task), 600),
    });
  }

  for (const step of steps) {
    const action = String(step.action ?? step.Action ?? "").trim();
    const thought = String(step.thought ?? step.Thought ?? step.response ?? "").trim();
    const observation = String(step.observation ?? step.Observation ?? "").trim();
    if (!action && !thought) {
      continue;
    }
    const { kind, tool } = action ? classifyAction(action) : { kind: "claim" as EventKind, tool: "" };
    events.push({
      id: nextId++,
      actor: "agent",
      kind,
      title: (action ? firstLine(action) : firstLine(thought)) || `Step ${nextId - 1}`,
      text: thought || undefined,
      tool: tool || undefined,
      command: action || undefined,
      stateChange: observation ? firstLine(observation, 160) : undefined,
      hidden: observation ? clamp(observation, maxObs) : undefined,
    });
  }

  const submission = raw?.info?.submission ?? raw?.submission;
  if (submission) {
    events.push({
      id: nextId++,
      actor: "agent",
      kind: "commit",
      title: "Submitted a patch",
      text: "The agent finished and submitted its patch.",
      code: { filename: "submission.patch", language: "diff", text: clamp(String(submission), maxObs) },
      stateChange: "A final patch was produced and submitted.",
    });
  }

  const instanceId = raw?.info?.instance_id || raw?.instance_id;
  return {
    id: opts.id || String(instanceId || "imported-run"),
    title: String(instanceId || "Imported SWE-agent run"),
    tagline: "A real agent run, imported into the explorer.",
    task: task ? clamp(String(task), 220) : "Imported agent run",
    agent: opts.agent || "SWE-agent",
    domain: "Your repository",
    audience: "cs",
    events,
    summary:
      `Imported from a SWE-agent trajectory (${events.length} steps). Safety flags are computed by the reference oracles — treat them as a heuristic first pass to investigate, not a guarantee.`,
  };
}

/** Detect the format and import. Accepts SWE-agent trajectories or AgentSafe traces. */
export function importAgentTrace(raw: any, opts: ImportOptions = {}): Trace {
  if (raw && (Array.isArray(raw) || Array.isArray(raw.trajectory) || Array.isArray(raw.Trajectory))) {
    return fromSweAgentTrajectory(raw, opts);
  }
  if (raw && Array.isArray(raw.events)) {
    return parseTrace(raw); // already an AgentSafe trace
  }
  throw new Error(
    "Unrecognized trace format. Expected a SWE-agent trajectory (a `trajectory` array) or an AgentSafe trace (an `events` array).",
  );
}
