# Change Log

## [0.1.0] — Initial release

- Analyze a repository's git history + files and score it on the Supervision Skill Model
  (S3 Verify and S6 Orchestrate computed locally; S1/S2/S4/S5 left for an instructor LLM pass).
- Multi-signal AI-tool usage estimate (14 explicit / behavioral / temporal signals).
- In-IDE supervision dashboard with the automation-complacency callout (high S6 / low S3).
- Export `supervision-report.json` (same format as the SIGCSE dashboards) and a fill-in
  `AI-DISCLOSURE.md`.
- Powered by `@agentsafe/core`, whose S3/S6 scoring is validated against 18 real student repos.
