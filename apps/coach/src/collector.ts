// Collect RepoSignals from a real repository (git history + files), mirroring
// the SIGCSE Python collector. Pure Node (child_process git + fs); core's
// analyzers turn these signals into a SupervisionReport.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CommitInfo, RepoSignals } from "@agentsafe/core";

const IMPL_EXT = new Set([".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".rb", ".go"]);
const IGNORE_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build",
  "out", ".next", "coverage", "vendor", ".gradle", "target", "coach-snapshots",
]);
/** The tool's own outputs — never let them feed back into analysis. */
const OWN_OUTPUTS = new Set(["supervision-report.json", "AI-DISCLOSURE.md"]);
/** Skip reading files larger than this (bundles, generated/minified code). */
const MAX_FILE_BYTES = 1_500_000;

// Anchored test detection: a path SEGMENT named test/spec/tests/__tests__, or a
// basename token like test_x / x_test / x.test.js / x.spec.ts. Crucially this no
// longer flags ordinary files that merely contain the substring "test"
// (latest.py, contest.js, attestation.go, …).
function isTestFile(p: string): boolean {
  const segs = p.toLowerCase().split(/[\\/]/);
  const base = segs[segs.length - 1] ?? "";
  return (
    segs.some((s) => s === "tests" || s === "test" || s === "spec" || s === "__tests__") ||
    /(^|[._-])(test|spec)([._-]|$)/.test(base)
  );
}
function isImplFile(p: string): boolean {
  return IMPL_EXT.has(path.extname(p)) && !isTestFile(p);
}
function inIgnored(p: string): boolean {
  return p.split(/[\\/]/).some((seg) => IGNORE_DIRS.has(seg));
}

