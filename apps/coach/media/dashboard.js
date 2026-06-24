// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");

  const SSM = {
    S1: { name: "Direct", blurb: "specify & scope" },
    S2: { name: "Approve", blurb: "review the plan" },
    S3: { name: "Verify", blurb: "test & reproduce" },
    S4: { name: "Critique", blurb: "audit reasoning" },
    S5: { name: "Own", blurb: "be accountable" },
    S6: { name: "Orchestrate", blurb: "manage & recover" },
  };
  const ORDER = ["S1", "S2", "S3", "S4", "S5", "S6"];
  const LEVEL = { "-1": "Needs LLM", 0: "Absent", 1: "Emerging", 2: "Proficient", 3: "Exemplary" };
  const SIGNALS = {
    e1: "Commit mentions AI", e2: "README mentions AI", e3: "AI config file", e4: "Co-author bot", e5: "Disclosure file",
    b1: "Commit-size anomaly", b2: "Comment density", b3: "Docstring coverage", b4: "Type annotations",
    b5: "TODO density", b6: "Boilerplate phrases", b7: "Verbose naming", t1: "Off-hours", t2: "Burst commits",
  };
  const SIGNAL_ORDER = ["e1", "e2", "e3", "e4", "e5", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "t1", "t2"];

  const SHIELD =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l8 3v6c0 5-3.5 8.6-8 10-4.5-1.4-8-5-8-10V5z"/></svg>';

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function cls(score) { return score < 0 ? "na" : "l" + score; }

  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "report") render(e.data.report);
  });

  function render(r) {
    const ai = r.aiUsage;
    const s3 = r.areas.S3.score;
    const s6 = r.areas.S6.score;
    const complacency = s6 >= 2 && s3 >= 0 && s3 < s6;

    app.innerHTML = `
      <div class="topbar">
        <div class="brand">
          <div class="brand-mark">${SHIELD}</div>
          <div class="brand-text"><strong>Agentic-SE Coach</strong><div>Supervision report · <code>${esc(r.repoId)}</code></div></div>
        </div>
        <button class="btn" id="export">Export report + disclosure</button>
      </div>

      <div class="stats">
        <div class="stat"><div class="num">${r.totalCommits}</div><div class="lbl">commits</div></div>
        <div class="stat"><div class="num">${r.implFileCount}</div><div class="lbl">impl files</div></div>
        <div class="stat"><div class="num">${r.testFileCount}</div><div class="lbl">test files</div></div>
        <div class="stat"><div class="num">${r.hasCi ? "Yes" : "No"}</div><div class="lbl">CI configured</div></div>
      </div>

      <div class="overall">
        <div><div class="big">${r.overall}</div><div class="lbl">/ 3 overall</div></div>
        <div><div class="ring">${esc(r.overallLabel)}</div><div class="lbl">assessed areas only (S3 + S6 from git; S1/S2/S4/S5 need an LLM pass)</div></div>
      </div>

      ${complacency ? `<div class="callout callout--warn">${SHIELD} <b>Automation-complacency signature:</b> strong workflow (S6 ${LEVEL[s6]}) but weaker verification (S3 ${LEVEL[s3]}). The work is organized, but the tests don't keep pace — exactly the pattern supervisory-control theory predicts for capable automation.</div>` : ""}

      <div class="section-title"><h2>Supervision Skill Model</h2><span class="hint">six competencies</span></div>
      <div class="area-grid">${ORDER.map((a) => areaCard(a, r.areas[a])).join("")}</div>

      ${ai ? aiSection(ai) : ""}

      <div class="footer-note">S3 (Verify) and S6 (Orchestrate) are computed from your git history exactly as the SIGCSE supervision-telemetry tool does. S1/S2/S4/S5 require an instructor LLM pass. AI-usage signals are evidence to discuss, not a grade.</div>
    `;
    document.getElementById("export").addEventListener("click", () => vscode.postMessage({ type: "export" }));
  }

  function areaCard(code, a) {
    const c = cls(a.score);
    return `<div class="area area--${c}">
      <div class="area__head">
        <div><div class="area__name">${esc(SSM[code].name)}</div><div class="area__code">${code} · ${esc(SSM[code].blurb)}</div></div>
        <span class="badge badge--${c}">${esc(LEVEL[a.score])}</span>
      </div>
      <div class="area__reason">${esc(a.reasoning)}</div>
    </div>`;
  }

  function aiSection(ai) {
    const signals = SIGNAL_ORDER.map((k) => {
      const s = (ai.signals && ai.signals[k]) || { score: 0 };
      const pips = [0, 1, 2].map((n) => `<span class="pip ${s.score > n ? "pip--on" : ""}"></span>`).join("");
      return `<div class="signal"><span class="signal__key" title="${esc(SIGNALS[k])}">${k.toUpperCase()}</span><span class="pips">${pips}</span></div>`;
    }).join("");
    return `
      <div class="section-title"><h2>AI-tool usage</h2><span class="hint">${Math.round(ai.weightedPct * 100)}% of weighted signal</span></div>
      <div class="ai-head">
        <span class="ai-level ai-level--${esc(ai.level)}">${esc(ai.level)} evidence</span>
        <span class="muted">Explicit: ${ai.explicitSignals.length ? esc(ai.explicitSignals.join(", ").toUpperCase()) : "none"} · Top behavioral: ${ai.topBehavioral.length ? esc(ai.topBehavioral.join(", ").toUpperCase()) : "none"}</span>
      </div>
      <div class="signal-grid">${signals}</div>`;
  }

  vscode.postMessage({ type: "ready" });
})();
