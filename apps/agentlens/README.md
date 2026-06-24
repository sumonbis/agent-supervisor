# AgentLens

**See what AI coding agents really do — and learn when to trust them.**

AI agents plan, edit files, run commands, and report "done" on their own — but a lot happens
*under the hood*. **AgentLens** is a VS Code extension (and no-install browser app) that lets you
**click through what an agent actually did**, step by step: open each step to reveal the hidden
details, see the **safety flags**, and decide — approve, replan, or block. It's built to be quick,
visual, and friendly for **CS and non-CS** students alike.

> No setup, no real commands, nothing to break. Sample runs are safe simulations; you can also
> import a real run from your own repo.

## Two ways in

- **🔍 Trace Explorer** — the heart of it. A run is shown as a **summary chain of step nodes**
  (green / amber / red by risk) plus a detailed **thread**. Open any step to see what *really*
  happened, with an oracle-computed safety verdict, then make the call. Explore the bundled sample
  runs, or **import a real SWE-agent run** (`.traj`).
- **⚡ Trust scenarios** — short, gamified what-would-you-do moments (the Phantom Revert, the
  Overeager Cleanup, …) that score your **trust calibration**: are you over-trusting, or
  over-cautious?

## Getting started

1. Install the extension.
2. Click the **lens icon** in the Activity Bar → **Open AgentLens**, or run **`AgentLens: Open`**
   from the Command Palette (`Ctrl/Cmd+Shift+P`).
3. Explore a run or play a scenario. Your trust-calibration profile builds as you go.

### Bring a real run

You can explore a run an agent *actually* performed on a real repository. AgentLens reads
**SWE-agent** trajectory files (`.traj` / `.json` / `.jsonl`): each step's *thought* becomes the
intent, the *action* the command, the *observation* the under-the-hood detail, and the reference
oracles flag anything risky.

There are two commands — one to **import** a run you already have, and one to **produce** a run.

#### A. Already have a `.traj`? Import it

1. Command Palette → **`AgentLens: Import a Real Agent Run (SWE-agent)…`**.
2. Pick the `.traj` (or `.json`/`.jsonl`) file. SWE-agent writes it under your output
   directory (see below) — e.g. `swe-agent-output/<run-id>/<run-id>.traj`.
3. The run opens in the Trace Explorer — chain view + thread, with safety verdicts.

#### B. Run SWE-agent on this repository

This produces a real trajectory you can then import. **AgentLens does not run the agent for you**
— it builds the exact command and drops it (un-executed) into a terminal so you can read it before
running. SWE-agent runs in its own sandbox; AgentLens only *reads* the result.

**Prerequisites (one-time):**

```bash
# 1. Install SWE-agent (see https://swe-agent.com for the current instructions)
git clone https://github.com/SWE-agent/SWE-agent.git
cd SWE-agent && pip install --editable .

# 2. Give it an API key for the model you want it to drive
export ANTHROPIC_API_KEY=sk-ant-...      # or OPENAI_API_KEY, etc.
```

**Each run:**

1. Open the repository you want the agent to work on as your VS Code workspace folder.
2. Command Palette → **`AgentLens: Run SWE-agent on This Repository…`**.
3. Type the task (the *problem statement*), e.g. *"Fix the failing test in the auth module."*
4. AgentLens opens a **SWE-agent** terminal pre-filled with a command like:

   ```bash
   sweagent run \
     --agent.model.name claude-sonnet-4-5 \
     --env.repo.path "/path/to/your/repo" \
     --problem_statement.text "Fix the failing test in the auth module" \
     --output_dir swe-agent-output
   ```

   It is **not auto-run** — review it first. Change `--agent.model.name` to your preferred model
   (e.g. another Claude or an OpenAI model your key supports). Press **Enter** to start it.
5. When it finishes, SWE-agent writes a `.traj` under `swe-agent-output/…`. Run
   **`AgentLens: Import a Real Agent Run…`** and pick that file to explore what the agent did.

> Tip: agents can run shell commands and edit files in their sandbox. Point SWE-agent at a clone or
> a disposable checkout, not anything precious — and treat every step in the trajectory as something
> to **review**, which is exactly the skill AgentLens is teaching.

## Privacy & safety

Runs **100% locally**. No telemetry, no network calls. Sample scenarios and traces are scripted
simulations — the agent never touches your files or shell. Imported runs are read-only.

## Build from source

```bash
npm install            # from the monorepo root (workspaces)
npm run compile -w agentlens
npm test -w agentlens
npm run preview -w agentlens   # no-install browser build (great for demos / STEM day)
npm run build:vsix -w agentlens
```

## Where it fits

AgentLens is the **trace-exploration & trust** tool. Its sibling **Agentic-SE Coach** is the
assessment tool for semester-long, group agentic-SE projects (it scores a real repo on the
Supervision Skill Model). Both are built on the shared `@agentsafe/core` library.

## License

MIT © Sumon Biswas.
