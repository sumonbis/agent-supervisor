// Validate trace JSON and provide helpers for the Trace Explorer / Coach replay.

import type { Actor, Audience, EventKind, RiskLevel, Trace, TraceEvent } from "./types";
import { verdictFor } from "./oracles";

const ACTORS: Actor[] = ["agent", "human", "system"];
const KINDS: EventKind[] = [
  "prompt", "plan", "approval", "edit", "command",
  "test", "claim", "commit", "deploy", "network", "note",
];
const AUDIENCES: Audience[] = ["cs", "general", "both"];
const RISKS: RiskLevel[] = ["safe", "caution", "danger"];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateTrace(raw: unknown): string[] {
  const problems: string[] = [];
  const id = isObject(raw) && isNonEmptyString(raw.id) ? (raw.id as string) : "<unknown>";
  const where = (m: string) => `[${id}] ${m}`;

  if (!isObject(raw)) {
    return ["Trace is not an object."];
  }
  for (const field of ["id", "title", "task", "agent", "domain"]) {
    if (!isNonEmptyString(raw[field])) {
      problems.push(where(`missing/empty string field "${field}"`));
    }
  }
  if (!AUDIENCES.includes(raw.audience as Audience)) {
    problems.push(where(`audience must be one of ${AUDIENCES.join(", ")}`));
  }
  const events = raw.events;
  if (!Array.isArray(events) || events.length === 0) {
    problems.push(where(`events must be a non-empty array`));
    return problems;
  }
  const seen = new Set<number>();
  events.forEach((e, i) => {
    const at = `event[${i}]`;
    if (!isObject(e)) {
      problems.push(where(`${at} is not an object`));
      return;
    }
    if (typeof e.id !== "number") {
      problems.push(where(`${at}.id must be a number`));
    } else if (seen.has(e.id)) {
      problems.push(where(`${at}.id ${e.id} duplicated`));
    } else {
      seen.add(e.id);
    }
    if (!ACTORS.includes(e.actor as Actor)) {
      problems.push(where(`${at}.actor invalid: ${String(e.actor)}`));
    }
    if (!KINDS.includes(e.kind as EventKind)) {
      problems.push(where(`${at}.kind invalid: ${String(e.kind)}`));
    }
    if (!isNonEmptyString(e.title)) {
      problems.push(where(`${at}.title missing`));
    }
    if (e.verdict !== undefined) {
      if (!isObject(e.verdict) || !RISKS.includes(e.verdict.level as RiskLevel)) {
        problems.push(where(`${at}.verdict.level must be one of ${RISKS.join(", ")}`));
      } else if (!isNonEmptyString(e.verdict.rationale)) {
        problems.push(where(`${at}.verdict.rationale missing`));
      }
    }
  });
  return problems;
}

export function parseTrace(raw: unknown): Trace {
  const problems = validateTrace(raw);
  if (problems.length > 0) {
    throw new Error(`Invalid trace:\n - ${problems.join("\n - ")}`);
  }
  return raw as Trace;
}

/** Return a copy of the trace with a resolved verdict on every event. */
export function withVerdicts(trace: Trace): Trace {
  return {
    ...trace,
    events: trace.events.map((e: TraceEvent) => ({ ...e, verdict: verdictFor(e) })),
  };
}

export function traceRiskCounts(trace: Trace): Record<RiskLevel, number> {
  const counts: Record<RiskLevel, number> = { safe: 0, caution: 0, danger: 0 };
  for (const e of trace.events) {
    counts[verdictFor(e).level] += 1;
  }
  return counts;
}
