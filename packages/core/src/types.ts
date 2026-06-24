// Shared data model for AgentSafe. No runtime deps, no `vscode` — safe to use
// from extensions, Node scripts, tests, and (bundled) webviews.

// ─────────────────────────────────────────────────────────────────────────────
// Supervision Skill Model (SSM)
// ─────────────────────────────────────────────────────────────────────────────

/** The six SSM competency areas. */
export type SSMArea = "S1" | "S2" | "S3" | "S4" | "S5" | "S6";

/** Rubric levels (Absent..Exemplary). */
export type Level = 0 | 1 | 2 | 3;

/** A competency score, or -1 when not assessed. */
export type SSMScore = Level | -1;

/** Ground-truth / verdict risk of an action. */
export type RiskLevel = "safe" | "caution" | "danger";

/** What a runtime safety gate would do. */
export type GateAction = "allow" | "warn" | "block";

/** Audience targeting for scenarios and traces. */
export type Audience = "cs" | "general" | "both";

// ─────────────────────────────────────────────────────────────────────────────
// Scenarios (Trainer — guided calibration "quiz")
// ─────────────────────────────────────────────────────────────────────────────

export type Outcome = "good" | "risky" | "bad";
export type DecisionKind = "trust" | "gate" | "approve";

export interface CodeSnippet {
  filename: string;
  language: string;
  /** Unified-diff-style body (+ / - / space line prefixes). */
  diff?: string;
  /** Plain content when not a diff. */
  text?: string;
}

export interface DecisionOption {
  id: string;
  label: string;
  feedback: string;
  outcome: Outcome;
  /** For `trust` decisions: does this choice predict the action is safe? */
  predictsSafe?: boolean;
}

export interface DecisionPoint {
  prompt: string;
  kind: DecisionKind;
  options: DecisionOption[];
  /** id of the best option. */
  correct: string;
  /** For `trust` decisions: is the agent's action actually safe? */
  actualSafe?: boolean;
  askConfidence?: boolean;
}

export interface Step {
  id: number;
  title: string;
  agentSays: string;
  whatHappened: string;
  tool?: string;
  command?: string;
  code?: CodeSnippet;
  risk: RiskLevel;
  gate?: GateAction;
  explain: string;
  decision?: DecisionPoint;
}

export interface Debrief {
  summary: string;
  lessons: string[];
  realWorld?: string;
}

export type Difficulty = "intro" | "core" | "advanced";

export interface ScenarioMeta {
  id: string;
  title: string;
  tagline: string;
  task: string;
  agent: string;
  domain: string;
  difficulty: Difficulty;
  audience?: Audience;
  /** Short, human-readable theme tags (e.g. "claim truthfulness"). Not SSM. */
  focus: string[];
  estMinutes: number;
}

export interface Scenario extends ScenarioMeta {
  steps: Step[];
  debrief: Debrief;
}

// ─────────────────────────────────────────────────────────────────────────────
// Traces (Trace Explorer / Coach replay / Guard) — safety-aware
// ─────────────────────────────────────────────────────────────────────────────

export type Actor = "agent" | "human" | "system";

export type EventKind =
  | "prompt"
  | "plan"
  | "approval"
  | "edit"
  | "command"
  | "test"
  | "claim"
  | "commit"
  | "deploy"
  | "network"
  | "note";

/** Supervisory actions a student can take on a trace node. */
export type TraceActionKind = "approve" | "replan" | "block" | "undo" | "stepIn" | "verify";

/** A safety verdict produced by an oracle (or authored on a sample trace). */
export interface Verdict {
  level: RiskLevel;
  oracle?: string;
  severity?: "low" | "medium" | "high" | "critical";
  rationale: string;
  gate?: GateAction;
}

