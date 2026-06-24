# Agent Supervisor

**An education stack for the supervisory generation — engineers who specify intent, audit agent traces, and calibrate trust in AI coding agents.**

🌐 **Website & live demos:** [sumonbis.github.io/agent-supervisor](https://sumonbis.github.io/agent-supervisor/)

AI agents plan, edit files, run commands, and report "done" on their own. The new engineering skill is **supervision**. This repo is a working software stack — built on one shared, tested core — that teaches and measures it, grounded in the **Supervision Skill Model (SSM)**: S1 Direct, S2 Approve, S3 Verify, S4 Critique, S5 Own, S6 Orchestrate.

## What's inside

| Component | What it is | Status | Try it |
|---|---|---|---|
| **[AgentLens](apps/agentlens)** | VS Code extension (+ no-install browser demo) to read an agent's trace step by step, reveal the under-the-hood details and safety verdicts, and calibrate trust. For CS **and** non-CS students. | ✅ Live | [Marketplace](https://marketplace.visualstudio.com/items?itemName=sumonbis.agentlens-supervisor) · [Browser demo](https://sumonbis.github.io/agent-supervisor/agentlens/) |
| **[Agentic-SE Coach — web](apps/coach)** | A git-like review website that scores a whole class's repos on the SSM each week (S3 Verify + S6 Orchestrate from git history), surfaces the automation-complacency signature, and supports multi-committer review. | ✅ Live | [Review site](https://sumonbis.github.io/agent-supervisor/coach/) |
| **Agentic-SE Coach — VS Code** | Push abstracted supervision snapshots from the IDE straight into the review site. | 🟡 Proposed (CAREER) — early prototype exists | — |
| **[@agentsafe/core](packages/core)** | The shared TypeScript library: SSM model, trust-calibration scoring, safety-aware trace schema, reference oracles, git analyzers (S3/S6), and the 14-signal AI-usage detector. | ✅ Core | 35 tests |

The featured AgentLens example is a **real `mini-swe-agent` run** on the `abs-lang/abs` Go interpreter: every targeted test passed (functional reward 1.0), yet the safety verifier failed it for editing two files outside the task — including a test file it authored itself. *Green is not the same as safe.*

## The Coach demo dataset & privacy

The Coach review site is generated from **18 real student team projects**, studied under **IRB approval**. The published dataset is **anonymized at generation time** — only scores, counts, and signal flags are emitted (Committer A / Project NN). **No source code, file paths, emails, commit SHAs, or real identities are ever published**, and the source repositories themselves are not included in this repo.

## Repository layout

```
packages/core      @agentsafe/core — the shared library (schema, SSM, oracles, analyzers)
apps/agentlens     AgentLens VS Code extension + browser preview
apps/coach         Agentic-SE Coach — extension, the snapshot pipeline, and the web SPA
docs/              The published website (GitHub Pages): landing + /agentlens/ + /coach/
```

## Build from source

```bash
npm install                         # workspaces
npm test -w packages/core           # 35 tests (incl. S3/S6 validated on 18 repos)
npm run build:vsix -w apps/agentlens
npm run build:vsix -w apps/coach
```

Generate a Coach dataset from your own repos and serve it:

```bash
cd apps/coach
node -e "require('esbuild').buildSync({entryPoints:['scripts/snapshot.ts'],bundle:true,platform:'node',format:'cjs',outfile:'/tmp/snap.cjs'})"
node /tmp/snap.cjs /path/to/repos web/data 2026-01-12 16
cd web && python3 -m http.server 5603     # open http://localhost:5603
```

Per-tool usage: **[AgentLens README](apps/agentlens/README.md)** · **[Agentic-SE Coach README](apps/coach/README.md)**.

## License

MIT © Sumon Biswas.
