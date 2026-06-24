// Agentic-SE Coach — static SPA. Reads ./data/index.json + ./data/projects/*.json,
// renders a git-like, multi-committer supervision review. Vanilla JS, hand-drawn SVG.
"use strict";
(function () {
  const app = document.getElementById("app");
  const crumbsEl = document.getElementById("crumbs");
  const LEVELS = { "-1": "pending", 0: "Absent", 1: "Developing", 2: "Proficient", 3: "Exemplary" };
  const AXES = ["S1", "S2", "S3", "S4", "S5", "S6"];
  const AXIS_NAME = { S1: "Direct", S2: "Approve", S3: "Verify", S4: "Critique", S5: "Own", S6: "Orchestrate" };

  let manifest = null;
  const projects = new Map();

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const hp = (s) => encodeURIComponent(String(s)); // URL-encode a hash path segment (sids contain '@')
  const pct = (x) => Math.round((x || 0) * 100);
  const lvlClass = (v) => `lvl-${v}`;
  // Compact, guarded score chip for dense table cells (handles the -1 pending
  // sentinel and any out-of-range value without emitting an unstyled dot class).
  const dotCell = (v) => {
    const ok = v >= 0 && v <= 3;
    return `<span class="chip"><span class="dot ${ok ? "dot-" + v : "dot--1"}"></span>${ok ? v : "—"}</span>`;
  };

  async function fetchJson(url, notFoundLabel) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${notFoundLabel} (HTTP ${r.status})`);
    return r.json();
  }
  async function getManifest() {
    if (!manifest) manifest = await fetchJson("./data/index.json", "Could not load project index");
    return manifest;
  }
  async function getProject(id) {
    if (!projects.has(id)) projects.set(id, await fetchJson(`./data/projects/${id}.json`, "Project not found"));
    return projects.get(id);
  }

  // review state (localStorage, keyed by sid). Guarded: localStorage throws a
  // SecurityError in private mode / sandboxed iframes — fall back to an in-memory
  // map so the snapshot view still renders and the buttons still reflect choices.
  const memReview = new Map();
  const reviewKey = (sid) => `coach-review:${sid}`;
  const getReview = (sid) => {
    try { return localStorage.getItem(reviewKey(sid)) || memReview.get(sid) || "unreviewed"; }
    catch { return memReview.get(sid) || "unreviewed"; }
  };
  const setReview = (sid, v) => {
    if (v === "unreviewed") memReview.delete(sid); else memReview.set(sid, v);
    try { v === "unreviewed" ? localStorage.removeItem(reviewKey(sid)) : localStorage.setItem(reviewKey(sid), v); }
    catch { /* persistence unavailable — in-memory only for this session */ }
  };

  // ---------- SVG: score chip / dot ----------
  function scoreChip(axis, v, source) {
    const pend = v < 0 || source === "pending";
    return `<span class="chip"><span class="dot ${pend ? "dot--1" : "dot-" + v}"></span><span class="sx ${pend ? "lvl--1" : lvlClass(v)}">${axis}</span> ${pend ? "pending" : LEVELS[v]}</span>`;
  }

  // ---------- SVG: trajectory (S3 vs S6 over weeks) ----------
  function trajectory(project) {
    const cps = (project.checkpoints || []);
    if (!cps.length) return "<div class='muted'>No checkpoints.</div>";
    const W = 960, H = 240, padL = 38, padR = 16, padT = 16, padB = 28;
    const weeks = cps.map((c) => c.week);
    const wMin = Math.min(...weeks), wMax = Math.max(...weeks);
    const x = (w) => padL + ((w - wMin) / Math.max(1, wMax - wMin)) * (W - padL - padR);
    const y = (s) => padT + (1 - Math.max(0, Math.min(3, s)) / 3) * (H - padT - padB); // clamp to plot
    // Skip pending (-1) scores — a -1 would plot off the bottom of the chart and
    // corrupt both the lines and the gap fill (S1/S2/S4/S5 use -1; S3/S6 may too).
    const ptsFor = (axis) => cps.filter((c) => c.ssm.scores[axis] >= 0).map((c) => ({ w: c.week, s: c.ssm.scores[axis], c }));
    const s3 = ptsFor("S3"), s6 = ptsFor("S6");
    const line = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.w).toFixed(1)},${y(p.s).toFixed(1)}`).join(" ");
    // Complacency band: fill ONLY where S6 > S3, splitting each segment at the
    // crossing so we never shade the (good) S3-above-S6 region or draw a bowtie.
    const both = cps.filter((c) => c.ssm.scores.S3 >= 0 && c.ssm.scores.S6 >= 0)
      .map((c) => ({ w: c.week, s6: c.ssm.scores.S6, s3: c.ssm.scores.S3 }));
    let gap = "";
    for (let i = 0; i < both.length - 1; i++) {
      const p = both[i], q = both[i + 1];
      const d0 = p.s6 - p.s3, d1 = q.s6 - q.s3;        // S6−S3 at the two weeks
      if (d0 <= 0 && d1 <= 0) continue;                 // S3 ≥ S6 throughout → no gap
      let t0 = 0, t1 = 1;
      if (d0 < 0) t0 = d0 / (d0 - d1);                  // enter where the curves cross
      if (d1 < 0) t1 = d0 / (d0 - d1);                  // exit where they cross
      const lerp = (a, b, t) => a + (b - a) * t;
      const xa = x(lerp(p.w, q.w, t0)), xb = x(lerp(p.w, q.w, t1));
      gap += `M${xa.toFixed(1)},${y(lerp(p.s6, q.s6, t0)).toFixed(1)} L${xb.toFixed(1)},${y(lerp(p.s6, q.s6, t1)).toFixed(1)} `
        + `L${xb.toFixed(1)},${y(lerp(p.s3, q.s3, t1)).toFixed(1)} L${xa.toFixed(1)},${y(lerp(p.s3, q.s3, t0)).toFixed(1)} Z `;
    }
    const gridY = [0, 1, 2, 3].map((s) => `<line x1="${padL}" y1="${y(s)}" x2="${W - padR}" y2="${y(s)}" stroke="var(--border)" stroke-width="1"/><text x="6" y="${y(s) + 4}" fill="var(--muted)" font-size="11">${s}</text>`).join("");
    const xticks = cps.map((c) => `<text x="${x(c.week)}" y="${H - 8}" fill="var(--muted)" font-size="10" text-anchor="middle">${c.week}</text>`).join("");
    const dots = (pts, color) => pts.map((p) => {
      const flagged = p.c.drift && p.c.drift.flag;
      const sc = p.c.ssm.scores;
      const label = sc.S3 >= 0 && sc.S6 >= 0 ? `S3 ${sc.S3} · S6 ${sc.S6}` : "";
      return `<circle class="wk-dot" data-sid="${esc(p.c.sid)}" cx="${x(p.w).toFixed(1)}" cy="${y(p.s).toFixed(1)}" r="${flagged ? 5 : 3.5}" fill="${color}" ${flagged ? 'stroke="var(--danger)" stroke-width="2"' : ""}><title>Week ${p.w}: ${label}${flagged ? " · COMPLACENCY" : ""}</title></circle>`;
    }).join("");
    return `<div class="legend"><span><i style="background:var(--l3)"></i>S3 Verify</span><span><i style="background:var(--l2)"></i>S6 Orchestrate</span><span><i style="background:color-mix(in srgb,var(--danger) 30%,transparent)"></i>complacency gap</span><span class="muted">· click a week to review its snapshot</span></div>
    <div class="traj"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${gridY}
      ${gap ? `<path d="${gap}" fill="color-mix(in srgb,var(--danger) 14%,transparent)"/>` : ""}
      <path d="${line(s6)}" fill="none" stroke="var(--l2)" stroke-width="2.5"/>
      <path d="${line(s3)}" fill="none" stroke="var(--l3)" stroke-width="2.5"/>
      ${dots(s6, "var(--l2)")}${dots(s3, "var(--l3)")}
      ${xticks}
    </svg></div>`;
  }

  // ---------- SVG: radar (6 axes; S3/S6 live, others pending) ----------
  function radar(scores, source) {
    const cx = 120, cy = 120, R = 88;
    const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / 6;
    const pt = (i, frac) => [cx + Math.cos(ang(i)) * R * frac, cy + Math.sin(ang(i)) * R * frac];
    let rings = "";
    for (const f of [1 / 3, 2 / 3, 1]) {
      const poly = AXES.map((_, i) => pt(i, f).map((n) => n.toFixed(1)).join(",")).join(" ");
      rings += `<polygon points="${poly}" fill="none" stroke="var(--border)" stroke-width="1"/>`;
    }
    let spokes = "", labels = "", livePts = [];
    AXES.forEach((ax, i) => {
      const v = scores[ax];
      const pending = source[ax] === "pending" || v < 0;
      const [ex, ey] = pt(i, 1.18);
      spokes += `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0].toFixed(1)}" y2="${pt(i, 1)[1].toFixed(1)}" stroke="var(--border${pending ? "" : "-strong"})" stroke-width="1" ${pending ? 'stroke-dasharray="3 3"' : ""}/>`;
      labels += `<text x="${ex.toFixed(1)}" y="${ey.toFixed(1)}" fill="${pending ? "var(--na)" : "var(--fg)"}" font-size="10.5" text-anchor="middle" dominant-baseline="middle">${ax}${pending ? " ·" : ""}</text>`;
      if (!pending) {
        const [px, py] = pt(i, v / 3);
        livePts.push([px, py, v, i]);
      }
    });
    const liveDots = livePts.map(([px, py, v]) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="var(--l${v})"/>`).join("");
    return `<div class="radar"><svg viewBox="0 0 240 240">${rings}${spokes}${liveDots}${labels}
      <text x="${cx}" y="${cy + 4}" fill="var(--muted)" font-size="9" text-anchor="middle">·=pending</text></svg></div>`;
  }

  // ---------- SVG: contribution share bar ----------
  const PALETTE = ["#6d6dfb", "#28c4bd", "#e0a623", "#f85149", "#3fb950", "#b48ead", "#56b6c2", "#d19a66", "#98c379"];
  function shareBar(committers) {
    const segs = committers.map((c, i) => `<div class="share-seg" style="width:${pct(c.commitShare)}%;background:${PALETTE[i % PALETTE.length]}" title="${esc(c.alias)}: ${pct(c.commitShare)}%"></div>`).join("");
    return `<div class="share-bar">${segs}</div>`;
  }

  // ---------- crumbs ----------
  function setCrumbs(parts) {
    crumbsEl.innerHTML = parts.map((p, i) => (i ? '<span class="sep">›</span>' : "") + (p.href ? `<a href="${p.href}">${esc(p.label)}</a>` : `<span>${esc(p.label)}</span>`)).join(" ");
  }

  // ---------- views ----------
  async function renderHome() {
    const m = await getManifest();
    setCrumbs([{ label: "Projects" }]);
    let sort = "drift";
    const draw = () => {
      const ps = [...m.projects].sort((a, b) => {
        if (sort === "gini") return b.giniCommitShare - a.giniCommitShare;
        if (sort === "drift") return (b.latest?.driftMax ?? 0) - (a.latest?.driftMax ?? 0) || (b.latest?.flags?.length ?? 0) - (a.latest?.flags?.length ?? 0);
        return a.id.localeCompare(b.id);
      });
      const cards = ps.map((p) => {
        const l = p.latest || {};
        const flag = (l.flags || []).includes("AUTOMATION_COMPLACENCY") ? `<span class="flag flag--complacency">complacency</span>` : "";
        const ssm = l.ssm || {};
        const chips = ["S3", "S6"].map((a) => scoreChip(a, ssm[a] ?? -1, "git")).join("");
        return `<a class="card" href="#/p/${hp(p.id)}">
          <div class="card__head"><span class="card__title">${esc(p.alias)}</span>${flag}</div>
          <div class="card__meta">${p.committers} committers · ${p.commits} commits · ${p.weeksActive} wks · AI ${esc(l.aiLevel || "—")}</div>
          <div class="chips">${chips}<span class="chip muted">peak gap ${l.driftMax ?? 0}</span></div>
          <div class="gini"><span>contribution balance</span><div class="gini-track"><div class="gini-fill" style="width:${pct(p.giniCommitShare)}%"></div></div><span>gini ${p.giniCommitShare.toFixed(2)}</span></div>
        </a>`;
      }).join("");
      app.innerHTML = `
        <div class="page-head"><div><h1>Team projects</h1><div class="sub">${m.projects.length} projects · term ${m.term.id} · S3 + S6 live, S1/S2/S4/S5 pending</div></div>
          <div class="toolbar"><label>sort</label><select id="sort">
            <option value="drift">needs review (peak S6−S3 gap)</option>
            <option value="gini">contribution imbalance</option>
            <option value="id">project id</option>
          </select></div></div>
        <div class="grid">${cards}</div>`;
      const sel = document.getElementById("sort");
      sel.value = sort;
      sel.addEventListener("change", () => { sort = sel.value; draw(); });
    };
    draw();
  }

  async function renderProject(id) {
    const p = await getProject(id);
    const cps = p.checkpoints || [], committers = p.committers || [];
    setCrumbs([{ label: "Projects", href: "#/" }, { label: p.alias }]);
    const flagged = cps.filter((c) => c.drift && c.drift.flag).length;
    const banner = flagged
      ? `<div class="callout callout--danger"><b>Automation-complacency detected</b> in ${flagged} week${flagged === 1 ? "" : "s"} — workflow (S6) ran ahead of verification (S3). The trajectory below shows when the gap opened.</div>`
      : "";
    app.innerHTML = `
      <div class="page-head"><div><h1>${esc(p.alias)}</h1><div class="sub">${committers.length} committers · ${cps.length} weekly checkpoints · branch <code>${esc(p.defaultBranch)}</code></div></div>
        <div class="toolbar"><a class="btn" href="#/p/${hp(id)}/team">Review committers →</a></div></div>
      ${banner}
      <div class="section"><h2>Supervision over the term</h2><div class="hint">S3 (Verify) vs S6 (Orchestrate) at each weekly checkpoint. A persistent S6 &gt; S3 gap is the automation-complacency signature.</div>${trajectory(p)}</div>`;
    app.querySelectorAll(".wk-dot").forEach((d) => d.addEventListener("click", () => { location.hash = `#/p/${hp(id)}/s/${hp(d.getAttribute("data-sid"))}`; }));
  }

  async function renderSnapshot(id, sid) {
    const p = await getProject(id);
    const idx = p.checkpoints.findIndex((c) => c.sid === sid);
    const c = p.checkpoints[idx];
    if (!c) return renderProject(id);
    setCrumbs([{ label: "Projects", href: "#/" }, { label: p.alias, href: `#/p/${hp(id)}` }, { label: `Week ${c.week}` }]);
    const s = c.ssm.scores, src = c.ssm.source;
    const flag = c.drift && c.drift.flag ? `<div class="callout callout--danger"><b>Automation-complacency:</b> S6 ${LEVELS[s.S6]} but S3 ${LEVELS[s.S3]} (gap ${c.drift.s6MinusS3}). Organized workflow, lagging verification.</div>` : "";
    const d = c.delta;
    const deltaHtml = d ? `<div class="delta">
      <span class="d">vs week before: </span>
      <span class="d ${d.ssm.S3 > 0 ? "up" : d.ssm.S3 < 0 ? "down" : ""}">S3 ${d.ssm.S3 >= 0 ? "+" : ""}${d.ssm.S3}</span>
      <span class="d ${d.ssm.S6 > 0 ? "up" : d.ssm.S6 < 0 ? "down" : ""}">S6 ${d.ssm.S6 >= 0 ? "+" : ""}${d.ssm.S6}</span>
      <span class="d muted">+${d.newCommits} commits</span></div>` : "";
    const ai = c.ai ? `<div class="chips"><span class="ai-level ai-${c.ai.level}">AI: ${c.ai.level} (${c.ai.pct}%)</span><div class="aichips">${[...(c.ai.explicit || []), ...(c.ai.behavioral || [])].map((k) => `<span class="aichip">${esc(k.toUpperCase())}</span>`).join("") || '<span class="muted">no strong signals</span>'}</div></div>` : "";
    const review = getReview(sid);
    app.innerHTML = `
      <div class="page-head"><div><h1>${esc(p.alias)} · Week ${c.week}</h1><div class="sub">${c.reachableCommits} commits reachable · ${c.mature ? "mature" : "early term (flags suppressed)"}</div></div></div>
      ${flag}
      <div class="section"><div class="radar-wrap">
        ${radar(s, src)}
        <div style="flex:1;min-width:240px">
          <div class="chips" style="margin-bottom:12px">${AXES.map((a) => scoreChip(a, s[a], src[a])).join("")}</div>
          <div class="reason"><b>S3 Verify.</b> ${esc(c.signals.S3?.reasoning || "—")}</div>
          <div class="reason"><b>S6 Orchestrate.</b> ${esc(c.signals.S6?.reasoning || "—")}</div>
          ${deltaHtml}
          <div style="margin-top:12px">${ai}</div>
        </div>
      </div>
      <div class="review-bar">
        <span class="muted">Your review:</span>
        <span class="review-state review-state--${review}" id="rstate">${review}</span>
        <button class="btn btn--primary" data-rev="approved" aria-pressed="${review === "approved"}">Approve</button>
        <button class="btn btn--flag" data-rev="flagged" aria-pressed="${review === "flagged"}">Flag</button>
        <button class="btn" data-rev="unreviewed" aria-pressed="${review === "unreviewed"}">Clear</button>
      </div>
      <div class="prevnext">
        ${idx > 0 ? `<a class="btn" href="#/p/${hp(id)}/s/${hp(p.checkpoints[idx - 1].sid)}">← Week ${p.checkpoints[idx - 1].week}</a>` : "<span></span>"}
        ${idx < p.checkpoints.length - 1 ? `<a class="btn" href="#/p/${hp(id)}/s/${hp(p.checkpoints[idx + 1].sid)}">Week ${p.checkpoints[idx + 1].week} →</a>` : "<span></span>"}
      </div></div>`;
    const syncPressed = (v) => app.querySelectorAll("[data-rev]").forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute("data-rev") === v)));
    syncPressed(review);
    app.querySelectorAll("[data-rev]").forEach((b) => b.addEventListener("click", () => {
      setReview(sid, b.getAttribute("data-rev"));
      const v = getReview(sid);
      const st = document.getElementById("rstate");
      st.textContent = v; st.className = `review-state review-state--${v}`;
      syncPressed(v);
    }));
  }

  async function renderTeam(id) {
    const p = await getProject(id);
    const committers = p.committers || [];
    setCrumbs([{ label: "Projects", href: "#/" }, { label: p.alias, href: `#/p/${hp(id)}` }, { label: "Committers" }]);
    const rows = committers.map((c) => {
      const flags = (c.flags || []).map((f) => `<span class="flag ${f === "DUMPER" ? "flag--dumper" : "flag--free"}">${f.toLowerCase().replace("_", " ")}</span>`).join(" ");
      return `<tr class="clickable ${(c.flags || []).length ? "row--flag" : ""}" data-cid="${esc(c.cid)}">
        <td><b>${esc(c.alias)}</b> ${c.role === "lead" ? '<span class="muted">· lead</span>' : ""} ${flags}</td>
        <td style="min-width:140px"><div class="bar-mini"><div style="width:${pct(c.commitShare)}%"></div></div><span class="muted">${pct(c.commitShare)}% · ${c.commits} commits</span></td>
        <td>${pct(c.churnShare)}%</td>
        <td>${c.testsAuthored}</td>
        <td>${c.aiPct}%</td>
        <td>${dotCell(c.ssm.S3)} ${dotCell(c.ssm.S6)}</td>
      </tr>`;
    }).join("");
    app.innerHTML = `
      <div class="page-head"><div><h1>${esc(p.alias)} · Committers</h1><div class="sub">contribution balance, AI-dump vs verification</div></div></div>
      <div class="section"><h2>Contribution split</h2><div class="hint">A few committers carrying most of the work, or a "dumper" adding lots of unverified code, are review red flags.</div>
        ${shareBar(committers)}
      </div>
      <div class="section"><table>
        <thead><tr><th>Committer</th><th>Commit share</th><th>Churn share</th><th>Tests authored</th><th>AI-dump %</th><th>S3 / S6</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    app.querySelectorAll("[data-cid]").forEach((r) => r.addEventListener("click", () => { location.hash = `#/p/${hp(id)}/c/${hp(r.getAttribute("data-cid"))}`; }));
  }

  async function renderScorecard(id, cid) {
    const p = await getProject(id);
    const c = p.committers.find((x) => x.cid === cid);
    if (!c) return renderTeam(id);
    setCrumbs([{ label: "Projects", href: "#/" }, { label: p.alias, href: `#/p/${hp(id)}` }, { label: "Committers", href: `#/p/${hp(id)}/team` }, { label: c.alias }]);
    const flags = (c.flags || []).map((f) => `<span class="flag ${f === "DUMPER" ? "flag--dumper" : "flag--free"}">${f.toLowerCase().replace("_", " ")}</span>`).join(" ");
    const stat = (n, l) => `<div style="text-align:center;min-width:90px"><div style="font-size:24px;font-weight:700">${n}</div><div class="muted" style="font-size:11px">${l}</div></div>`;
    app.innerHTML = `
      <div class="page-head"><div><h1>${esc(c.alias)} ${flags}</h1><div class="sub">${p.alias} · ${c.role} · active weeks ${c.firstWeek}–${c.lastWeek}</div></div></div>
      <div class="section"><div style="display:flex;gap:22px;flex-wrap:wrap;align-items:center">
        ${stat(pct(c.commitShare) + "%", "of commits")}
        ${stat(c.commits, "commits")}
        ${stat(pct(c.churnShare) + "%", "of churn")}
        ${stat(c.testsAuthored, "tests authored")}
        ${stat(c.implFilesAuthored, "impl files")}
        ${stat(c.aiPct + "%", "large-dump commits")}
        ${stat(c.offHoursPct + "%", "off-hours")}
      </div></div>
      <div class="section"><h2>Their supervision (attributable)</h2>
        <div class="hint">Computed from this committer's own commits — only the git-derivable axes.</div>
        <div class="chips">${scoreChip("S3", c.ssm.S3, "git")}${scoreChip("S6", c.ssm.S6, "git")}
        ${["S1", "S2", "S4", "S5"].map((a) => scoreChip(a, -1, "pending")).join("")}</div>
        ${(c.flags || []).includes("DUMPER") ? `<div class="callout callout--danger" style="margin-top:14px"><b>Possible AI-dump pattern:</b> high churn share with no authored tests — lots of code in, little verification. Worth a closer look in review.</div>` : ""}
        ${(c.flags || []).includes("FREE_RIDER") ? `<div class="callout" style="margin-top:14px"><b>Low contribution:</b> under 5% of commits. Confirm the division of labor.</div>` : ""}
      </div>`;
  }

  // ---------- router ----------
  async function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const parts = h.split("/").filter(Boolean);
    const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
    try {
      if (parts[0] === "p" && parts[1]) {
        const id = dec(parts[1]);
        if (parts[2] === "team") return await renderTeam(id);
        if (parts[2] === "c" && parts[3]) return await renderScorecard(id, dec(parts[3]));
        if (parts[2] === "s" && parts[3]) return await renderSnapshot(id, dec(parts[3]));
        return await renderProject(id);
      }
      return await renderHome();
    } catch (e) {
      app.innerHTML = `<div class="callout callout--danger">Failed to load: ${esc(String(e))}</div>`;
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