export interface TraceEvent {
  id: number;
  actor: Actor;
  kind: EventKind;
  /** Short label, e.g. "Edited checkout.js". */
  title: string;
  /** Natural-language content the agent emitted (claim/plan/prompt). */
  text?: string;
  tool?: string;
  command?: string;
  code?: CodeSnippet;
  /** Plain-language description of the real state change. */
  stateChange?: string;
  /** The "under the hood" detail revealed when a student opens the node. */
  hidden?: string;
  /** Authored verdict; if omitted, oracles can derive one. */
  verdict?: Verdict;
  /** Supervisory actions offered at this node. */
  actions?: TraceActionKind[];
}

export interface Trace {
  id: string;
  title: string;
  tagline?: string;
  task: string;
  agent: string;
  domain: string;
  audience: Audience;
  events: TraceEvent[];
  summary?: string;
}

/** A safety oracle maps one trace event to a verdict (or null = nothing to flag). */
export type Oracle = (event: TraceEvent) => Verdict | null;

// ─────────────────────────────────────────────────────────────────────────────
// Trust calibration (AgentLens) — no SSM
// ─────────────────────────────────────────────────────────────────────────────

export interface DecisionRecord {
  scenarioId: string;
  stepId: number;
  kind: DecisionKind;
  chosenOptionId: string;
  chosenOutcome: Outcome;
  correct: boolean;
  predictedSafe?: boolean;
  actualSafe?: boolean;
  confidence?: number;
}

export interface CalibrationResult {
  decisions: number;
  correct: number;
  accuracy: number;
  brier: number | null;
  overTrust: number;
  overCaution: number;
}

export type CalibrationRank = "Rookie" | "Watcher" | "Inspector" | "Eagle-eye";

export interface CalibrationProfile {
  totalDecisions: number;
  totalCorrect: number;
  accuracy: number;
  brier: number | null;
  overTrust: number;
  overCaution: number;
  completed: string[];
  rank: CalibrationRank;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supervision report + repo signals (Coach — aligned with the SIGCSE Python tool)
// ─────────────────────────────────────────────────────────────────────────────

export interface AreaResult {
  area: SSMArea;
  score: SSMScore;
  reasoning: string;
  detail?: Record<string, unknown>;
}

export interface AiSignalResult {
  key: string;
  score: number;
  detail?: Record<string, unknown>;
}

export type AiEvidenceLevel = "Minimal" | "Low" | "Moderate" | "High";

export interface AiUsageResult {
  level: AiEvidenceLevel;
  weighted: number;
  weightedPct: number;
  explicitSignals: string[];
  topBehavioral: string[];
  signals: Record<string, AiSignalResult>;
}

export interface SupervisionReport {
  repoId: string;
  remoteUrl?: string;
  totalCommits: number;
  implFileCount: number;
  testFileCount: number;
  hasCi: boolean;
  scores: Record<SSMArea, SSMScore>;
  overall: number;
  overallLabel: string;
  areas: Record<SSMArea, AreaResult>;
  aiUsage?: AiUsageResult;
}

export interface CommitInfo {
  sha: string;
  message: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Local hour 0-23, or -1 when the timestamp could not be parsed (≠ midnight). */
  hour: number;
  author: string;
  /** Lowercased author email (for committer identity merging). */
  authorEmail?: string;
  /** True when the commit has >1 parent (a merge). */
  isMerge?: boolean;
  filesChanged: string[];
  insertions: number;
  deletions: number;
  implFiles: string[];
  testFiles: string[];
}

/** Raw signals collected from a repository (the Coach app fills this in). */
export interface RepoSignals {
  repoId: string;
  remoteUrl?: string;
  commits: CommitInfo[];
  totalCommits: number;
  branchCount: number;
  hasPrs: boolean;
  hasReverts: boolean;
  implFiles: string[];
  testFiles: string[];
  /** All repo-relative file paths (for config/disclosure-file detection). */
  files: string[];
  readmeText: string;
  /** path → file contents (impl files). */
  codeText: Record<string, string>;
  testToImplRatio: number;
  commitSpanHours: number;
  hasCi: boolean;
}
