// Snapshot pipeline: turn a directory of git repos into the Agentic-SE Coach
// web dataset — a weekly SSM trajectory per project plus per-committer review,
// computed non-destructively (git worktree) and anonymized before emit.
//
//   node <bundle> <repos-dir> <out-dir> [termStartISO] [weeks]
//
// Reuses the (tested) collector + @agentsafe/core analyzers so the numbers match
// the live extension and the validated P01–P18 reports.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { analyzeRepo, scoreS3, scoreS6, type SupervisionReport } from "@agentsafe/core";
import { collectRepoSignals } from "../src/collector";

const reposDir = process.argv[2];
const outDir = process.argv[3];
const TERM_START = process.argv[4] || "2026-01-12";
const WEEKS = Number(process.argv[5] || 16);
if (!reposDir || !outDir) {
  console.error("usage: snapshot <repos-dir> <out-dir> [termStartISO] [weeks]");
  process.exit(2);
}

function git(repo: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", repo, "-c", "core.quotepath=false", ...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function resolveBranch(repo: string): string {
  const head = git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).trim();
  if (head) return head.replace(/^origin\//, "");
  for (const b of ["main", "master"]) {
    if (git(repo, ["rev-parse", "--verify", b]).trim()) return b;
  }
  return "HEAD";
}

// ── identity merge ──────────────────────────────────────────────────────────
interface Ident { names: Set<string>; emails: Set<string>; commits: number; }

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function isBot(name: string, email: string): boolean {
  const n = name.toLowerCase();
  // NOTE: the bare `noreply@github.com` is GitHub's web-UI address used by REAL
  // students (edit/merge in the browser) — do NOT treat it as a bot. The per-user
  // `<id>+<user>@users.noreply.github.com` form is handled by noreplyUser().
  return (
    /\[bot\]|github-actions|dependabot/.test(n) ||
    /\[bot\]|github-actions|dependabot|@ip-\d/.test(email.toLowerCase()) ||
    n === "ubuntu" || n === "root" || n === "ec2-user"
  );
}
function noreplyUser(email: string): string | null {
  const m = email.match(/^\d+\+([^@]+)@users\.noreply\.github\.com$/i);
  return m ? m[1].toLowerCase() : null;
}
// Generic local-parts/usernames that must never be used as a merge key — they
// collide across unrelated people (admin@a vs admin@b are not the same human).
const GENERIC_LOCAL = new Set([
  "admin", "dev", "user", "git", "me", "info", "contact", "noreply",
  "test", "root", "mail", "email", "hello", "team", "support",
]);

function mergeIdentities(repo: string, branch: string): { byEmail: Map<string, number>; idents: Ident[] } {
  // Scope the identity universe to the SAME history the per-committer walk and
  // weekly tips use (the default branch) — using --all here would mint identities
  // for authors whose commits never reach `branch`, producing phantom 0-commit
  // "free riders" and skewed share denominators.
  const raw = git(repo, ["shortlog", "-sne", "--no-merges", branch]);
  const rows: { name: string; email: string; count: number }[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(\d+)\t(.*?)\s*<(.+?)>\s*$/);
    if (m && !isBot(m[2], m[3])) rows.push({ name: m[2], email: m[3].toLowerCase(), count: +m[1] });
  }
  // union-find over rows
  const parent = rows.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  // A noreply username is only a safe merge key when it's long enough and not a
  // generic token — otherwise "J Smith" (normName "jsmith") and GitHub user
  // "jsmith" on an unrelated account would be wrongly fused.
  const safeKey = (k: string | null): k is string => k !== null && k.length >= 4 && !GENERIC_LOCAL.has(k);
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const nu_a = noreplyUser(a.email), nu_b = noreplyUser(b.email);
      // Conservative merge keys, in descending confidence:
      //  • identical email;
      //  • identical normalized full name (>=3 chars);
      //  • two GitHub noreply emails with the same username (same account, the
      //    leading numeric id differs across machines);
      //  • a (safe) noreply username that exactly equals the other's full name.
      // We deliberately do NOT match a noreply username against an arbitrary
      // provider local-part (a gmail local-part is not a GitHub username).
      const same =
        a.email === b.email ||
        (normName(a.name).length >= 3 && normName(a.name) === normName(b.name)) ||
        (nu_a !== null && nu_b !== null && nu_a === nu_b) ||
        (safeKey(nu_a) && nu_a === normName(b.name)) ||
        (safeKey(nu_b) && nu_b === normName(a.name));
      if (same) union(i, j);
    }
  }
  const groups = new Map<number, Ident>();
  rows.forEach((r, i) => {
    const root = find(i);
    let g = groups.get(root);
    if (!g) { g = { names: new Set(), emails: new Set(), commits: 0 }; groups.set(root, g); }
    g.names.add(r.name); g.emails.add(r.email); g.commits += r.count;
  });
  const idents = [...groups.values()].sort((a, b) => b.commits - a.commits);
  const byEmail = new Map<string, number>();
  idents.forEach((g, idx) => g.emails.forEach((e) => byEmail.set(e, idx)));
  return { byEmail, idents };
}

