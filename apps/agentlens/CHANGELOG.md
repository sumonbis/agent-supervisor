# Change Log

All notable changes to **AgentLens** are documented here.

## [0.1.0] — Initial release

A lens into what AI coding agents really do.

### Added
- **Trace Explorer**: a summary **chain of step nodes** (color-coded by risk) plus a detailed
  **thread**. Open any step to reveal the under-the-hood detail and an oracle-computed safety
  verdict, then approve / replan / block.
- **Import a real SWE-agent run** (`.traj`/`.json`/`.jsonl`) and a "Run SWE-agent on this repo"
  terminal helper; bundled sample run.
- **Trust scenarios**: short gamified decisions that score your **trust calibration**
  (accuracy, Brier, over-trust vs over-caution) with a calibration rank.
- Activity Bar view, getting-started walkthrough, local-only progress + reset.

### Notes
- Everything is a safe simulation — no real commands run and nothing leaves your machine.
- Safety flags on imported runs are heuristic (reference oracles); research-grade enforcement is
  the separate AgentSafe Guard line.
- No SSM here — the Supervision Skill Model lives in the sibling **Agentic-SE Coach**.
