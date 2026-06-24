import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { scoreS3, scoreS6, analyzeAiUsage } from "../src/analyzers";
import type { RepoSignals } from "../src/types";

const REPORTS_DIR = path.resolve(__dirname, "../../test/fixtures/ssm-reports");

function loadReports(): any[] {
  return fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), "utf8")));
}

test("ported S3 scoring reproduces the Python tool on all real repos", () => {
  const reports = loadReports();
  assert.ok(reports.length >= 18, `expected >=18 reports, got ${reports.length}`);
  let checked = 0;
  for (const r of reports) {
    if (r.s3_score < 0) continue; // not assessed in that run
    const d = r.s3_detail;
    const got = scoreS3({
      hasTests: !!d.has_tests,
      testRatio: d.test_ratio,
      testFirstFraction: d.test_first_fraction,
    }).score;
    assert.equal(got, r.s3_score, `${r.repo_id}: S3 expected ${r.s3_score}, got ${got}`);
    checked++;
  }
  assert.ok(checked >= 15, `expected to check >=15 S3 scores, checked ${checked}`);
});

test("ported S6 scoring reproduces the Python tool on all real repos", () => {
  const reports = loadReports();
  let checked = 0;
  for (const r of reports) {
    if (r.s6_score < 0) continue;
    const d = r.s6_detail;
    const got = scoreS6({
      total: d.total_commits,
      endLoaded: d.end_loaded_fraction,
      churn: d.churn_ratio,
      branchCount: d.branch_count,
      hasPrs: d.has_prs,
      spanHours: d.commit_span_hours,
    }).score;
    assert.equal(got, r.s6_score, `${r.repo_id}: S6 expected ${r.s6_score}, got ${got}`);
    checked++;
  }
  assert.ok(checked >= 15, `expected to check >=15 S6 scores, checked ${checked}`);
});

test("scoreS3 boundary cases", () => {
  assert.equal(scoreS3({ hasTests: false, testRatio: 0, testFirstFraction: 0 }).score, 0);
  assert.equal(scoreS3({ hasTests: true, testRatio: 0.2, testFirstFraction: 0.6 }).score, 3);
  assert.equal(scoreS3({ hasTests: true, testRatio: 0.2, testFirstFraction: 0 }).score, 2);
  assert.equal(scoreS3({ hasTests: true, testRatio: 0.05, testFirstFraction: 0.25 }).score, 2);
  assert.equal(scoreS3({ hasTests: true, testRatio: 0.01, testFirstFraction: 0 }).score, 1);
});

test("scoreS6 boundary cases", () => {
  assert.equal(scoreS6({ total: 2, endLoaded: 1, churn: 0, branchCount: 1, hasPrs: false, spanHours: 1 }).score, 0);
  assert.equal(scoreS6({ total: 50, endLoaded: 0.1, churn: 0.2, branchCount: 3, hasPrs: true, spanHours: 200 }).score, 3);
  assert.equal(scoreS6({ total: 50, endLoaded: 0.1, churn: 0.2, branchCount: 1, hasPrs: false, spanHours: 200 }).score, 2);
  assert.equal(scoreS6({ total: 4, endLoaded: 0.95, churn: 5, branchCount: 1, hasPrs: false, spanHours: 2 }).score, 0);
});

function baseSignals(over: Partial<RepoSignals> = {}): RepoSignals {
  return {
    repoId: "T", commits: [], totalCommits: 0, branchCount: 1, hasPrs: false,
    hasReverts: false, implFiles: [], testFiles: [], files: [], readmeText: "",
    codeText: {}, testToImplRatio: 0, commitSpanHours: 0,
    hasCi: false, ...over,
  };
}

test("analyzeAiUsage flags explicit signals and computes a level", () => {
  const res = analyzeAiUsage(
    baseSignals({
      commits: [
        { sha: "a", message: "feat: add auth (generated with Claude)", timestamp: "2026-01-01T12:00:00Z", hour: 12, author: "x", filesChanged: [], insertions: 10, deletions: 0, implFiles: [], testFiles: [] },
      ],
      files: ["CLAUDE.md", "src/app.py"],
      readmeText: "Built with Cursor and ChatGPT. ## AI disclosure: used Copilot.",
    }),
  );
  assert.ok(res.signals.e1.score > 0, "e1 should fire on commit keyword");
  assert.ok(res.signals.e3.score > 0, "e3 should fire on CLAUDE.md");
  assert.ok(res.explicitSignals.includes("e1"));
  assert.ok(["Minimal", "Low", "Moderate", "High"].includes(res.level));
});

test("analyzeAiUsage on an empty repo is Minimal", () => {
  const res = analyzeAiUsage(baseSignals());
  assert.equal(res.level, "Minimal");
  assert.equal(res.explicitSignals.length, 0);
});

test("regression: one dense cluster counts as ONE burst, not one per commit", () => {
  const commits = Array.from({ length: 10 }, (_, i) => ({
    sha: String(i), message: "wip", author: "x", hour: 12,
    timestamp: new Date(Date.UTC(2026, 0, 1, 12, i, 0)).toISOString(),
    filesChanged: [], insertions: 5, deletions: 0, implFiles: [], testFiles: [],
  }));
  const res = analyzeAiUsage(baseSignals({ commits }));
  assert.equal(res.signals.t2.detail?.bursts, 1, "10 commits in 30 min = 1 distinct burst");
  assert.equal(res.signals.t2.score, 1);
});

test("regression: unknown commit hour (-1) is excluded from the off-hours signal", () => {
  const commits = Array.from({ length: 6 }, (_, i) => ({
    sha: String(i), message: "wip", author: "x", hour: -1,
    timestamp: "bad-timestamp", filesChanged: [], insertions: 5, deletions: 0, implFiles: [], testFiles: [],
  }));
  const res = analyzeAiUsage(baseSignals({ commits }));
  assert.equal(res.signals.t1.score, 0, "unknown-hour commits must not inflate off-hours");
});
