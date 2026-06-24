// The Supervision Skill Model (SSM): six competency areas for supervising
// AI coding agents (Biswas et al., "From Prompting to Supervision", SIGCSE TS 2027).

import type { SSMArea, Level } from "./types";

export interface SSMInfo {
  area: SSMArea;
  name: string;
  verb: string;
  question: string;
  blurb: string;
  failureMode: string;
  icon: string;
}

export const SSM: Record<SSMArea, SSMInfo> = {
  S1: {
    area: "S1",
    name: "Direct",
    verb: "specify & scope",
    question: "Is the task delegable and well-scoped?",
    blurb: "Turn a goal into a clear, bounded task and say what must NOT change.",
    failureMode: "Under-specifying, which invites scope creep.",
    icon: "target",
  },
  S2: {
    area: "S2",
    name: "Approve",
    verb: "review the plan",
    question: "Should this plan be executed?",
    blurb: "Read the agent's plan critically before any code is written.",
    failureMode: "Rubber-stamping a plan you didn't understand.",
    icon: "checklist",
  },
  S3: {
    area: "S3",
    name: "Verify",
    verb: "test & reproduce",
    question: "Does the change actually work?",
    blurb: "Confirm behavior yourself — passing tests is not the same as a met requirement.",
    failureMode: "Trusting a green checkmark you never inspected.",
    icon: "beaker",
  },
  S4: {
    area: "S4",
    name: "Critique",
    verb: "audit the reasoning",
    question: "Is the agent's reasoning trustworthy?",
    blurb: "Catch confident-but-wrong claims, hidden changes, and false 'done' reports.",
    failureMode: "Complacency — believing the agent because it sounds sure.",
    icon: "search",
  },
  S5: {
    area: "S5",
    name: "Own",
    verb: "be accountable",
    question: "Can you answer for this submission?",
    blurb: "Take responsibility for, and be able to explain, code you didn't write.",
    failureMode: "“The AI did it” — ownership decoupled from authorship.",
    icon: "verified",
  },
  S6: {
    area: "S6",
    name: "Orchestrate",
    verb: "manage & recover",
    question: "Is the workflow under control?",
    blurb: "Gate the workflow, and know when to stop re-prompting and take over.",
    failureMode: "Thrashing — re-prompting forever instead of intervening.",
    icon: "workflow",
  },
};

export const SSM_ORDER: SSMArea[] = ["S1", "S2", "S3", "S4", "S5", "S6"];

export interface Era {
  key: string;
  role: string;
  tool: string;
  act: string;
}

export const ERAS: Era[] = [
  { key: "author", role: "Author", tool: "editor / IDE", act: "writes the code" },
  { key: "prompter", role: "Prompter", tool: "autocomplete", act: "accepts suggestions" },
  { key: "supervisor", role: "Supervisor", tool: "agentic AI", act: "directs an agent" },
];

export const LEVELS: Record<Level, string> = {
  0: "Locked",
  1: "Emerging",
  2: "Proficient",
  3: "Exemplary",
};

/** Rubric labels including the -1 "not assessed" sentinel (matches the Python tool). */
export const RUBRIC_LABELS: Record<number, string> = {
  [-1]: "N/A",
  0: "Absent",
  1: "Emerging",
  2: "Proficient",
  3: "Exemplary",
};

export function isSSMArea(value: unknown): value is SSMArea {
  return typeof value === "string" && (SSM_ORDER as string[]).includes(value);
}
