"use strict";
// Chess Ledger: reads the training path (path.json), pulls games and puzzles from
// Lichess, and keeps the training log in a secret GitHub Gist.

const GIST_DESC = "chess-ledger · data";
const GIST_FILE = "ledger.json";
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MARKS = [
  ["H", "Left a piece hanging"],
  ["M", "Missed their threat"],
  ["T", "Missed my own tactic"],
  ["E", "Couldn't finish the endgame"],
  ["O", "Broke an opening principle"],
];

const S = { cfg: null, data: null, gistId: null, games: [], puzzles: [], sync: "", saved: "" };

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const today = () => dkey(new Date());
const clock = () => { const n = new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; };
function roman(n) {
  if (n <= 0) return "0";
  const t = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
}
function weekOf(d) {
  const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return x; });
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

// ---------- data ----------
function initialData() {
  return {
    v: 1,
    chapter: "1",
    completed: [{ id: "0", on: "2026-11-16" }],
    goals: { "notation-learned": true, "first-coords": true },
    days: { "2026-11-16": { done: { coord: true }, coord: 13 } },
    games: {},
    ratings: {},
  };
}
const day = (k = today()) => (S.data.days[k] ??= { done: {} });

async function gh(path, opts = {}) {
  const r = await fetch("https://api.github.com" + path, {
    ...opts,
    headers: { Authorization: "Bearer " + store.get("ghToken"), Accept: "application/vnd.github+json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

async function loadData() {
  if (store.get("ghToken")) {
    try {
      const id = store.get("gistId");
      let g = id ? await gh("/gists/" + id).catch(() => null) : null;
      if (!g) {
        const found = (await gh("/gists?per_page=100")).find((x) => x.description === GIST_DESC);
        g = found ? await gh("/gists/" + found.id) : null;
      }
      if (!g) {
        g = await gh("/gists", {
          method: "POST",
          body: JSON.stringify({ description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: JSON.stringify(initialData(), null, 1) } } }),
        });
      }
      S.gistId = g.id; store.set("gistId", g.id);
      const f = g.files[GIST_FILE];
      S.data = JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
      S.saved = "Saved on GitHub";
      return;
    } catch (e) {
      S.saved = `Couldn't open GitHub (${e.message}). Using this browser's copy.`;
    }
  }
  const local = store.get("data");
  S.data = local ? JSON.parse(local) : initialData();
}

let saveTimer;
function save() {
  store.set("data", JSON.stringify(S.data));
  if (!S.gistId) return;
  S.saved = "Saving…"; status();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await gh("/gists/" + S.gistId, { method: "PATCH", body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(S.data, null, 1) } } }) });
      S.saved = `Saved on GitHub at ${clock()}`;
    } catch (e) { S.saved = `Couldn't save to GitHub (${e.message})`; }
    status();
  }, 1200);
}

