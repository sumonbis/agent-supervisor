// Repo analyzers ported from the SIGCSE Python tool. S3 (Verify) and S6
// (Orchestrate) are the metric-based, LLM-free competencies — scored here exactly
// as the Python tool scores them. S1/S2/S4/S5 need an LLM and are left unassessed
// (-1) for a later pass. Also ports the multi-signal AI-usage detector.
//
// Scoring is split from metric-collection so the scoring rules can be unit-tested
// against the real P01–P18 reports.

import type {
  AiEvidenceLevel,
  AiSignalResult,
  AiUsageResult,
  AreaResult,
  CommitInfo,
  RepoSignals,
  SupervisionReport,
} from "./types";
import { buildReport, emptyAreas } from "./report";

// ─────────────────────────────────────────────────────────────────────────────
// S3 — Verify
// ─────────────────────────────────────────────────────────────────────────────

export interface S3Metrics {
  hasTests: boolean;
  testRatio: number;
  testFirstFraction: number;
}

export function scoreS3(m: S3Metrics): { score: 0 | 1 | 2 | 3; reasoning: string } {
  if (!m.hasTests) {
    return { score: 0, reasoning: "No test files found in the repository." };
  }
  const parts = [`Test-to-implementation line ratio: ${m.testRatio.toFixed(2)}.`];
  parts.push(
    m.testFirstFraction > 0
      ? `Test-first pattern for ${Math.round(m.testFirstFraction * 100)}% of matched feature pairs.`
      : "No test-first pattern detected.",
  );
  if (m.testRatio >= 0.15 && m.testFirstFraction >= 0.5) {
    return { score: 3, reasoning: `${parts.join(" ")} Consistent test-first with coverage → Exemplary.` };
  }
  if (m.testRatio >= 0.15 || m.testFirstFraction >= 0.2) {
    return { score: 2, reasoning: `${parts.join(" ")} Tests present and proportionate → Proficient.` };
  }
  return { score: 1, reasoning: `${parts.join(" ")} Tests minimal or after-the-fact → Emerging.` };
}

function testFirstAnalysis(commits: CommitInfo[]): { count: number; total: number } {
  const implFirst = new Map<string, number>();
  const testFirstTs = new Map<string, number>();
  for (const c of commits) {
    const ts = Date.parse(c.timestamp);
    for (const f of c.implFiles) if (!implFirst.has(f)) implFirst.set(f, ts);
    for (const f of c.testFiles) if (!testFirstTs.has(f)) testFirstTs.set(f, ts);
  }
  const stem = (p: string) => (p.split("/").pop() ?? p).replace(/\.[^.]+$/, "");
  let count = 0;
  let total = 0;
  for (const [implF, implTs] of implFirst) {
    const base = stem(implF);
    for (const [testF, testTs] of testFirstTs) {
      const tb = stem(testF);
      if (tb.includes(base) || tb.replace("test_", "") === base || tb.replace("_test", "") === base) {
        total += 1;
        if (testTs <= implTs) count += 1;
        break;
      }
    }
  }
  return { count, total };
}

