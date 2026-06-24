// @ts-nocheck
// Frontend for the AgentLens webview. Plain ES module-free JS so it
// runs under a strict CSP (nonce'd, no inline handlers). All scoring math of
// record lives in the extension's tested core; this file only renders and
// collects raw decisions.
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");

  // ---------- display metadata ----------
  const CONF = { low: 0.6, med: 0.75, high: 0.9 };
  const KIND_LABEL = { trust: "Calibrate trust", gate: "Safety gate", approve: "Approve plan" };
  const RISK = {
    safe: { label: "Safe", icon: "shield" },
    caution: { label: "Caution", icon: "alert" },
    danger: { label: "Danger", icon: "octagon" },
  };

  // ---------- icons (stroke, currentColor) ----------
  const P = {
    robot: '<rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M12 8V4M9 4h6"/><circle cx="9" cy="13" r="1.3"/><circle cx="15" cy="13" r="1.3"/>',
    user: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>',
    shield: '<path d="M12 3l7 3v6c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    alert: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    octagon: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M12 8v4M12 16h.01"/>',
    check: '<path d="M5 12l4 4 10-10"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/>',
    checklist: '<path d="M4 6h10M4 12h10M4 18h7"/><path d="M17 5l2 2 3-3"/>',
    beaker: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/><path d="M7.5 14h9"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>',
    badge: '<circle cx="12" cy="9" r="5"/><path d="M8.5 13.5L7 21l5-2.5L17 21l-1.5-7.5"/>',
    workflow: '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="12" r="2.4"/><path d="M8.4 6H13a3 3 0 0 1 3 3v0M8.4 18H13a3 3 0 0 0 3-3v0"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    star: '<path d="M12 3l2.6 5.6L21 9.3l-4.5 4.3L17.7 21 12 17.6 6.3 21l1.2-7.4L3 9.3l6.4-.7z"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    bolt: '<path d="M13 2L4 14h7l-2 8 9-12h-7z"/>',
  };
  function icon(name) {
    // width/height default to 1em so icons size to their text context; CSS rules
    // (e.g. .brand-mark svg) override where a fixed size is wanted. flex:none stops
    // flex parents from stretching them.
    return `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.125em;flex:none" aria-hidden="true">${P[name] || ""}</svg>`;
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pct(x) { return Math.round((x || 0) * 100); }
  function post(msg) { vscode.postMessage(msg); }

  // ---------- app state ----------
  let scenarios = [];
  let traces = [];
  let profile = null;
  let view = "home";
  let play = null;
  let explore = null;

  // ---------- inbound messages ----------
  window.addEventListener("message", (e) => {
    const msg = e.data;
    switch (msg.type) {
      case "init":
        scenarios = msg.scenarios || [];
        traces = msg.traces || [];
        profile = msg.profile;
        renderHome();
        if (msg.openScenarioId) openScenario(msg.openScenarioId);
        else if (msg.openTraceId) openTrace(msg.openTraceId);
        break;
      case "openScenario":
        openScenario(msg.id);
        break;
      case "openTrace":
        openTrace(msg.id);
        break;
      case "openTraceObject":
        addAndOpenTrace(msg.trace);
        break;
      case "scenarioComplete":
        profile = msg.profile;
        showDebrief(msg.scenarioId, msg.calibration);
        break;
      case "profile":
        profile = msg.profile;
        if (view === "home") renderHome();
        break;
    }
  });

  function scenarioById(id) { return scenarios.find((s) => s.id === id); }
  function isDone(id) { return profile && profile.completed && profile.completed.includes(id); }

  // ---------- top bar ----------
  function topbar() {
    let sub = "New here";
    if (profile && profile.totalDecisions > 0) {
      sub = `${pct(profile.accuracy)}% calibrated`;
      if (profile.overTrust > 0) sub += ` · ${profile.overTrust} over-trust`;
    }
    const rank = profile ? profile.rank : "Rookie";
    return `
    <div class="topbar">
      <div class="brand">
        <div class="brand-mark">${icon("eye")}</div>
        <div class="brand-text"><strong>AgentLens</strong><div>See what AI agents really do</div></div>
      </div>
      <div class="rank-chip">${icon("star")}<div><div class="rank-name">${esc(rank)}</div><div class="rank-sub">${esc(sub)}</div></div></div>
    </div>`;
  }

  // ---------- home ----------
  function renderHome() {
    view = "home";
    app.innerHTML = `
    ${topbar()}
    <div class="hero">
      <div class="hero-title">AI agents write the code now.<br/><span class="grad">This is your lens to see what they really do.</span></div>
      <div class="hero-sub">Coding agents plan, edit files, run commands, and report "done" on their own — but a lot happens under the hood. Open up a run step by step, spot the unsafe moves, and find out how well-calibrated your trust really is.</div>
    </div>

    <div class="section-title"><h2>Your trust calibration</h2><span class="hint">built from your calls</span></div>
    ${profileBlock()}

    <div class="section-title"><h2>${icon("eye")} Trace Explorer</h2><span class="hint">look under the hood · ${traces.length} runs</span></div>
    <div class="explorer-intro">Click through what an AI agent <em>actually did</em>, step by step. Open each step to see the hidden details, spot the safety flags, and decide: approve, replan, or block. Explore a sample run below, or <em>import a real run</em> from your own repo.</div>
    <div class="explorer-actions">
      <button class="btn btn--ghost" data-import>${icon("bolt")} Import a real SWE-agent run…</button>
      <button class="btn btn--ghost" data-sample>${icon("eye")} Try a sample real run</button>
    </div>
    <div class="scenario-grid">${traces.map(traceCard).join("")}</div>

    <div class="section-title"><h2>Trust scenarios</h2><span class="hint">quick · ${scenarios.length} available</span></div>
    <div class="scenario-grid">${scenarios.map(scenarioCard).join("")}</div>

    <div class="footer-note">Part of the AgentSafe project. Everything here is a safe simulation — the agent does not run real commands.</div>
    `;

    app.querySelectorAll("[data-open]").forEach((el) =>
      el.addEventListener("click", () => openScenario(el.getAttribute("data-open"))),
    );
    app.querySelectorAll("[data-trace]").forEach((el) =>
      el.addEventListener("click", () => openTrace(el.getAttribute("data-trace"))),
    );
    const imp = app.querySelector("[data-import]");
    if (imp) imp.addEventListener("click", () => post({ type: "importTrace" }));
    const smp = app.querySelector("[data-sample]");
    if (smp) smp.addEventListener("click", () => post({ type: "loadSample" }));
  }

  function traceCard(t) {
    const counts = { safe: 0, caution: 0, danger: 0 };
    for (const ev of t.events) counts[(ev.verdict && ev.verdict.level) || "safe"]++;
    const aud = t.audience === "general" ? "non-CS friendly" : t.audience === "cs" ? "CS" : "everyone";
    const dots =
      `<span class="rd rd--danger" title="${counts.danger} danger">${counts.danger}</span>` +
      `<span class="rd rd--caution" title="${counts.caution} caution">${counts.caution}</span>` +
      `<span class="rd rd--safe" title="${counts.safe} safe">${counts.safe}</span>`;
    return `<button class="scenario trace-card" data-trace="${esc(t.id)}">
      <div class="scenario__title">${esc(t.title)}</div>
      <div class="scenario__tag">${esc(t.tagline || "")}</div>
      <div class="badges"><span class="badge">${esc(aud)}</span><span class="badge">${t.events.length} steps</span></div>
      <div class="scenario__meta"><span class="risk-dots">${dots}</span><span>${esc(t.domain)}</span></div>
    </button>`;
  }

  function profileBlock() {
    const p = profile || { accuracy: 0, totalDecisions: 0, overTrust: 0, brier: null };
    const calScore = p.brier == null ? "—" : pct(1 - p.brier);
    let pill = "";
    if (p.totalDecisions === 0) {
      pill = `<span class="muted">Make a few calls to start building your calibration.</span>`;
    } else if (p.overTrust > 0) {
      pill = `<span class="warn-pill">${icon("alert")} ${p.overTrust} over-trust ${p.overTrust === 1 ? "moment" : "moments"}</span>`;
    } else {
      pill = `<span class="ok-pill">${icon("check")} no over-trust yet</span>`;
    }
    return `
      <div class="calib-summary">
        <div class="stat"><div class="stat__num">${pct(p.accuracy)}%</div><div class="stat__label">Correct calls</div></div>
        <div class="stat"><div class="stat__num">${calScore}</div><div class="stat__label">Calibration</div></div>
        <div class="calib-meter">
          <div class="meter-head"><span>Trust calibration</span><span>${p.totalDecisions} decision${p.totalDecisions === 1 ? "" : "s"}</span></div>
          <div class="meter"><div class="meter__fill" style="width:${pct(p.accuracy)}%"></div></div>
          <div style="margin-top:10px">${pill}</div>
        </div>
      </div>`;
  }

  function scenarioCard(s) {
    const badges = (s.focus || []).map((a) => `<span class="badge">${esc(a)}</span>`).join("");
    const done = isDone(s.id) ? `<div class="done-check">${icon("check")}</div>` : "";
    return `<button class="scenario" data-open="${esc(s.id)}">
      ${done}
      <div class="scenario__title">${esc(s.title)}</div>
      <div class="scenario__tag">${esc(s.tagline)}</div>
      <div class="badges">${badges}</div>
      <div class="scenario__meta">
        <span class="chip difficulty--${esc(s.difficulty)}">${esc(s.difficulty)}</span>
        <span>${esc(s.domain)}</span><span>· ~${esc(s.estMinutes)} min</span>
      </div>
    </button>`;
  }

  // ---------- player ----------
  function openScenario(id) {
    const scenario = scenarioById(id);
    if (!scenario) return;
    view = "player";
    play = { scenario, idx: -1, records: [], correct: 0, total: 0, overTrust: 0, overCaution: 0, conf: "med" };

    app.innerHTML = `
    ${topbar()}
    <div class="player-head">
      <button class="back-btn" id="backBtn">${icon("back")} All scenarios</button>
      <div class="player-title">${esc(scenario.title)}</div>
      <div class="task-line">You asked the agent: <b>${esc(scenario.task)}</b></div>
    </div>
    <div class="hud">
      <span class="hud-stat">Step <b id="hudStep">0</b>/${scenario.steps.length}</span>
      <div class="progressbar"><div class="progressbar__fill" id="hudProg"></div></div>
      <span class="hud-stat">Correct calls: <b id="hudCalls">0/0</b></span>
    </div>
    <div class="feed" id="feed"></div>`;

    app.querySelector("#backBtn").addEventListener("click", renderHome);
    nextStep();
  }

  function updateHud() {
    const s = play.scenario;
    const stepNo = Math.min(play.idx + 1, s.steps.length);
    const set = (id, v) => { const el = app.querySelector(id); if (el) el.textContent = v; };
    set("#hudStep", stepNo);
    set("#hudCalls", `${play.correct}/${play.total}`);
    const prog = app.querySelector("#hudProg");
    if (prog) prog.style.width = `${(stepNo / s.steps.length) * 100}%`;
  }

  function nextStep() {
    play.idx++;
    updateHud();
    if (play.idx >= play.scenario.steps.length) { finishScenario(); return; }
    playStep(play.scenario.steps[play.idx]);
  }

  function feedAppend(html) {
    const wrap = document.createElement("div");
    wrap.className = "feed-item";
    wrap.innerHTML = html;
    app.querySelector("#feed").appendChild(wrap);
    wrap.scrollIntoView({ behavior: "smooth", block: "end" });
    return wrap;
  }

  function agentMessageHtml(step) {
    const isYou = /^you\b/i.test(step.agentSays.trim());
    const who = isYou ? "You" : esc(play.scenario.agent);
    const avatar = isYou ? `<div class="avatar avatar--you">${icon("user")}</div>` : `<div class="avatar avatar--agent">${icon("robot")}</div>`;
    const tool = step.tool ? `<div class="msg-tool">${icon("bolt")} ${esc(step.tool)}${step.command ? " · " + esc(step.command) : ""}</div>` : "";
    return `<div class="msg">
      ${avatar}
      <div class="msg-body">
        <div class="msg-who">${who}</div>
        <div class="msg-text">${esc(step.agentSays)}${tool}</div>
        ${step.code ? codeHtml(step.code) : ""}
      </div>
    </div>`;
  }

  function codeHtml(code) {
    let lines;
    if (code.diff) {
      lines = code.diff.split("\n").map((l) => {
        const cls = l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "";
        return `<span class="ln ${cls}">${esc(l) || "&nbsp;"}</span>`;
      }).join("");
    } else {
      lines = (code.text || "").split("\n").map((l) => `<span class="ln">${esc(l) || "&nbsp;"}</span>`).join("");
    }
    return `<div class="code"><div class="code__name">${esc(code.filename)}</div><pre class="code__body">${lines}</pre></div>`;
  }

  function revealHtml(step) {
    const r = RISK[step.risk];
    return `<div class="reveal reveal--${step.risk}">
      <span class="risk-chip risk-chip--${step.risk}">${icon(r.icon)} ${r.label}</span>
      <div class="reveal__what">What actually happened: ${esc(step.whatHappened)}</div>
      <div class="reveal__explain">${esc(step.explain)}</div>
    </div>`;
  }

  function continueHtml(last) {
    return `<button class="continue-btn" data-continue>${last ? "See your results" : "Continue"} ${icon("chevron")}</button>`;
  }

  function playStep(step) {
    const last = play.idx === play.scenario.steps.length - 1;
    const item = feedAppend(agentMessageHtml(step));

    if (step.decision) {
      item.insertAdjacentHTML("beforeend", decisionHtml(step));
      wireDecision(item, step, last);
    } else {
      item.insertAdjacentHTML("beforeend", revealHtml(step) + continueHtml(last));
      item.querySelector("[data-continue]").addEventListener("click", (ev) => {
        ev.currentTarget.disabled = true;
        nextStep();
      });
    }
  }

  function decisionHtml(step) {
    const d = step.decision;
    const conf = d.kind === "trust" && d.askConfidence ? confidenceHtml() : "";
    const opts = d.options.map((o) =>
      `<button class="option" data-opt="${esc(o.id)}">
        <span class="option__label">${esc(o.label)}</span>
        <span class="option__mark"></span>
        <div class="option__fb">${esc(o.feedback)}</div>
      </button>`,
    ).join("");
    return `<div class="decision">
      <div class="decision__head"><span class="decision__kind">${esc(KIND_LABEL[d.kind])}</span></div>
      <div class="decision__prompt">${esc(d.prompt)}</div>
      ${conf}
      <div class="options">${opts}</div>
    </div>`;
  }

  function confidenceHtml() {
    const b = (k, label) => `<button class="conf-btn ${k === "med" ? "conf-btn--active" : ""}" data-conf="${k}">${label}</button>`;
    return `<div class="confidence">
      <div class="conf-label">How sure are you?</div>
      <div class="conf-btns">${b("low", "Not sure")}${b("med", "Fairly sure")}${b("high", "Very sure")}</div>
    </div>`;
  }

  function wireDecision(item, step, last) {
    play.conf = "med";
    item.querySelectorAll("[data-conf]").forEach((btn) =>
      btn.addEventListener("click", () => {
        play.conf = btn.getAttribute("data-conf");
        item.querySelectorAll("[data-conf]").forEach((b) => b.classList.remove("conf-btn--active"));
        btn.classList.add("conf-btn--active");
      }),
    );
    item.querySelectorAll("[data-opt]").forEach((btn) =>
      btn.addEventListener("click", () => chooseOption(item, step, btn.getAttribute("data-opt"), last)),
    );
  }

  function chooseOption(item, step, optId, last) {
    const d = step.decision;
    const opt = d.options.find((o) => o.id === optId);
    const correct = optId === d.correct;

    const rec = {
      scenarioId: play.scenario.id,
      stepId: step.id,
      kind: d.kind,
      chosenOptionId: optId,
      chosenOutcome: opt.outcome,
      correct,
    };
    if (d.kind === "trust") {
      rec.predictedSafe = !!opt.predictsSafe;
      rec.actualSafe = !!d.actualSafe;
      rec.confidence = CONF[play.conf] || 0.75;
      if (rec.predictedSafe && !rec.actualSafe) play.overTrust++;
      if (!rec.predictedSafe && rec.actualSafe) play.overCaution++;
    }
    play.records.push(rec);
    play.total++;
    if (correct) play.correct++;
    updateHud();

    // Lock the controls and reveal verdicts on the options.
    item.querySelectorAll("[data-conf]").forEach((b) => (b.disabled = true));
    item.querySelectorAll("[data-opt]").forEach((btn) => {
      btn.disabled = true;
      const id = btn.getAttribute("data-opt");
      const mark = btn.querySelector(".option__mark");
      if (id === optId) {
        btn.classList.add("option--revealed", correct ? "option--correct" : "option--wrong");
        mark.textContent = correct ? "✓ your call" : "✗ your call";
      } else if (id === d.correct) {
        btn.classList.add("option--revealed", "option--correct");
        mark.textContent = "✓ best call";
      } else {
        btn.classList.add("option--dim");
      }
    });

    item.insertAdjacentHTML("beforeend", revealHtml(step) + continueHtml(last));
    const cont = item.querySelector("[data-continue]");
    cont.addEventListener("click", (ev) => { ev.currentTarget.disabled = true; nextStep(); });
    cont.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  function finishScenario() {
    post({ type: "completeScenario", scenarioId: play.scenario.id, records: play.records });
  }

  // ---------- debrief ----------
  function showDebrief(scenarioId, cal) {
    view = "debrief";
    const s = scenarioById(scenarioId) || play.scenario;
    const calScore = cal.brier == null ? "—" : pct(1 - cal.brier);

    let callout;
    if (cal.overTrust > 0) {
      callout = `<div class="callout callout--danger">${icon("alert")} <b>You over-trusted ${cal.overTrust} time${cal.overTrust === 1 ? "" : "s"}.</b> You judged the agent safe when it wasn't — the costly direction. In real systems this is how silent failures ship. Lean toward verifying when the stakes are irreversible.</div>`;
    } else if (cal.overCaution > 0) {
      callout = `<div class="callout callout--safe">${icon("eye")} <b>Well caught — no over-trust.</b> You were cautious ${cal.overCaution} time${cal.overCaution === 1 ? "" : "s"} when the agent was actually fine. Catching danger matters more, but watch you don't redo good work — that wastes the agent.</div>`;
    } else if (cal.decisions > 0) {
      callout = `<div class="callout callout--safe">${icon("check")} <b>Calibrated.</b> You trusted when it was warranted and stopped when it wasn't. That balance is the whole skill.</div>`;
    } else {
      callout = "";
    }

    const lessons = s.debrief.lessons.map((l) => `<li><span class="tick">${icon("check")}</span><span>${esc(l)}</span></li>`).join("");
    const realworld = s.debrief.realWorld
      ? `<div class="realworld"><span class="rw-label">From the real world</span>${esc(s.debrief.realWorld)}</div>`
      : "";

    const next = scenarios.find((x) => x.id !== s.id && !isDone(x.id)) || scenarios.find((x) => x.id !== s.id);

    app.innerHTML = `
    ${topbar()}
    <div class="debrief">
      <div class="debrief__head">
        <div class="debrief__badge">${icon("badge")}</div>
        <div><div class="muted">Scenario complete</div><h2>${esc(s.title)}</h2></div>
      </div>

      <div class="result-cards">
        <div class="result-card"><div class="rc-num">${pct(cal.accuracy)}%</div><div class="rc-label">Correct calls (${cal.correct}/${cal.decisions})</div></div>
        <div class="result-card ${cal.overTrust > 0 ? "result-card--warn" : "result-card--good"}"><div class="rc-num">${cal.overTrust}</div><div class="rc-label">Over-trust moments</div></div>
        <div class="result-card"><div class="rc-num">${calScore}</div><div class="rc-label">Calibration score</div></div>
      </div>

      ${callout}

      <div class="section-title"><h2>What you learned</h2></div>
      <p class="muted" style="margin-top:0">${esc(s.debrief.summary)}</p>
      <ul class="lessons">${lessons}</ul>
      ${realworld}

      <div class="section-title"><h2>Your profile now</h2><span class="hint">${esc(profile.rank)}</span></div>
      ${profileBlock()}

      <div class="actions">
        ${next ? `<button class="btn" id="nextBtn">Next: ${esc(next.title)} ${icon("chevron")}</button>` : ""}
        <button class="btn btn--ghost" id="homeBtn">All scenarios</button>
        <button class="btn btn--ghost" id="replayBtn">Replay this one</button>
      </div>
    </div>`;

    app.querySelector("#homeBtn").addEventListener("click", renderHome);
    app.querySelector("#replayBtn").addEventListener("click", () => openScenario(s.id));
    if (next) app.querySelector("#nextBtn").addEventListener("click", () => openScenario(next.id));
  }

  // ---------- trace explorer ----------
  const ACTOR_ICON = { agent: "robot", human: "user", system: "bolt" };
  const KIND_LABEL_TRACE = {
    prompt: "You ask", plan: "Plan", approval: "Approval", edit: "Edit", command: "Command",
    test: "Test", claim: "Claim", commit: "Commit", deploy: "Deploy", network: "Network", note: "Note",
  };
  const ACTION_META = {
    approve: { label: "Approve", icon: "check" },
    replan: { label: "Send back / replan", icon: "back" },
    block: { label: "Block", icon: "octagon" },
    undo: { label: "Undo", icon: "back" },
    verify: { label: "Verify it myself", icon: "eye" },
    stepIn: { label: "Step in / take over", icon: "bolt" },
  };

  function traceById(id) { return traces.find((t) => t.id === id); }

  function addAndOpenTrace(trace) {
    if (!trace || !trace.id) return;
    const i = traces.findIndex((t) => t.id === trace.id);
    if (i >= 0) traces[i] = trace;
    else traces.push(trace);
    openTrace(trace.id);
  }

  function openTrace(id) {
    const trace = traceById(id);
    if (!trace) return;
    view = "explore";
    explore = {
      trace, done: false, opened: new Set(), acted: new Set(),
      caughtDanger: 0, missedDanger: 0,
      totalDanger: trace.events.filter((e) => e.verdict && e.verdict.level === "danger").length,
    };
    app.innerHTML = `
    ${topbar()}
    <div class="player-head">
      <button class="back-btn" id="backToHome">${icon("back")} All traces</button>
      <div class="player-title">${esc(trace.title)}</div>
      <div class="task-line">The agent was asked: <b>${esc(trace.task)}</b> <span class="muted">· ${esc(trace.agent)} · ${esc(trace.domain)}</span></div>
    </div>
    ${chainHtml(trace)}
    <div class="xray-hint">${icon("eye")} Tap any step to open it up and see what <em>really</em> happened underneath — then decide what to do.</div>
    <div class="trace" id="trace"></div>
    <div id="trace-end"></div>`;
    app.querySelector("#backToHome").addEventListener("click", renderHome);
    const host = app.querySelector("#trace");
    trace.events.forEach((ev, i) => host.appendChild(renderNode(ev, i, trace.events.length)));
    wireChain();
  }

  // Summary chain: a row of numbered circular step nodes, colored by verdict.
  function chainHtml(trace) {
    const nodes = trace.events
      .map((ev, i) => {
        const lvl = (ev.verdict && ev.verdict.level) || "safe";
        const link = i < trace.events.length - 1 ? '<span class="chain__link"></span>' : "";
        return `<button class="chain__node chain__node--${lvl}" data-jump="${i}" title="${esc(i + 1 + ". " + ev.title)}">${i + 1}</button>${link}`;
      })
      .join("");
    return `<div class="chain-wrap">
      <div class="chain-label">The run at a glance — ${trace.events.length} steps</div>
      <div class="chain" id="chain">${nodes}</div>
      <div class="chain-legend"><span class="cl cl--safe">safe</span><span class="cl cl--caution">caution</span><span class="cl cl--danger">danger</span></div>
    </div>`;
  }

  function wireChain() {
    app.querySelectorAll("#chain [data-jump]").forEach((b) =>
      b.addEventListener("click", () => {
        const i = Number(b.getAttribute("data-jump"));
        app.querySelectorAll("#chain .chain__node").forEach((n) => n.classList.remove("chain__node--active"));
        b.classList.add("chain__node--active");
        const target = app.querySelectorAll(".tnode")[i];
        if (!target) return;
        const xb = target.querySelector(".xray-btn");
        if (xb) xb.click();
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.remove("tnode--flash");
        void target.offsetWidth;
        target.classList.add("tnode--flash");
      }),
    );
  }

  function renderNode(ev, idx, total) {
    const node = document.createElement("div");
    node.className = "tnode";
    const actor = ev.actor === "human" ? "you" : ev.actor;
    node.innerHTML = `
      <div class="tnode__rail"><div class="tnode__dot"></div>${idx < total - 1 ? '<div class="tnode__line"></div>' : ""}</div>
      <div class="tnode__card">
        <div class="tnode__head">
          <span class="tnode__avatar tnode__avatar--${actor}">${icon(ACTOR_ICON[ev.actor] || "robot")}</span>
          <span class="tnode__kind">${esc(KIND_LABEL_TRACE[ev.kind] || ev.kind)}</span>
          <span class="tnode__title">${esc(ev.title)}</span>
        </div>
        ${ev.text ? `<div class="tnode__says">${esc(ev.text)}</div>` : ""}
        ${ev.tool || ev.command ? `<div class="msg-tool">${icon("bolt")} ${esc(ev.tool || "")}${ev.command ? " · " + esc(ev.command) : ""}</div>` : ""}
        <button class="xray-btn" data-xray>${icon("eye")} Look under the hood</button>
        <div class="xray" hidden></div>
      </div>`;
    const btn = node.querySelector("[data-xray]");
    const xray = node.querySelector(".xray");
    btn.addEventListener("click", () => revealNode(ev, node, xray, btn));
    return node;
  }

  function revealNode(ev, node, xray, btn) {
    if (explore.opened.has(ev.id)) return;
    explore.opened.add(ev.id);
    btn.remove();
    const v = ev.verdict || { level: "safe", rationale: "No safety concern detected in this step." };
    const r = RISK[v.level];
    node.classList.add("tnode--" + v.level);
    xray.hidden = false;
    xray.innerHTML = `
      ${ev.code ? codeHtml(ev.code) : ""}
      ${ev.hidden ? `<div class="xray__hidden"><span class="xray__label">${icon("eye")} Under the hood</span><span>${esc(ev.hidden)}</span></div>` : ""}
      ${ev.stateChange ? `<div class="xray__state"><b>What actually changed:</b> ${esc(ev.stateChange)}</div>` : ""}
      <div class="reveal reveal--${v.level}" style="margin-top:10px">
        <span class="risk-chip risk-chip--${v.level}">${icon(r.icon)} ${r.label}${v.severity ? " · " + esc(v.severity) : ""}</span>
        <div class="reveal__explain" style="margin-top:8px">${esc(v.rationale)}</div>
      </div>
      ${ev.actions && ev.actions.length ? actionRow(ev) : ""}`;
    xray.querySelectorAll("[data-action]").forEach((b) =>
      b.addEventListener("click", () => onAction(ev, b.getAttribute("data-action"), xray)),
    );
    xray.scrollIntoView({ behavior: "smooth", block: "nearest" });
    maybeFinish();
  }

  function actionRow(ev) {
    const btns = ev.actions
      .map((a) => {
        const m = ACTION_META[a] || { label: a, icon: "chevron" };
        return `<button class="taction" data-action="${esc(a)}">${icon(m.icon)} ${esc(m.label)}</button>`;
      })
      .join("");
    return `<div class="taction-row"><div class="taction-q">Your call:</div><div class="taction-btns">${btns}</div><div class="taction-fb" hidden></div></div>`;
  }

  function onAction(ev, action, xray) {
    if (explore.acted.has(ev.id)) return;
    explore.acted.add(ev.id);
    const level = (ev.verdict && ev.verdict.level) || "safe";
    const guardful = ["block", "replan", "undo", "verify", "stepIn"].includes(action);
    let msg, cls;
    if (level === "danger") {
      if (guardful) { msg = "Good catch — you stopped a dangerous step before it could do harm."; cls = "good"; explore.caughtDanger++; }
      else { msg = "That step was dangerous. Approving it is exactly the over-trust this trains you to avoid."; cls = "bad"; explore.missedDanger++; }
    } else if (level === "caution") {
      msg = guardful ? "Reasonable — pausing on a borderline step is sensible." : "Okay, but this one deserved a second look before approving.";
      cls = guardful ? "good" : "warn";
    } else {
      if (action === "approve" || action === "verify") { msg = "Right call — this step was fine. Trusting after a glance is good calibration."; cls = "good"; }
      else { msg = "This step was actually safe — blocking everything wastes the agent. Calibration cuts both ways."; cls = "warn"; }
    }
    xray.querySelectorAll(".taction").forEach((b) => {
      b.disabled = true;
      if (b.getAttribute("data-action") === action) b.classList.add("taction--chosen");
    });
    const fb = xray.querySelector(".taction-fb");
    fb.hidden = false;
    fb.className = "taction-fb taction-fb--" + cls;
    fb.textContent = msg;
    maybeFinish();
  }

  function maybeFinish() {
    const t = explore.trace;
    const allOpened = t.events.every((e) => explore.opened.has(e.id));
    const actionable = t.events.filter((e) => e.actions && e.actions.length);
    const allActed = actionable.every((e) => explore.acted.has(e.id));
    if (allOpened && allActed && !explore.done) {
      explore.done = true;
      renderTraceSummary();
    }
  }

  function renderTraceSummary() {
    const t = explore.trace;
    const caught = explore.caughtDanger;
    const total = explore.totalDanger;
    let line;
    if (total === 0) line = "No dangerous steps here — and you opened every one. That's the calibrated baseline: don't go looking for villains that aren't there.";
    else if (caught >= total) line = `You caught all ${total} dangerous step${total === 1 ? "" : "s"}. That's the whole game.`;
    else line = `You caught ${caught} of ${total} dangerous steps. The ones you approved are exactly where real incidents come from.`;
    const good = total === 0 || caught >= total;
    const end = app.querySelector("#trace-end");
    end.innerHTML = `
      <div class="debrief" style="margin-top:20px">
        <div class="section-title"><h2>What you saw under the hood</h2></div>
        <div class="callout callout--${good ? "safe" : "danger"}">${icon(good ? "check" : "alert")} ${esc(line)}</div>
        <p class="muted">${esc(t.summary || "")}</p>
        <div class="actions">
          <button class="btn btn--ghost" id="exitTrace">All traces</button>
          <button class="btn btn--ghost" id="replayTrace">Explore again</button>
        </div>
      </div>`;
    app.querySelector("#exitTrace").addEventListener("click", renderHome);
    app.querySelector("#replayTrace").addEventListener("click", () => openTrace(t.id));
    end.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  // ---------- boot ----------
  post({ type: "ready" });
})();