// ---------- Lichess ----------
async function ndjson(url, headers = {}) {
  const r = await fetch(url, { headers: { Accept: "application/x-ndjson", ...headers } });
  if (!r.ok) throw new Error(`Lichess ${r.status}`);
  return (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
async function sync() {
  const user = S.cfg.lichessUser;
  S.sync = "Syncing with Lichess…"; status();
  try {
    const since = parseKey(S.cfg.start).getTime();
    const [games, profile] = await Promise.all([
      ndjson(`https://lichess.org/api/games/user/${user}?since=${since}&max=500&moves=false`),
      fetch(`https://lichess.org/api/user/${user}`).then((r) => r.json()),
    ]);
    S.games = games.map((g) => {
      const color = g.players.white.user?.id === user.toLowerCase() ? "white" : "black";
      const opp = g.players[color === "white" ? "black" : "white"];
      return {
        id: g.id, at: new Date(g.createdAt), color,
        opponent: opp.user?.name || (opp.aiLevel ? `Computer level ${opp.aiLevel}` : "Anonymous"),
        result: g.winner ? (g.winner === color ? "Win" : "Loss") : g.status === "started" ? "In progress" : "Draw",
      };
    });
    const month = today().slice(0, 7);
    if (!S.data.ratings[month] && profile.perfs) {
      S.data.ratings[month] = { puzzle: profile.perfs.puzzle?.rating, rapid: profile.perfs.rapid?.rating };
      save();
    }
    const lt = store.get("liToken");
    if (lt) S.puzzles = (await ndjson("https://lichess.org/api/puzzle/activity?max=1000", { Authorization: "Bearer " + lt }))
      .map((p) => ({ at: new Date(p.date), win: p.win, themes: p.puzzle.themes || [] }));
    S.sync = `Lichess synced at ${clock()}`;
  } catch (e) {
    S.sync = `Couldn't reach Lichess (${e.message})`;
  }
  render();
}

// ---------- path rules ----------
const chapter = () => S.cfg.chapters.find((c) => c.id === S.data.chapter) || S.cfg.chapters.at(-1);
const chapterNo = (c) => S.cfg.chapters.indexOf(c);
const onDay = (list, k) => list.filter((x) => dkey(x.at) === k);

function mastered(theme) {
  const { last, accuracy } = S.cfg.themeMastery;
  const t = S.puzzles.filter((p) => p.themes.includes(theme)).sort((a, b) => b.at - a.at).slice(0, last);
  return t.length >= last && t.filter((p) => p.win).length / last >= accuracy;
}
const currentTheme = (c) => c.themes.find((t) => !mastered(t)) || c.themes.at(-1);

function tasks(k = today()) {
  const c = chapter();
  const list = S.cfg.schedule[k] || c.week?.[WEEKDAYS[parseKey(k).getDay()]] || [];
  return list.map((t) => (t.kind === "tactics" && t.theme === "current" ? { ...t, theme: currentTheme(c) } : t));
}
function themePuzzles(theme, k) {
  if (!store.get("liToken")) return null;
  const p = onDay(S.puzzles, k).filter((x) => x.themes.includes(theme));
  return { played: p.length, solved: p.filter((x) => x.win).length };
}
function isDone(t, k = today()) {
  const d = S.data.days[k] || { done: {} };
  if (d.done?.[t.id]) return true;
  if (t.kind === "coord") return d.coord > 0;
  if (t.kind === "tactics") return false; // time-boxed: the method says not to chase a number of puzzles
  const games = onDay(S.games, k);
  if (t.kind === "game") return games.length > 0;
  if (t.kind === "review") return games.length > 0 && games.every((g) => S.data.games[g.id]?.marks?.length);
  return false;
}
const trained = (k) => tasks(k).some((t) => isDone(t, k)) || onDay(S.games, k).length > 0 || onDay(S.puzzles, k).length > 0;

function goalState(g) {
  if (S.data.goals[g.id]) return { ok: true };
  const a = g.auto;
  if (!a) return { ok: false };
  if (a.kind === "coordMax") { const v = Math.max(0, ...Object.values(S.data.days).map((d) => d.coord || 0)); return { ok: v >= a.target, txt: `${v} / ${a.target}` }; }
  if (a.kind === "games") { const v = S.games.length; return { ok: v >= a.target, txt: `${v} / ${a.target}` }; }
  if (a.kind === "themesMastered") { const c = chapter(), v = c.themes.filter(mastered).length; return { ok: v === c.themes.length, txt: `${v} / ${c.themes.length} themes` }; }
  return { ok: false };
}

// ---------- views ----------
function chapterTitle(c) {
  const e = c.emphasis, base = e?.replace(/\.$/, "");
  return e && c.title.endsWith(base) ? esc(c.title.slice(0, -base.length)) + `<em>${esc(e)}</em>` : esc(c.title);
}

function viewToday() {
  const c = chapter(), k = today(), d = parseKey(k), list = tasks(k);
  const mins = list.filter((t) => !t.optional).reduce((s, t) => s + (t.minutes || 0), 0);
  const maxim = S.cfg.maxims[Math.floor(d / 864e5) % S.cfg.maxims.length];
  return `<section class="view on"><div class="hoje"><div>
    <p class="eyebrow">${DAY_NAMES[d.getDay()]}, ${MONTHS[d.getMonth()]} ${roman(d.getDate())} · Chapter ${roman(chapterNo(c))}</p>
    <h1 class="display">Today's <em>training.</em></h1>
    <p class="lede">${list.length ? `${mins} minutes, one thing at a time. Before every move: what does he threaten?` : "Rest day. Play a game and review it if you feel like it."}</p>
    ${c.focus ? `<div class="foco"><div class="k">Chapter focus</div><p>${esc(c.focus)}</p></div>` : ""}
    <ol class="toc">${list.map((t, i) => entry(t, i + 1, k)).join("")}</ol>
    <div class="colophon"><span id="st-sync">${esc(S.sync)}</span><span id="st-save">${esc(S.saved)}</span></div>
  </div>
  <aside class="margin">
    ${c.figure ? `<div class="plate"><div class="board" role="img" aria-label="Diagram">${board(c.figure.fen, c.figure.highlight)}</div><p class="cap"><span class="fig">Fig. ${roman(chapterNo(c))}</span> — ${c.figure.caption}</p></div>` : ""}
    <div class="rule-orn">♞</div>
    <p class="maxim">“${esc(maxim.text)}”<cite>${esc(maxim.source)}</cite></p>
  </aside></div></section>`;
}

function entry(t, n, k) {
  const d = day(k), ok = isDone(t, k), themeName = S.cfg.themes[t.theme] || t.theme;
  const title = t.title || { coord: "Coordinates", tactics: `Tactics · ${themeName}`, game: "Game · 15+10", review: "Game review" }[t.kind];
  const note = t.note || {
    coord: "Find square, three 30-second rounds. Log the best one.",
    tactics: "Difficulty: Easiest. Watch the clock, not the count: understanding one puzzle beats guessing ten. Before you click: checks, captures, threats. Tick it when the time is up.",
    game: 'As white, the Italian: <span class="mono">1.e4 e5 2.Nf3 Nc6 3.Bc4</span>. As black, <span class="mono">1…e5</span> or <span class="mono">1…d5</span>.',
    review: "First ten moves from memory in your notebook, what you were thinking, and only then the engine. Mark the mistake.",
  }[t.kind] || "";
  const ext = 'target="_blank" rel="noopener"';
  let act = "";
  if (t.kind === "coord") {
    act = `<label class="field" for="coord">best round <input id="coord" inputmode="numeric" value="${d.coord ?? ""}"></label>
      <a class="link" href="https://lichess.org/training/coordinate" ${ext}>Open on Lichess →</a>`;
  } else if (t.kind === "tactics") {
    const p = themePuzzles(t.theme, k);
    act = (p ? `<span class="tally"><span class="figure">${p.solved}</span><span class="faint">of ${p.played} solved today</span></span>` : "")
      + `<a class="link" href="https://lichess.org/training/${esc(t.theme)}" ${ext}>Open on Lichess →</a>`;
  } else if (t.kind === "game") {
    const games = onDay(S.games, k);
    act = (games.length ? games.map((g) => `<a class="link" href="https://lichess.org/${g.id}" ${ext}>${g.result} vs ${esc(g.opponent)}</a>`).join("")
      : `<span class="faint">Shows up here once it's finished.</span>`) + `<a class="link" href="https://lichess.org/" ${ext}>Play →</a>`;
  } else if (t.kind === "review") {
    const games = onDay(S.games, k);
    act = games.length ? games.map((g) => {
      const r = S.data.games[g.id] || {}, m = r.marks || [];
      return `<div class="jogo"><div class="faint">${g.color === "white" ? "White" : "Black"} vs ${esc(g.opponent)} · <a class="link" href="https://lichess.org/${g.id}" ${ext}>open analysis →</a></div>
        <div class="letters" role="group" aria-label="Mistake type">${MARKS.map(([l, txt]) => `<button class="letter" data-g="${g.id}" data-l="${l}" title="${txt}" aria-pressed="${m.includes(l)}">${l}</button>`).join("")}
        <button class="letter" data-g="${g.id}" data-l="ok" title="No clear mistake" aria-pressed="${m.includes("ok")}">✓</button></div>
        <textarea class="note" data-g="${g.id}" rows="1" placeholder="One sentence: why did I win or lose?">${esc(r.note || "")}</textarea></div>`;
    }).join("") : `<span class="faint">Today's games show up here so you can mark the mistake.</span>`;
  } else if (t.link) {
    act = `<a class="link" href="${esc(t.link)}" ${t.link.startsWith("#") ? "" : ext}>${esc(t.linkLabel || "Open")} →</a>`;
  }
  return `<li class="entry${ok ? " done" : ""}">
    <span class="roman">${roman(n)}</span>
    <div class="row"><input type="checkbox" class="check" data-t="${t.id}" ${ok ? "checked" : ""} aria-label="${esc(title)} done"><span class="title">${esc(title)}</span><span class="leader"></span><span class="time">${t.minutes ? t.minutes + " min" : ""}${t.optional ? " · optional" : ""}</span></div>
    <p class="desc">${note}</p>
    <div class="act${t.kind === "review" ? " col" : ""}">${act}</div></li>`;
}

function board(fen, hl) {
  const g = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙", k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
  const sq = (i, j, piece = "") => `<span class="sq ${(i + j) % 2 ? "d" : "l"}${"abcdefgh"[j] + (8 - i) === hl ? " hit" : ""}">${piece}</span>`;
  let h = "";
  fen.split(" ")[0].split("/").forEach((row, i) => {
    h += `<span class="coord">${8 - i}</span>`;
    let j = 0;
    for (const c of row) {
      if (/\d/.test(c)) for (let x = 0; x < +c; x++, j++) h += sq(i, j);
      else h += sq(i, j++, g[c] + "︎");
    }
  });
  return h + "<span></span>" + [..."abcdefgh"].map((f) => `<span class="coord">${f}</span>`).join("");
}

function viewPath() {
  const c = chapter(), no = chapterNo(c);
  const goals = c.goals.map((g) => ({ g, s: goalState(g) }));
  const done = goals.filter((x) => x.s.ok).length;
  const past = S.data.completed.map((x) => ({ x, ch: S.cfg.chapters.find((y) => y.id === x.id) })).filter((p) => p.ch).reverse();
  const cur = c.themes ? currentTheme(c) : null;
  return `<section class="view on"><div class="chapter">
    <p class="eyebrow">Chapter ${roman(no)}</p>
    <h1 class="display">${chapterTitle(c)}</h1>
    <p class="lede">${esc(c.summary || "")}</p>
    <div class="progress"><span class="figure">${done}</span><span class="faint">of ${goals.length} goals</span><span class="meter" aria-hidden="true"><i style="width:${(done / goals.length) * 100}%"></i></span></div>
    <ul class="goals">${goals.map(({ g, s }) => `<li class="${s.ok ? "done" : ""}"><input type="checkbox" class="check" data-goal="${g.id}" ${s.ok ? "checked" : ""} ${g.auto && !S.data.goals[g.id] ? "disabled" : ""} aria-label="${esc(g.text)}"><span class="t">${esc(g.text)}</span>${s.txt ? `<span class="auto">${s.txt}</span>` : ""}</li>`).join("")}</ul>
    ${c.themes ? `<div class="themes"><h2>Tactical themes in this chapter</h2><ol>${c.themes.map((t, i) => {
      const m = mastered(t), now = t === cur && !m;
      return `<li class="${!m && !now ? "next" : ""}"><span class="roman">${roman(i + 1).toLowerCase()}</span>${esc(S.cfg.themes[t] || t)}<span class="badge${m ? " ok" : ""}" style="margin-left:auto">${m ? "mastered" : now ? "in progress" : "later"}</span></li>`;
    }).join("")}</ol>${store.get("liToken") ? "" : `<p class="faint" style="font-size:13px">Connect Lichess in Settings so themes advance on their own.</p>`}</div>` : ""}
    ${done === goals.length && S.cfg.chapters[no + 1] ? `<div class="sect"><button class="btn btn-primary" id="finish">Finish chapter ${roman(no)}</button></div>` : ""}
    ${past.map(({ x, ch }) => `<details class="past"><summary><span class="roman">${roman(chapterNo(ch))}</span>${esc(ch.title)}<span class="when">${esc(x.on.slice(5).split("-").reverse().join("/"))}</span></summary><ul>${ch.goals.map((g) => `<li>${esc(g.text)}</li>`).join("")}</ul></details>`).join("")}
  </div></section>`;
}

function viewProgress() {
  const now = new Date(), week = weekOf(now), ks = week.map(dkey);
  const days = ks.filter(trained).length;
  const coordWeek = Math.max(0, ...ks.map((k) => S.data.days[k]?.coord || 0));
  const coordPrev = Math.max(0, ...weekOf(new Date(now - 7 * 864e5)).map(dkey).map((k) => S.data.days[k]?.coord || 0));
  const pz = S.puzzles.filter((p) => ks.includes(dkey(p.at)));
  const games = S.games.filter((g) => ks.includes(dkey(g.at)));
  const count = (list) => MARKS.map(([l]) => [l, list.filter((g) => S.data.games[g.id]?.marks?.includes(l)).length]);
  const marksWeek = count(games).filter(([, n]) => n).map(([l, n]) => l + n).join(" ") || "—";
  const month = today().slice(0, 7);
  const pts = Object.entries(S.data.days).filter(([, d]) => d.coord).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-14);
  const range = `${MONTHS[week[0].getMonth()].slice(0, 3)} ${week[0].getDate()} – ${MONTHS[week[6].getMonth()].slice(0, 3)} ${week[6].getDate()}`;
  const scorecard = [
    `Week ${range}`,
    `Days trained: ${days}/5`,
    `Coordinates (best 30 s): ${coordWeek || "—"}`,
    ...(chapter().themes || []).map((t) => { const p = pz.filter((x) => x.themes.includes(t)); return p.length ? `${S.cfg.themes[t]}: ${p.filter((x) => x.win).length} of ${p.length} solved` : null; }).filter(Boolean),
    `Games: ${games.length} · mistakes: ${marksWeek}`,
  ].join("\n");
  const months = Object.entries(S.data.ratings).sort();
  return `<section class="view on">
    <div class="ledger-head"><p class="eyebrow">Week of ${range}</p>
      <h1 class="display">The <em>ledger.</em></h1>
      <p class="lede">Habit comes before rating. Rating only shows up here once a month.</p></div>
    <div class="figures">
      <div class="fig-cell"><div class="figure">${days}<span class="faint" style="font-size:.5em"> / 5</span></div><div class="lbl">Days trained</div></div>
      <div class="fig-cell"><div class="figure">${coordWeek || "—"}</div><div class="lbl">Coordinates</div>${coordPrev && coordWeek ? `<div class="delta">${coordWeek >= coordPrev ? "▲" : "▼"} ${Math.abs(coordWeek - coordPrev)} vs last week</div>` : ""}</div>
      <div class="fig-cell"><div class="figure">${pz.length ? Math.round((pz.filter((p) => p.win).length / pz.length) * 100) + "%" : "—"}</div><div class="lbl">Puzzle accuracy</div>${pz.length ? `<div class="delta" style="color:var(--ink-faint)">${pz.length} played</div>` : ""}</div>
      <div class="fig-cell"><div class="figure">${games.length}</div><div class="lbl">Games</div><div class="delta" style="color:var(--ink-faint)">mistakes: ${marksWeek}</div></div>
    </div>
    <div class="sect"><div class="sect-label"><span class="roman">I</span><span class="bar"></span><span class="eyebrow">Habit</span></div>
      <h2 class="display">One square <em>a day.</em></h2>
      <div class="week">${ks.map((k) => `<div class="day${trained(k) ? " on" : ""}${k === today() ? " today" : ""}" title="${k}"></div>`).join("")}</div>
      <div class="week-l">${[..."MTWTFSS"].map((c) => `<span>${c}</span>`).join("")}</div></div>
    <div class="sect"><div class="sect-label"><span class="roman">II</span><span class="bar"></span><span class="eyebrow">Coordinates</span></div>
      <h2 class="display">Best round <em>per day.</em></h2><div class="chart">${chart(pts)}</div></div>
    <div class="sect"><div class="sect-label"><span class="roman">III</span><span class="bar"></span><span class="eyebrow">This month's mistakes</span></div>
      <h2 class="display">Where games <em>slip away.</em></h2>
      <table class="ledger"><thead><tr><th></th><th>Kind</th><th style="text-align:right">Count</th></tr></thead><tbody>
      ${count(S.games.filter((g) => dkey(g.at).slice(0, 7) === month)).map(([l, n], i) => `<tr><td class="k">${l}</td><td>${MARKS[i][1]}</td><td class="n">${n}</td></tr>`).join("")}</tbody></table></div>
    <div class="sect"><div class="sect-label"><span class="roman">IV</span><span class="bar"></span><span class="eyebrow">Rating</span></div>
      <h2 class="display">Once <em>a month.</em></h2>
      ${months.length ? `<table class="ledger"><thead><tr><th>Month</th><th style="text-align:right">Puzzles</th><th style="text-align:right">Rapid</th></tr></thead><tbody>${months.map(([m, r]) => `<tr><td>${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}</td><td class="n">${r.puzzle ?? "—"}</td><td class="n">${r.rapid ?? "—"}</td></tr>`).join("")}</tbody></table>` : `<p class="faint">Shows up after the first Lichess sync.</p>`}</div>
    <div class="sect"><button class="btn btn-primary" id="copy">Copy this week's scorecard</button><span class="copied" id="copied" hidden>Copied</span>
      <pre class="placar" id="scorecard">${esc(scorecard)}</pre></div>
  </section>`;
}

function chart(pts) {
  if (!pts.length) return `<p class="faint">Log your best coordinates round on the Today page.</p>`;
  const W = 620, H = 170, L = 34, R = 610, T = 20, B = 150, goal = 20;
  const max = Math.max(goal, ...pts.map(([, d]) => d.coord));
  const y = (v) => B - (v / max) * (B - T);
  const x = (i) => (pts.length === 1 ? (L + R) / 2 : L + 26 + (i * (R - L - 52)) / (pts.length - 1));
  const last = pts.length - 1;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Coordinates per day">
    ${[0, Math.round(max / 2), max].map((v) => `<line x1="${L}" y1="${y(v)}" x2="${R}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
    <line x1="${L}" y1="${y(goal)}" x2="${R}" y2="${y(goal)}" stroke="var(--rubric)" stroke-dasharray="4 4"/><text x="${R - 4}" y="${y(goal) - 6}" text-anchor="end" style="fill:var(--rubric)">goal ${goal}</text>
    <polyline points="${pts.map(([, d], i) => `${x(i)},${y(d.coord)}`).join(" ")}" fill="none" stroke="var(--ink)" stroke-width="1.6"/>
    ${pts.map(([k, d], i) => `<circle cx="${x(i)}" cy="${y(d.coord)}" r="${i === last ? 4 : 3}" fill="${i === last ? "var(--rubric)" : "var(--canvas)"}" stroke="${i === last ? "var(--rubric)" : "var(--ink)"}"/><text x="${x(i)}" y="${H - 4}" text-anchor="middle">${k.slice(5, 7)}/${k.slice(8)}</text>`).join("")}</svg>`;
}

function viewSettings() {
  const gt = !!store.get("ghToken"), lt = !!store.get("liToken");
  return `<section class="view on"><div class="chapter">
    <p class="eyebrow">Settings</p><h1 class="display">The <em>keys.</em></h1>
    <p class="lede">They stay in this browser only. On another computer, paste them again.</p>
    <div class="sect"><div class="sect-label"><span class="roman">I</span><span class="bar"></span><span class="eyebrow">GitHub</span></div>
      <p class="desc">Keeps your log in a secret Gist so it follows you to any computer. Create a classic token with only the <span class="mono">gist</span> scope:
      <a class="link" href="https://github.com/settings/tokens/new?scopes=gist&description=chess-ledger" target="_blank" rel="noopener">create token →</a></p>
      <div class="act"><input class="tok" id="ghTok" type="password" placeholder="${gt ? "connected · paste another to replace" : "ghp_…"}" autocomplete="off">
      <button class="btn btn-secondary" data-save="ghToken">Save</button>${gt ? `<button class="btn btn-secondary" data-clear="ghToken">Disconnect</button>` : ""}</div></div>
    <div class="sect"><div class="sect-label"><span class="roman">II</span><span class="bar"></span><span class="eyebrow">Lichess</span></div>
      <p class="desc">Optional. Counts puzzles per theme and advances themes automatically. Scope <span class="mono">puzzle:read</span>:
      <a class="link" href="https://lichess.org/account/oauth/token/create?scopes[]=puzzle:read&description=chess-ledger" target="_blank" rel="noopener">create token →</a></p>
      <div class="act"><input class="tok" id="liTok" type="password" placeholder="${lt ? "connected · paste another to replace" : "lip_…"}" autocomplete="off">
      <button class="btn btn-secondary" data-save="liToken">Save</button>${lt ? `<button class="btn btn-secondary" data-clear="liToken">Disconnect</button>` : ""}</div></div>
    <p class="colophon"><span>${esc(S.saved)}</span><span>${S.gistId ? `Gist ${esc(S.gistId.slice(0, 8))}…` : "No Gist"}</span></p>
  </div></section>`;
}

// ---------- wiring ----------
function status() {
  const a = $("#st-sync"), b = $("#st-save");
  if (a) a.textContent = S.sync;
  if (b) b.textContent = S.saved;
}
function render() {
  const views = { today: viewToday, path: viewPath, progress: viewProgress, settings: viewSettings };
  const h = (location.hash || "#today").slice(1), v = views[h] ? h : "today";
  document.querySelectorAll("nav.tabs a").forEach((a) => (a.dataset.v === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  $("#banner").innerHTML = !store.get("ghToken") && v !== "settings"
    ? `<p class="aviso">Your log only lives in this browser. <a class="link" href="#settings">Connect GitHub</a> to use it on any computer.</p>` : "";
  $("#app").innerHTML = views[v]();
}

document.addEventListener("change", (e) => {
  const el = e.target, k = today();
  if (el.id === "coord") { day(k).coord = parseInt(el.value, 10) || 0; save(); render(); }
  else if (el.id === "pz") { (day(k).puzzles ??= {})[el.dataset.theme] = parseInt(el.value, 10) || 0; save(); render(); }
  else if (el.dataset.t) { day(k).done[el.dataset.t] = el.checked; save(); render(); }
  else if (el.dataset.goal) { S.data.goals[el.dataset.goal] = el.checked; save(); render(); }
  else if (el.classList.contains("note")) { (S.data.games[el.dataset.g] ??= {}).note = el.value; save(); }
});
document.addEventListener("click", (e) => {
  const el = e.target.closest("button");
  if (!el) return;
  if (el.classList.contains("letter")) {
    const r = (S.data.games[el.dataset.g] ??= {}), l = el.dataset.l, m = r.marks || [];
    r.marks = m.includes(l) ? m.filter((x) => x !== l) : l === "ok" ? ["ok"] : [...m.filter((x) => x !== "ok"), l];
    save(); render();
  } else if (el.id === "finish") {
    const c = chapter();
    S.data.completed.push({ id: c.id, on: today() });
    S.data.chapter = S.cfg.chapters[chapterNo(c) + 1].id; save(); render();
  } else if (el.id === "copy") {
    const shown = () => { const c = $("#copied"); c.hidden = false; setTimeout(() => (c.hidden = true), 1800); };
    (navigator.clipboard?.writeText($("#scorecard").textContent) || Promise.reject()).then(shown, () => getSelection().selectAllChildren($("#scorecard")));
  } else if (el.dataset.save) {
    const v = $(el.dataset.save === "ghToken" ? "#ghTok" : "#liTok").value.trim();
    if (v) { store.set(el.dataset.save, v); start(); }
  } else if (el.dataset.clear) {
    store.set(el.dataset.clear, null);
    if (el.dataset.clear === "ghToken") { store.set("gistId", null); S.gistId = null; }
    start();
  }
});
window.addEventListener("hashchange", render);

async function start() {
  S.cfg ??= await (await fetch("path.json", { cache: "no-store" })).json();
  await loadData();
  render();
  sync();
}
start();
setInterval(sync, 5 * 60 * 1000);