export function analyzeS3(signals: RepoSignals): AreaResult {
  const hasTests = signals.testFiles.length > 0;
  const { count, total } = testFirstAnalysis(signals.commits);
  const testFirstFraction = total > 0 ? count / total : 0;
  const metrics: S3Metrics = { hasTests, testRatio: signals.testToImplRatio, testFirstFraction };
  const { score, reasoning } = scoreS3(metrics);
  return {
    area: "S3",
    score,
    reasoning,
    detail: {
      hasTests,
      testRatio: round(signals.testToImplRatio, 3),
      testFirstCount: count,
      totalFeaturePairs: total,
      testFirstFraction: round(testFirstFraction, 3),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// S6 — Orchestrate & Recover
// ─────────────────────────────────────────────────────────────────────────────

export interface S6Metrics {
  total: number;
  endLoaded: number;
  churn: number;
  branchCount: number;
  hasPrs: boolean;
  spanHours: number;
}

export function scoreS6(m: S6Metrics): { score: 0 | 1 | 2 | 3; reasoning: string } {
  if (m.total < 3) {
    return { score: 0, reasoning: `Only ${m.total} commits — insufficient history.` };
  }
  const goodCadence = m.endLoaded < 0.6 && m.spanHours > 12;
  const structured = m.branchCount > 1 || m.hasPrs;
  const base = `${m.total} commits over ${m.spanHours.toFixed(1)}h; ${Math.round(m.endLoaded * 100)}% in last 24h; churn ${m.churn.toFixed(2)}.`;
  if (goodCadence && structured && m.churn < 1.5) {
    return { score: 3, reasoning: `${base} Distributed, structured, manageable churn → Exemplary.` };
  }
  if (goodCadence || structured) {
    return { score: 2, reasoning: `${base} Some workflow discipline → Proficient.` };
  }
  if (!(m.endLoaded > 0.9 && m.total < 5)) {
    return { score: 1, reasoning: `${base} Ad-hoc workflow → Emerging.` };
  }
  return { score: 0, reasoning: `${base} All work in a single session → Absent.` };
}

function endLoadFraction(commits: CommitInfo[], spanHours: number): number {
  if (commits.length === 0 || spanHours < 1) return 1.0;
  const last = Date.parse(commits[commits.length - 1].timestamp);
  const cutoff = last - 24 * 3600 * 1000;
  const late = commits.filter((c) => Date.parse(c.timestamp) >= cutoff).length;
  return late / commits.length;
}

export function analyzeS6(signals: RepoSignals): AreaResult {
  const total = signals.totalCommits;
  const commits = signals.commits;
  const endLoaded = total >= 3 ? endLoadFraction(commits, signals.commitSpanHours) : 1.0;
  const totalIns = commits.reduce((s, c) => s + c.insertions, 0) || 1;
  const totalDel = commits.reduce((s, c) => s + c.deletions, 0);
  const churn = totalDel / totalIns;
  const metrics: S6Metrics = {
    total,
    endLoaded,
    churn,
    branchCount: signals.branchCount,
    hasPrs: signals.hasPrs,
    spanHours: signals.commitSpanHours,
  };
  const { score, reasoning } = scoreS6(metrics);
  return {
    area: "S6",
    score,
    reasoning,
    detail: {
      totalCommits: total,
      commitSpanHours: round(signals.commitSpanHours, 1),
      endLoadedFraction: round(endLoaded, 3),
      churnRatio: round(churn, 3),
      branchCount: signals.branchCount,
      hasPrs: signals.hasPrs,
      hasReverts: signals.hasReverts,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI-usage signals (faithful re-implementation of scripts/ai_usage.py)
// ─────────────────────────────────────────────────────────────────────────────

const AI_TOOL_KEYWORDS =
  /\b(copilot|chatgpt|chat-gpt|gpt-?4|gpt-?3|claude|cursor|codewhisperer|tabnine|codeium|llm|ai.?generated|ai.?assisted|ai.?tool|agentic|openai|anthropic|gemini|co.?pilot|windsurf|devin)\b/i;
const AI_CONFIG_PATHS = [
  ".cursor", "copilot-instructions.md", ".github/copilot.yml", "CLAUDE.md",
  ".clinerules", ".cursorrules", ".aider.conf.yml", ".ai", "ai-instructions.md", ".windsurf",
];
const COAUTHOR_RE = /co.?authored.?by:.*?(copilot|bot|github.actions|dependabot)/i;
const DISCLOSURE_RE = /(disclosure|ai.?use|ai.?statement|llm.?use|copilot.?use|acknowledgement)/i;

function countMatches(re: RegExp, text: string): number {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  return (text.match(g) ?? []).length;
}

const SIGNAL_WEIGHTS: Record<string, number> = {
  e1: 3.0, e2: 2.5, e3: 3.0, e4: 3.0, e5: 3.0,
  b1: 1.0, b2: 1.5, b3: 1.5, b4: 1.0, b5: 1.0, b6: 1.5, b7: 0.5,
  t1: 0.5, t2: 0.5,
};
// Per-signal max score (t1 only ever reaches 2) so weightedPct can reach 1.0.
const SIGNAL_MAX: Record<string, number> = {
  e1: 3, e2: 3, e3: 3, e4: 3, e5: 3, b1: 3, b2: 3, b3: 3, b4: 3, b5: 3, b6: 3, b7: 3, t1: 2, t2: 3,
};
const MAX_WEIGHTED = Object.entries(SIGNAL_WEIGHTS).reduce((s, [k, w]) => s + w * (SIGNAL_MAX[k] ?? 3), 0);

function aiEvidenceLevel(weighted: number): AiEvidenceLevel {
  const pct = weighted / MAX_WEIGHTED;
  if (pct >= 0.4) return "High";
  if (pct >= 0.2) return "Moderate";
  if (pct >= 0.08) return "Low";
  return "Minimal";
}

export function analyzeAiUsage(signals: RepoSignals): AiUsageResult {
  const commits = signals.commits;
  const code = Object.values(signals.codeText);
  const allCode = code.join("\n");
  const nonBlank = allCode.split("\n").filter((l) => l.trim()).length;
  const totalLines = Math.max(nonBlank, 1);
  // Line-density signals are meaningless on a near-empty codebase — gate them.
  const tooSmall = nonBlank < 10;

  const sig: Record<string, AiSignalResult> = {};
  const set = (k: string, score: number, detail?: Record<string, unknown>) =>
    (sig[k] = { key: k, score: Math.max(0, Math.min(3, score)), detail });

  // Explicit
  const e1hits = commits.filter((c) => AI_TOOL_KEYWORDS.test(c.message)).length;
  set("e1", e1hits, { count: e1hits });
  const e2hits = new Set((signals.readmeText.toLowerCase().match(new RegExp(AI_TOOL_KEYWORDS.source, "gi")) ?? [])).size;
  set("e2", e2hits, { uniqueKeywords: e2hits });
  const e3found = AI_CONFIG_PATHS.filter((p) => signals.files.some((f) => f === p || f.endsWith("/" + p) || f.startsWith(p + "/")));
  set("e3", e3found.length * 2, { files: e3found });
  const e4hits = commits.filter((c) => COAUTHOR_RE.test(c.message)).length;
  set("e4", e4hits * 2, { count: e4hits });
  const e5found = signals.files.filter((f) => f.endsWith(".md") && DISCLOSURE_RE.test(f));
  if (DISCLOSURE_RE.test(signals.readmeText.toLowerCase())) e5found.push("README.md (inline)");
  set("e5", e5found.length * 3, { files: e5found });

  // Behavioral
  const sizes = commits.map((c) => c.insertions + c.deletions).filter((x) => x > 0);
  if (sizes.length < 3) {
    set("b1", 0);
  } else {
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const std = Math.sqrt(sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / sizes.length);
    const cv = mean > 0 ? std / mean : 0;
    const max = Math.max(...sizes);
    const large = sizes.filter((s) => s > 500).length;
    set("b1", cv > 3 || max > 2000 ? 3 : cv > 2 || max > 1000 ? 2 : large > 0 ? 1 : 0, { cv: round(cv, 2), max });
  }
  const commentLines = countMatches(/^\s*(#|\/\/|\/\*|\*)/m, allCode);
  const cd = commentLines / totalLines;
  set("b2", tooSmall ? 0 : cd > 0.3 ? 3 : cd > 0.2 ? 2 : cd > 0.12 ? 1 : 0, { density: round(cd, 3) });
  const py = Object.entries(signals.codeText).filter(([k]) => k.endsWith(".py"));
  if (py.length === 0) {
    set("b3", 0);
    set("b4", 0);
  } else {
    const withDoc = py.filter(([, v]) => /"""[\s\S]*?"""|'''[\s\S]*?'''/.test(v)).length;
    const cov = withDoc / py.length;
    set("b3", cov > 0.7 ? 3 : cov > 0.4 ? 2 : cov > 0.2 ? 1 : 0, { coverage: round(cov, 2) });
    const hints = py.reduce((a, [, v]) => a + countMatches(/:\s*(str|int|float|bool|list|dict|tuple|set|Optional|Union|Any|List\[|Dict\[|Tuple\[|Set\[|Sequence\[|Callable)/, v), 0);
    const pyLines = py.reduce((a, [, v]) => a + v.split("\n").length, 0) || 1;
    const dens = hints / pyLines;
    set("b4", dens > 0.08 ? 3 : dens > 0.04 ? 2 : dens > 0.01 ? 1 : 0, { density: round(dens, 4) });
  }
  const todos = countMatches(/#\s*(TODO|FIXME|HACK|XXX|NOTE|OPTIMIZE)\b/i, allCode);
  const perFile = todos / Math.max(code.length, 1);
  set("b5", perFile > 3 ? 3 : perFile > 1.5 ? 2 : perFile > 0.5 ? 1 : 0, { perFile: round(perFile, 2) });
  const boiler = countMatches(/#\s*(this\s+(function|method|class|module|file)\b|returns?:|args?:|param(eter)?s?:|example:|note:\s|important:|todo:\s|fixme:\s|raises?:|yields?:|usage:)/i, allCode);
  const bd = boiler / totalLines;
  set("b6", tooSmall ? 0 : bd > 0.04 ? 3 : bd > 0.02 ? 2 : bd > 0.005 ? 1 : 0, { density: round(bd, 4) });
  const longVars = countMatches(/\b([a-z][a-z0-9]*(?:_[a-z][a-z0-9]*){3,})\b/, allCode);
  const ld = longVars / totalLines;
  set("b7", tooSmall ? 0 : ld > 0.15 ? 3 : ld > 0.08 ? 2 : ld > 0.03 ? 1 : 0, { density: round(ld, 3) });

  // Temporal — exclude commits with an unknown hour (-1) from the off-hours fraction.
  const dated = commits.filter((c) => c.hour >= 0);
  const offhours = dated.filter((c) => c.hour < 6 || c.hour >= 22).length;
  const offFrac = dated.length ? offhours / dated.length : 0;
  set("t1", offFrac > 0.3 ? 2 : offFrac > 0.15 ? 1 : 0, { fraction: round(offFrac, 3) });
  // Count DISTINCT bursts (≥5 commits within 30 min), not one per starting index.
  const times = commits.map((c) => Date.parse(c.timestamp)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  let bursts = 0;
  for (let i = 0; i < times.length; i++) {
    const windowCount = times.filter((t) => t >= times[i] && t - times[i] < 1800 * 1000).length;
    if (windowCount >= 5 && (i === 0 || times[i] - times[i - 1] >= 1800 * 1000)) bursts += 1;
  }
  set("t2", bursts > 5 ? 3 : bursts > 2 ? 2 : bursts > 0 ? 1 : 0, { bursts });

  const weighted = Object.entries(sig).reduce((s, [k, v]) => s + (SIGNAL_WEIGHTS[k] ?? 0) * v.score, 0);
  const explicit = ["e1", "e2", "e3", "e4", "e5"].filter((k) => sig[k].score > 0);
  const behavioral = ["b1", "b2", "b3", "b4", "b5", "b6", "b7"]
    .filter((k) => sig[k].score > 0)
    .sort((a, b) => sig[b].score - sig[a].score)
    .slice(0, 3);

  return {
    level: aiEvidenceLevel(weighted),
    weighted: round(weighted, 2),
    weightedPct: round(weighted / MAX_WEIGHTED, 3),
    explicitSignals: explicit,
    topBehavioral: behavioral,
    signals: sig,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Full report (what Coach calls)
// ─────────────────────────────────────────────────────────────────────────────

export function analyzeRepo(signals: RepoSignals): SupervisionReport {
  const areas = emptyAreas();
  areas.S3 = analyzeS3(signals);
  areas.S6 = analyzeS6(signals);
  // S1/S2/S4/S5 stay -1 (need an LLM pass).
  for (const a of ["S1", "S2", "S4", "S5"] as const) {
    areas[a] = { area: a, score: -1, reasoning: "Needs an LLM pass (not yet computed)." };
  }
  return buildReport(
    {
      repoId: signals.repoId,
      remoteUrl: signals.remoteUrl,
      totalCommits: signals.totalCommits,
      implFileCount: signals.implFiles.length,
      testFileCount: signals.testFiles.length,
      hasCi: signals.hasCi,
    },
    areas,
    analyzeAiUsage(signals),
  );
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
