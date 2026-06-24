// Parse and validate scenario JSON. `validateScenario` returns a list of
// human-readable problems; `parseScenario` throws if any are found.

import type {
  DecisionKind,
  Outcome,
  RiskLevel,
  Scenario,
  GateAction,
  Difficulty,
} from "./types";

const RISKS: RiskLevel[] = ["safe", "caution", "danger"];
const GATES: GateAction[] = ["allow", "warn", "block"];
const OUTCOMES: Outcome[] = ["good", "risky", "bad"];
const KINDS: DecisionKind[] = ["trust", "gate", "approve"];
const DIFFICULTIES: Difficulty[] = ["intro", "core", "advanced"];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateScenario(raw: unknown): string[] {
  const problems: string[] = [];
  const id = isObject(raw) && isNonEmptyString(raw.id) ? (raw.id as string) : "<unknown>";
  const where = (msg: string) => `[${id}] ${msg}`;

  if (!isObject(raw)) {
    return ["Scenario is not an object."];
  }

  for (const field of ["id", "title", "tagline", "task", "agent", "domain"]) {
    if (!isNonEmptyString(raw[field])) {
      problems.push(where(`missing/empty string field "${field}"`));
    }
  }
  if (!DIFFICULTIES.includes(raw.difficulty as Difficulty)) {
    problems.push(where(`difficulty must be one of ${DIFFICULTIES.join(", ")}`));
  }
  if (typeof raw.estMinutes !== "number" || raw.estMinutes <= 0) {
    problems.push(where(`estMinutes must be a positive number`));
  }
  if (!Array.isArray(raw.focus) || raw.focus.length === 0) {
    problems.push(where(`focus must be a non-empty array of theme tags`));
  } else {
    raw.focus.forEach((f, i) => {
      if (!isNonEmptyString(f)) {
        problems.push(where(`focus[${i}] must be a non-empty string`));
      }
    });
  }

  const steps = raw.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    problems.push(where(`steps must be a non-empty array`));
  } else {
    const seenIds = new Set<number>();
    steps.forEach((s, i) => {
      const at = `step[${i}]`;
      if (!isObject(s)) {
        problems.push(where(`${at} is not an object`));
        return;
      }
      if (typeof s.id !== "number") {
        problems.push(where(`${at}.id must be a number`));
      } else if (seenIds.has(s.id)) {
        problems.push(where(`${at}.id ${s.id} is duplicated`));
      } else {
        seenIds.add(s.id);
      }
      for (const field of ["title", "agentSays", "whatHappened", "explain"]) {
        if (!isNonEmptyString(s[field])) {
          problems.push(where(`${at}.${field} missing/empty`));
        }
      }
      if (!RISKS.includes(s.risk as RiskLevel)) {
        problems.push(where(`${at}.risk must be one of ${RISKS.join(", ")}`));
      }
      if (s.gate !== undefined && !GATES.includes(s.gate as GateAction)) {
        problems.push(where(`${at}.gate must be one of ${GATES.join(", ")}`));
      }
      if (s.code !== undefined) {
        if (!isObject(s.code) || !isNonEmptyString(s.code.filename)) {
          problems.push(where(`${at}.code must have a filename`));
        } else if (!isNonEmptyString(s.code.diff) && !isNonEmptyString(s.code.text)) {
          problems.push(where(`${at}.code must have either diff or text`));
        }
      }
      if (s.decision !== undefined) {
        problems.push(...validateDecision(s.decision, where, at));
      }
    });
  }

  if (!isObject(raw.debrief)) {
    problems.push(where(`debrief must be an object`));
  } else {
    if (!isNonEmptyString(raw.debrief.summary)) {
      problems.push(where(`debrief.summary missing`));
    }
    if (!Array.isArray(raw.debrief.lessons) || raw.debrief.lessons.length === 0) {
      problems.push(where(`debrief.lessons must be a non-empty array`));
    }
  }

  return problems;
}

function validateDecision(
  decision: unknown,
  where: (msg: string) => string,
  at: string,
): string[] {
  const problems: string[] = [];
  if (!isObject(decision)) {
    return [where(`${at}.decision is not an object`)];
  }
  if (!isNonEmptyString(decision.prompt)) {
    problems.push(where(`${at}.decision.prompt missing`));
  }
  if (!KINDS.includes(decision.kind as DecisionKind)) {
    problems.push(where(`${at}.decision.kind must be one of ${KINDS.join(", ")}`));
  }
  const options = decision.options;
  if (!Array.isArray(options) || options.length < 2) {
    problems.push(where(`${at}.decision.options needs at least 2 options`));
    return problems;
  }
  const ids = new Set<string>();
  options.forEach((o, k) => {
    if (!isObject(o)) {
      problems.push(where(`${at}.decision.options[${k}] is not an object`));
      return;
    }
    if (!isNonEmptyString(o.id)) {
      problems.push(where(`${at}.decision.options[${k}].id missing`));
    } else if (ids.has(o.id)) {
      problems.push(where(`${at}.decision.options[${k}].id "${o.id}" duplicated`));
    } else {
      ids.add(o.id);
    }
    if (!isNonEmptyString(o.label)) {
      problems.push(where(`${at}.decision.options[${k}].label missing`));
    }
    if (!isNonEmptyString(o.feedback)) {
      problems.push(where(`${at}.decision.options[${k}].feedback missing`));
    }
    if (!OUTCOMES.includes(o.outcome as Outcome)) {
      problems.push(
        where(`${at}.decision.options[${k}].outcome must be one of ${OUTCOMES.join(", ")}`),
      );
    }
  });
  if (!isNonEmptyString(decision.correct)) {
    problems.push(where(`${at}.decision.correct missing`));
  } else if (!ids.has(decision.correct as string)) {
    problems.push(where(`${at}.decision.correct "${decision.correct}" is not an option id`));
  }
  if (decision.actualSafe !== undefined && typeof decision.actualSafe !== "boolean") {
    problems.push(where(`${at}.decision.actualSafe must be boolean`));
  }
  if ((decision.kind as DecisionKind) === "trust") {
    if (decision.actualSafe === undefined) {
      problems.push(where(`${at}.decision is a trust decision but actualSafe is unset`));
    }
    options.forEach((o, k) => {
      if (isObject(o) && typeof o.predictsSafe !== "boolean") {
        problems.push(
          where(`${at}.decision.options[${k}].predictsSafe required for trust decisions`),
        );
      }
    });
    const correctOpt = options.find((o) => isObject(o) && o.id === decision.correct) as
      | Record<string, unknown>
      | undefined;
    if (
      correctOpt &&
      typeof correctOpt.predictsSafe === "boolean" &&
      typeof decision.actualSafe === "boolean" &&
      correctOpt.predictsSafe !== decision.actualSafe
    ) {
      problems.push(where(`${at}.decision.correct option's predictsSafe must equal actualSafe`));
    }
  }
  return problems;
}

export function parseScenario(raw: unknown): Scenario {
  const problems = validateScenario(raw);
  if (problems.length > 0) {
    throw new Error(`Invalid scenario:\n - ${problems.join("\n - ")}`);
  }
  return raw as Scenario;
}
