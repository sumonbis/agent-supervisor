# Agentic-SE Coach

**See how well-supervised your agentic SE work is — straight from your repository.**

When you build software with an AI agent, the grade isn't just "does it work" — it's whether
*you* stayed in control: did you verify the output, keep the workflow disciplined, and own what
you submitted? **Agentic-SE Coach** analyzes your repo's git history and files and scores it on the
**Supervision Skill Model (SSM)**, then helps you produce an honest AI-use disclosure.

It is the student-facing, in-IDE companion to the SIGCSE *supervision-telemetry* tool — it computes
**the same S3 (Verify) and S6 (Orchestrate) scores** from your git history, plus a multi-signal
**AI-tool usage** estimate.

Agentic-SE Coach has **two halves**:

- a **student-facing VS Code extension** that scores the repo you're working in, and
- an **instructor/reviewer web app** — a git-like website that lays out every team's supervision
  over the whole term so you can review many committers at a glance.

---

## Students: the VS Code extension

1. Open your project folder in VS Code.
2. Click the shield in the Activity Bar, or run a command from the Palette (`Ctrl/Cmd+Shift+P`):

   | Command | What it does |
   |---|---|
   | **`Agentic-SE Coach: Analyze This Repository`** | Opens the dashboard — S3/S6 scores, the six SSM areas, AI-usage evidence, and an automation-complacency callout. |
   | **`Agentic-SE Coach: Export Report + Disclosure`** | Writes `supervision-report.json` (same format the class dashboards read) and a fill-in `AI-DISCLOSURE.md` into your repo. Overwrites are confirmed first. |
   | **`Agentic-SE Coach: Push Supervision Snapshot`** | Writes an **abstracted** snapshot (scores + signals only — *no source, paths, or identities*) to `coach-snapshots/`. Commit it so your reviewer can see your supervision over time. |

3. Read the dashboard, then export your disclosure to hand in. Push a snapshot whenever you want a
   checkpoint to show up in the review website.

> **What "push" actually sends:** nothing leaves your machine on its own. `Push Supervision
> Snapshot` only *writes a file* into `coach-snapshots/`. It becomes shareable when **you commit and
> push that file** with git — and it contains only numbers (scores, counts, signal flags), never
> your code, file names, emails, or commit hashes.

---

## Instructors: the review website

The web app (`apps/coach/web/`) is a static site — vanilla JS + hand-drawn SVG, no build step, no
server framework. You generate a dataset from a folder of repos, then serve or deploy the folder.

### 1. Generate the dataset

Point the pipeline at a directory whose subfolders are git repos (it analyzes every subdir that
contains a `.git`, non-destructively, via `git worktree` — your repos are never modified):

```bash
# from apps/coach/ — bundle the pipeline once…
node -e "require('esbuild').buildSync({entryPoints:['scripts/snapshot.ts'],bundle:true,platform:'node',format:'cjs',outfile:'/tmp/snap.cjs'})"

# …then run it:  <repos-dir> <out-dir> [termStartISO] [weeks]
node /tmp/snap.cjs /path/to/class-repos web/data 2026-01-12 16
```

It writes `web/data/index.json` (the project manifest) and `web/data/projects/P01.json …`. Every
identity is anonymized to *Committer A*, *Project 01* — no emails, commit SHAs, file paths, or
source are ever emitted.

### 2. Browse it

```bash
cd web && python3 -m http.server 5603     # then open http://localhost:5603
```

Five views: **project list** (sorted by review priority, with complacency badges and contribution-
imbalance bars) → **timeline** (the weekly S3-vs-S6 trajectory with the shaded complacency gap) →
**snapshot** (SSM radar + reasoning + Approve/Flag review) → **committers** (shares, free-rider /
dumper flags) → **committer scorecard**.

### 3. Deploy (optional)

It's fully static — push `apps/coach/web/` to **GitHub Pages** (or any static host) and the review
site is live, no backend required.

### How students feed it

Students run **`Push Supervision Snapshot`** and commit the `coach-snapshots/` file; you collect
those repos (or their snapshots) and re-run the pipeline to refresh `web/data/`.

## What it measures

| Area | How | Source |
|---|---|---|
| **S3 Verify** | test/impl ratio, test-first pattern | git history (no LLM) |
| **S6 Orchestrate** | commit cadence, churn, branches, PRs, reverts | git history (no LLM) |
| S1 / S2 / S4 / S5 | _needs an instructor LLM pass_ | — |
| **AI-tool usage** | 14 explicit + behavioral + temporal signals | commits, files, code |

S3/S6 reproduce the scores of the validated SIGCSE Python tool (verified against 18 real student repos
in `@agentsafe/core`'s tests).

## Privacy

Runs **100% locally** — the extension shells out to `git` and reads files in the folder you choose;
the pipeline reads repos read-only via throwaway worktrees. Nothing is uploaded. The disclosure and
report are written only when you ask, only into your repo, and the web dataset is **anonymized by
construction** (scores and signal counts only — never source, paths, identities, or commit hashes).

## Build from source

```bash
npm install                     # from the monorepo root (workspaces)
npm run compile -w apps/coach
npm test -w apps/coach
# Press F5 in VS Code to launch an Extension Development Host
npm run build:vsix -w apps/coach   # → agentic-se-coach-<version>.vsix
```

## License

MIT © Sumon Biswas.