// ── weekly checkpoint tips ──────────────────────────────────────────────────
function weeklyTips(repo: string, branch: string): { week: number; cutoff: string; sha: string }[] {
  const start = Date.parse(TERM_START + "T00:00:00Z");
  const out: { week: number; cutoff: string; sha: string }[] = [];
  for (let w = 1; w <= WEEKS; w++) {
    const end = new Date(start + w * 7 * 86400_000);
    const cutoff = end.toISOString();
    const sha = git(repo, ["rev-list", "-1", `--before=${cutoff}`, branch]).trim();
    if (sha) out.push({ week: w, cutoff, sha });
  }
  return out;
}

// ── historical analysis via worktree (non-destructive) ──────────────────────
const botExclude = (name: string, email: string): boolean => isBot(name, email);

function analyzeAt(repo: string, sha: string, repoId: string): SupervisionReport | null {
  const wt = path.join(os.tmpdir(), `agentsafe-wt-${path.basename(repo)}-${sha.slice(0, 10)}`);
  try {
    // Clear any leftover from a crashed/killed prior run at the same path (the wt
    // path is deterministic in repo+sha), then prune git's stale worktree records.
    try { fs.rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
    git(repo, ["worktree", "prune"]);
    // Use a CHECKED invocation: git() swallows errors, so a failed `worktree add`
    // would otherwise leave the existsSync guard passing on a stale dir and we'd
    // analyze garbage as if it were real. execFileSync throws on non-zero exit.
    try {
      execFileSync("git", ["-C", repo, "worktree", "add", "--detach", "--force", wt, sha], { stdio: "ignore" });
    } catch {
      return null;
    }
    // A real worktree always has a `.git` FILE — verify the add actually produced
    // one rather than just that *some* directory exists at the path.
    if (!fs.existsSync(path.join(wt, ".git"))) return null;
    const signals = collectRepoSignals(wt, repoId, "HEAD", botExclude);
    return analyzeRepo(signals);
  } catch {
    return null;
  } finally {
    git(repo, ["worktree", "remove", "--force", wt]);
    try { fs.rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
    git(repo, ["worktree", "prune"]);
  }
}

// ── per-committer aggregation (full history, no worktree) ───────────────────
interface CommitterAgg {
  commits: number; ins: number; del: number;
  implFiles: Set<string>; testFiles: Set<string>; testIns: number; implIns: number;
  bigCommits: number; firstTs: number; lastTs: number; offHours: number;
  times: number[]; implFirst: Map<string, number>; testFirst: Map<string, number>;
}
const IMPL_EXT = /\.(py|js|ts|tsx|jsx|java|rb|go)$/;
const isTest = (p: string) => {
  const segs = p.toLowerCase().split("/");
  const base = segs[segs.length - 1] ?? "";
  return segs.some((s) => ["tests", "test", "spec", "__tests__"].includes(s)) || /(^|[._-])(test|spec)([._-]|$)/.test(base);
};
const stem = (p: string) => (p.split("/").pop() ?? p).replace(/\.[^.]+$/, "");

/** End-load fraction (share of commits in the last 24h of the span) — the same
 *  cadence signal core's S6 uses, computed over ONE committer's own commits. */
function endLoadFrac(times: number[]): number {
  if (times.length === 0) return 1;
  const sorted = [...times].sort((a, b) => a - b);
  const spanH = (sorted[sorted.length - 1] - sorted[0]) / 3.6e6;
  if (spanH < 1) return 1;
  const cutoff = sorted[sorted.length - 1] - 24 * 3600 * 1000;
  return sorted.filter((t) => t >= cutoff).length / sorted.length;
}
/** Test-first fraction for one committer — mirrors core's testFirstAnalysis over
 *  the per-file first-seen timestamps within that committer's own commits. */
function testFirstFrac(implFirst: Map<string, number>, testFirst: Map<string, number>): number {
  let count = 0, total = 0;
  for (const [implF, implTs] of implFirst) {
    const base = stem(implF);
    for (const [testF, testTs] of testFirst) {
      const tb = stem(testF);
      if (tb.includes(base) || tb.replace("test_", "") === base || tb.replace("_test", "") === base) {
        total += 1;
        if (testTs <= implTs) count += 1;
        break;
      }
    }
  }
  return total > 0 ? count / total : 0;
}

function perCommitter(repo: string, branch: string, byEmail: Map<string, number>, n: number): CommitterAgg[] {
  const aggs: CommitterAgg[] = Array.from({ length: n }, () => ({
    commits: 0, ins: 0, del: 0, implFiles: new Set(), testFiles: new Set(),
    testIns: 0, implIns: 0, bigCommits: 0, firstTs: Infinity, lastTs: -Infinity, offHours: 0,
    times: [], implFirst: new Map(), testFirst: new Map(),
  }));
  const raw = git(repo, ["log", branch, "--no-merges", "--numstat", "--date=iso-strict", "--format=%x00%aE%n%aI"]);
  for (const block of raw.split("\0").slice(1)) {
    const lines = block.split("\n");
    const idx = byEmail.get((lines[0] ?? "").toLowerCase());
    if (idx === undefined) continue;
    const a = aggs[idx];
    const ts = Date.parse(lines[1] ?? "");
    const hourM = (lines[1] ?? "").match(/T(\d{2}):/);
    a.commits++;
    if (!Number.isNaN(ts)) { a.firstTs = Math.min(a.firstTs, ts); a.lastTs = Math.max(a.lastTs, ts); a.times.push(ts); }
    if (hourM) { const h = +hourM[1]; if (h < 6 || h >= 22) a.offHours++; }
    let cIns = 0;
    for (let i = 2; i < lines.length; i++) {
      const m = lines[i].match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      const ins = m[1] === "-" ? 0 : +m[1];
      const del = m[2] === "-" ? 0 : +m[2];
      a.ins += ins; a.del += del; cIns += ins;
      const f = m[3];
      if (isTest(f) && IMPL_EXT.test(f)) {
        a.testFiles.add(f); a.testIns += ins;
        if (!Number.isNaN(ts) && !a.testFirst.has(f)) a.testFirst.set(f, ts);
      } else if (IMPL_EXT.test(f)) {
        a.implFiles.add(f); a.implIns += ins;
        if (!Number.isNaN(ts) && !a.implFirst.has(f)) a.implFirst.set(f, ts);
      }
    }
    if (cIns > 300) a.bigCommits++;
  }
  return aggs;
}

// ── build one project ───────────────────────────────────────────────────────
const round = (x: number, p = 2) => Math.round(x * 10 ** p) / 10 ** p;
/** Spreadsheet-style committer label: 0→A … 25→Z, 26→AA, 27→AB … (never runs out). */
function colLabel(i: number): string {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

function gini(values: number[]): number {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  const n = v.length;
  if (n < 2) return 0;
  const sum = v.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * v[i];
  return round((2 * cum) / (n * sum) - (n + 1) / n, 2);
}

function buildProject(repo: string, pid: string, alias: string) {
  const branch = resolveBranch(repo);
  const { byEmail, idents } = mergeIdentities(repo, branch);
  const aggs = perCommitter(repo, branch, byEmail, idents.length);
  const totalCommits = aggs.reduce((s, a) => s + a.commits, 0) || 1;
  const totalChurn = aggs.reduce((s, a) => s + a.ins + a.del, 0) || 1;
  const startMs = Date.parse(TERM_START + "T00:00:00Z");
  const weekOf = (ts: number) => Math.min(WEEKS, Math.max(1, Math.ceil((ts - startMs) / (7 * 86400_000))));

  const committers = idents.map((id, i) => {
    const a = aggs[i];
    // Raw (un-rounded) shares for flag tests — rounding to 3dp can collapse a tiny
    // committer's commitShare to 0.000, degenerating the DUMPER ratio test.
    const rawCommitShare = a.commits / totalCommits;
    const rawChurnShare = (a.ins + a.del) / totalChurn;
    const commitShare = round(rawCommitShare, 3);
    const churnShare = round(rawChurnShare, 3);
    // Per-committer S3/S6 are an APPROXIMATION of the project axes: testRatio is an
    // insertion-based proxy (not the working-tree line-count ratio), and S6 can't
    // attribute branches/PRs to an individual (branchCount 1, hasPrs false). But the
    // cadence (endLoaded) and test-first signals are now computed for real, per person.
    const s3 = scoreS3({
      hasTests: a.testFiles.size > 0,
      testRatio: a.testIns / Math.max(a.implIns, 1),
      testFirstFraction: testFirstFrac(a.implFirst, a.testFirst),
    }).score;
    const spanH = a.lastTs > a.firstTs ? (a.lastTs - a.firstTs) / 3.6e6 : 0;
    const s6 = scoreS6({ total: a.commits, endLoaded: endLoadFrac(a.times), churn: a.del / Math.max(a.ins, 1), branchCount: 1, hasPrs: false, spanHours: spanH }).score;
    const aiPct = a.commits ? Math.round((a.bigCommits / a.commits) * 100) : 0;
    const flags: string[] = [];
    if (rawCommitShare < 0.05) flags.push("FREE_RIDER");
    if (rawCommitShare > 0 && rawChurnShare > rawCommitShare * 1.6 && a.testFiles.size === 0 && a.commits >= 3) flags.push("DUMPER");
    return {
      cid: `C${i + 1}`, alias: `Committer ${colLabel(i)}`, role: i === 0 ? "lead" : "member",
      commits: a.commits, commitShare, churnShare,
      firstWeek: a.firstTs < Infinity ? weekOf(a.firstTs) : 0,
      lastWeek: a.lastTs > -Infinity ? weekOf(a.lastTs) : 0,
      testsAuthored: a.testFiles.size, implFilesAuthored: a.implFiles.size,
      aiPct, offHoursPct: a.commits ? Math.round((a.offHours / a.commits) * 100) : 0,
      ssm: { S3: s3, S6: s6 }, flags,
    };
  });

  // weekly checkpoints (compute once per unique tip sha)
  const tips = weeklyTips(repo, branch);
  const cache = new Map<string, SupervisionReport | null>();
  const checkpoints: any[] = [];
  let prev: any = null;
  for (const t of tips) {
    if (!cache.has(t.sha)) cache.set(t.sha, analyzeAt(repo, t.sha, pid));
    const r = cache.get(t.sha);
    if (!r) continue;
    const mature = r.totalCommits >= 3;
    const s3 = r.scores.S3, s6 = r.scores.S6;
    const drift = s6 >= 0 && s3 >= 0 ? s6 - s3 : 0;
    const cp = {
      sid: `${pid}@W${String(t.week).padStart(2, "0")}`, seq: t.week, week: t.week, kind: "weekly",
      cutoff: t.cutoff, mature, reachableCommits: r.totalCommits,
      ssm: { scores: r.scores, source: { S1: "pending", S2: "pending", S3: "git", S4: "pending", S5: "pending", S6: "git" } },
      signals: {
        S3: { ...(r.areas.S3.detail ?? {}), reasoning: r.areas.S3.reasoning },
        S6: { ...(r.areas.S6.detail ?? {}), reasoning: r.areas.S6.reasoning },
      },
      ai: r.aiUsage ? { level: r.aiUsage.level, pct: round(r.aiUsage.weightedPct * 100, 1), explicit: r.aiUsage.explicitSignals, behavioral: r.aiUsage.topBehavioral } : null,
      drift: { s6MinusS3: drift, flag: mature && drift >= 2 ? "AUTOMATION_COMPLACENCY" : null },
      delta: prev ? { vsSid: prev.sid, ssm: { S3: s3 - prev.ssm.scores.S3, S6: s6 - prev.ssm.scores.S6 }, newCommits: r.totalCommits - prev.reachableCommits } : null,
    };
    checkpoints.push(cp);
    prev = cp;
  }

  const latest = checkpoints[checkpoints.length - 1];
  const driftMax = Math.max(0, ...checkpoints.filter((c) => c.mature).map((c) => c.drift.s6MinusS3));

  const project = {
    id: pid, alias, term: "2026S", defaultBranch: branch,
    committers, checkpoints,
    events: [], // PR overlay reserved
  };
  // Weeks with NEW activity (the first checkpoint, plus any later week that added
  // commits) — not every week a tip merely exists, which would count stagnant
  // post-burst weeks as "active".
  const weeksActive = checkpoints.filter((c) => !c.delta || c.delta.newCommits > 0).length;
  const summary = {
    id: pid, alias, slug: `anon-${pid.toLowerCase()}`,
    committers: idents.length, commits: totalCommits,
    weeksActive, giniCommitShare: gini(committers.map((c) => c.commits)),
    latest: latest
      ? { ssm: latest.ssm.scores, driftMax, aiLevel: latest.ai?.level ?? "Minimal", flags: latest.drift.flag ? [latest.drift.flag] : [] }
      : null,
  };
  return { project, summary };
}

// ── main ──────────────────────────────────────────────────────────────────
const dirs = fs
  .readdirSync(reposDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(reposDir, d.name, ".git")))
  .map((d) => d.name)
  .sort();

fs.mkdirSync(path.join(outDir, "projects"), { recursive: true });
const summaries: any[] = [];
let n = 0;
for (const dir of dirs) {
  n++;
  const pid = `P${String(n).padStart(2, "0")}`;
  const alias = `Project ${String(n).padStart(2, "0")}`;
  process.stdout.write(`[${n}/${dirs.length}] ${dir} → ${pid} … `);
  try {
    const { project, summary } = buildProject(path.join(reposDir, dir), pid, alias);
    fs.writeFileSync(path.join(outDir, "projects", `${pid}.json`), JSON.stringify(project));
    summaries.push(summary);
    console.log(`${summary.committers} committers, ${project.checkpoints.length} checkpoints, gini ${summary.giniCommitShare}`);
  } catch (e) {
    console.log(`SKIP (${String(e)})`);
  }
}

const manifest = {
  schemaVersion: "2.0",
  generatedAt: process.argv[6] || "2026-06-23T00:00:00Z",
  scale: { min: 0, max: 3, sentinel: -1, labels: ["Absent", "Developing", "Proficient", "Exemplary"] },
  term: { id: "2026S", start: TERM_START, weeks: WEEKS },
  ssmAxes: ["S1", "S2", "S3", "S4", "S5", "S6"],
  liveAxes: ["S3", "S6"],
  projects: summaries,
};
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(manifest, null, 2));
console.log(`\n→ wrote ${summaries.length} projects + index.json to ${outDir}`);