/** git emits non-ASCII/special paths double-quoted with octal escapes; decode them. */
function unquoteGitPath(p: string): string {
  if (p.length < 2 || p[0] !== '"' || p[p.length - 1] !== '"') {
    return p;
  }
  const inner = p.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\") {
      const n = inner[i + 1];
      if (n >= "0" && n <= "7") {
        bytes.push(parseInt(inner.slice(i + 1, i + 4), 8) & 0xff);
        i += 3;
      } else {
        const map: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, "\\": 92 };
        bytes.push(map[n] ?? (n ? n.charCodeAt(0) : 92));
        i += 1;
      }
    } else {
      bytes.push(inner.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Expand a numstat rename form (`{old => new}/f` or `old => new`) to the new path. */
function normalizeRename(p: string): string {
  if (!p.includes(" => ")) {
    return p;
  }
  const brace = p.match(/^(.*)\{(.*?) => (.*?)\}(.*)$/);
  if (brace) {
    return (brace[1] + brace[3] + brace[4]).replace(/\/\//g, "/");
  }
  return p.split(" => ").pop() ?? p;
}

function gitPath(field: string): string {
  return normalizeRename(unquoteGitPath(field));
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, "-c", "core.quotepath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

interface GitData {
  commits: CommitInfo[];
  branchCount: number;
  hasPrs: boolean;
  hasReverts: boolean;
}

/**
 * `authorExclude(name, email)` lets a caller drop bot/CI commits so they don't
 * inflate totals/cadence. Default is undefined (no filtering) — preserving the
 * live-extension behavior and the P01–P18 regression numbers.
 */
function collectGit(
  repo: string,
  rev = "--all",
  authorExclude?: (name: string, email: string) => boolean,
): GitData | null {
  let raw: string;
  try {
    // NUL record separator (\x00) is collision-proof — a commit subject can never
    // contain a NUL. Fields: sha, name, email, isoDate, parents, subject.
    // `rev` is "--all" (every branch, for live analysis) or a commit-ish like "HEAD"
    // (history reachable from a checkpoint, for the snapshot pipeline).
    raw = git(repo, [
      "log", rev, "--date=iso-strict", "--numstat",
      "--format=%x00%H%n%an%n%aE%n%aI%n%P%n%s",
    ]);
  } catch {
    return null; // not a git repo or git unavailable
  }

  const commits: CommitInfo[] = [];
  for (const block of raw.split("\0").slice(1)) {
    const lines = block.split("\n");
    const author = lines[1] ?? "";
    const authorEmail = (lines[2] ?? "").toLowerCase();
    if (authorExclude && authorExclude(author, authorEmail)) continue;
    const iso = lines[3] ?? "";
    const parents = (lines[4] ?? "").trim().split(/\s+/).filter(Boolean);
    let insertions = 0;
    let deletions = 0;
    const files: string[] = [];
    for (let i = 6; i < lines.length; i++) {
      const m = lines[i].match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      insertions += m[1] === "-" ? 0 : parseInt(m[1], 10);
      deletions += m[2] === "-" ? 0 : parseInt(m[2], 10);
      files.push(gitPath(m[3]));
    }
    const hourMatch = iso.match(/T(\d{2}):/);
    commits.push({
      sha: (lines[0] ?? "").slice(0, 8),
      author,
      authorEmail,
      timestamp: iso,
      hour: hourMatch ? parseInt(hourMatch[1], 10) : -1, // -1 = unknown (not midnight)
      message: lines[5] ?? "",
      isMerge: parents.length > 1,
      filesChanged: files,
      insertions,
      deletions,
      implFiles: files.filter((f) => isImplFile(f) && !inIgnored(f)),
      testFiles: files.filter((f) => isTestFile(f) && !inIgnored(f)),
    });
  }
  commits.reverse(); // chronological order

  // Branch count drives S6's `structured` flag. It is only meaningful for live
  // analysis (rev === "--all"). For a historical/detached checkpoint (rev is a
  // commit-ish, e.g. "HEAD" in a worktree), `git branch` lists the SHARED repo's
  // PRESENT-DAY branches — not the branches that existed at that point — which
  // would spuriously credit S6 on early checkpoints. So we hold it at 1 there.
  let branchCount = 1;
  if (rev === "--all") {
    branchCount = 0;
    try {
      branchCount = git(repo, ["branch", "-r"])
        .split("\n")
        .filter((l) => l.trim() && !l.includes("->")).length;
    } catch {
      /* ignore */
    }
    if (branchCount === 0) {
      try {
        // Drop the detached-HEAD marker line (`* (no branch)` in worktrees,
        // `* (HEAD detached at …)` otherwise) so it isn't counted as a branch.
        branchCount = git(repo, ["branch"])
          .split("\n")
          .filter((l) => l.trim() && !/\((no branch|HEAD detached)/.test(l)).length;
      } catch {
        /* ignore */
      }
    }
  }

  return {
    commits,
    branchCount,
    // hasPrs/hasReverts read commit messages on the full set (merges included).
    hasPrs: commits.some((c) => /merge pull request/i.test(c.message)),
    hasReverts: commits.some((c) => /\brevert\b/i.test(c.message)),
  };
}

interface FileData {
  files: string[];
  impl: string[];
  tests: string[];
  codeText: Record<string, string>;
  readme: string;
  hasCi: boolean;
}

function sizeOf(full: string): number {
  try {
    return fs.statSync(full).size;
  } catch {
    return Infinity;
  }
}
/** Skip files too large or obviously generated/minified to be authored work. */
function skipForAnalysis(name: string, full: string): boolean {
  return /\.(min|bundle)\.(js|css)$/i.test(name) || sizeOf(full) > MAX_FILE_BYTES;
}

function collectFiles(repo: string): FileData {
  const files: string[] = [];
  const impl: string[] = [];
  const tests: string[] = [];
  const codeText: Record<string, string> = {};
  let readme = "";

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue; // avoid symlink loops / escapes
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) {
          walk(path.join(dir, e.name));
        }
        continue;
      }
      if (OWN_OUTPUTS.has(e.name)) continue; // never analyze our own outputs
      const full = path.join(dir, e.name);
      const rel = path.relative(repo, full);
      if (inIgnored(rel)) continue;
      files.push(rel);
      const isImplExt = IMPL_EXT.has(path.extname(rel));
      if (isTestFile(rel) && isImplExt) {
        if (!skipForAnalysis(e.name, full)) tests.push(rel);
      } else if (isImplFile(rel)) {
        if (skipForAnalysis(e.name, full)) continue;
        impl.push(rel);
        try {
          codeText[rel] = fs.readFileSync(full, "utf8");
        } catch {
          /* ignore unreadable */
        }
      }
      if (!readme && /^readme\.(md|rst|txt)$/i.test(e.name) && sizeOf(full) <= MAX_FILE_BYTES) {
        try {
          readme = fs.readFileSync(full, "utf8");
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(repo);

  const hasCi = [".github/workflows", ".travis.yml", "Jenkinsfile", ".circleci"].some((p) =>
    fs.existsSync(path.join(repo, p)),
  );
  return { files, impl, tests, codeText, readme, hasCi };
}

function lineCount(s: string): number {
  return s ? s.split("\n").length : 0;
}

/**
 * Build RepoSignals for `repoPath` from its git history and working tree.
 * `rev` scopes the history: "--all" (default, every branch) for live analysis,
 * or a commit-ish (e.g. "HEAD" in a detached worktree) for a historical checkpoint.
 * `authorExclude` (optional) drops matching authors (e.g. CI bots) from the
 * commit history so they don't inflate totals/cadence; default keeps everyone.
 */
export function collectRepoSignals(
  repoPath: string,
  repoId?: string,
  rev = "--all",
  authorExclude?: (name: string, email: string) => boolean,
): RepoSignals {
  const g = collectGit(repoPath, rev, authorExclude);
  const f = collectFiles(repoPath);

  const implLines = f.impl.reduce((s, p) => s + lineCount(f.codeText[p] ?? ""), 0);
  let testLines = 0;
  for (const t of f.tests) {
    try {
      testLines += lineCount(fs.readFileSync(path.join(repoPath, t), "utf8"));
    } catch {
      /* ignore */
    }
  }

  const commits = g?.commits ?? [];
  const first = commits[0]?.timestamp;
  const last = commits[commits.length - 1]?.timestamp;
  const spanHours = first && last ? (Date.parse(last) - Date.parse(first)) / 3_600_000 : 0;

  return {
    repoId: repoId ?? path.basename(repoPath),
    commits,
    totalCommits: commits.length,
    branchCount: g?.branchCount ?? 0,
    hasPrs: g?.hasPrs ?? false,
    hasReverts: g?.hasReverts ?? false,
    implFiles: f.impl,
    testFiles: f.tests,
    files: f.files,
    readmeText: f.readme,
    codeText: f.codeText,
    testToImplRatio: testLines / Math.max(implLines, 1),
    commitSpanHours: spanHours,
    hasCi: f.hasCi,
  };
}
