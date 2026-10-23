// report page errors to the app log (so problems never stay invisible)
window.addEventListener("error", (e) => fetch("/api/jslog", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ msg: String(e.message), at: `${e.filename}:${e.lineno}` }) }).catch(() => {}));
window.addEventListener("unhandledrejection", (e) => fetch("/api/jslog", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ msg: String(e.reason), at: "promise" }) }).catch(() => {}));
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// the app's bridge; usable only once its functions are attached (a moment after the page loads)
const api = () => { const a = window.pywebview && window.pywebview.api; return a && typeof a.browser_place === "function" ? a : null; };
let tab = "play";

// every dropdown in the app as pill buttons: the <select> stays (hidden) and keeps working; clicks set it
function pillify(sel) {
  if (sel._pills) return;
  const box = document.createElement("span");
  box.className = "pills"; sel._pills = box; sel.classList.add("pilled");
  sel.after(box);
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b || sel.value === b.dataset.v) return;
    sel.value = b.dataset.v; sel.dispatchEvent(new Event("change")); syncPills();
  });
  new MutationObserver(() => syncPills()).observe(sel, { childList: true });
}
function syncPills() {
  document.querySelectorAll("select.pilled").forEach((sel) => {
    const html = [...sel.options].map((o) => `<button type="button" class="pill-b ${o.value === sel.value ? "on" : ""}" data-v="${esc(o.value)}">${esc(o.textContent)}</button>`).join("");
    if (sel._pills._html !== html) { sel._pills.innerHTML = html; sel._pills._html = html; }
  });
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), 2600);
}

// the built-in browser is a native view: tell the app where the browser area is on screen
function placeBrowser() {
  if (!api()) return;
  if (tab !== "songsterr" || document.querySelector(".pop:not(.hidden)")) { api().browser_hide(); return; }
  const r = $("#browser-area").getBoundingClientRect();
  api().browser_place(r.left, r.top, r.width, r.height);
}
new ResizeObserver(placeBrowser).observe($("#browser-area"));
window.addEventListener("resize", placeBrowser);
window.addEventListener("pywebviewready", placeBrowser);

function setTab(name) {
  tab = name;
  try { sessionStorage.setItem("mp-tab", name); } catch (e) { /* fine */ }
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  const isWin = !!document.querySelector(`#view-${name}.win`);
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hidden", !(v.id === `view-${name}` || (isWin && v.id === "view-play"))));
  document.body.classList.toggle("win-open", isWin);
  closePops();
  placeBrowser();
  if (name === "play") { pollNow(); drawPlayBoard(); }
  if (name === "amp") { guideSeen = guideFor; $("#guide-ready").classList.add("hidden"); loadGuide(); loadAmp(); }
  if (name === "songs") loadSongs();
  if (name === "learn") renderLessons();
}

// pop-ups (Options, Song chords): the Songsterr view hides while one is open so it can't cover it
function openPop(id) { closePops(); $(id).classList.remove("hidden"); placeBrowser(); }
function closePops() { document.querySelectorAll(".pop").forEach((p) => p.classList.add("hidden")); placeBrowser(); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePops(); });
document.querySelectorAll(".pop").forEach((p) => p.addEventListener("click", (e) => { if (e.target === p || e.target.closest("[data-close]")) closePops(); }));

function render(s) {
  $("#song-chip").textContent = s.song ? `${s.song.title} · ${s.song.artist}` : "No song yet";
  const bt = s.bt || {};
  const amp = bt["HeadRush Flex Prime"], spk = bt["LP-UNF"];
  const sound = $("#pill-sound");
  sound.textContent = amp ? "Sound → amp" : spk ? "Sound → Kali" : "Sound → Mac";
  sound.className = "pill " + (amp ? "ok" : "");
  const sp = s.spotify || {}, pill = $("#pill-spotify");
  pill.textContent = !sp.running ? "Spotify off" : sp.state !== "playing" ? "Spotify paused" : sp.volume === 0 ? "Spotify muted" : `Spotify ${sp.volume}%`;
  pill.className = "pill " + (sp.running && (sp.volume === 0 || sp.state !== "playing") ? "ok" : "");
  $("#log").innerHTML = s.log.slice().reverse().map((l) => `<li><span>${l.at}</span>${esc(l.text)}</li>`).join("");
}
// on battery: half the animation frames and fewer sync checks (still smooth, uses less power)
const POWER = { battery: false, frames: {} };
const skipFrame = (who) => POWER.battery && ((POWER.frames[who] = (POWER.frames[who] || 0) + 1) % 2 === 1);  // each loop counts its own frames
async function refresh() {
  try { const s = await (await fetch("/api/session")).json(); POWER.battery = s.plugged === false; render(s); } catch (e) { /* starting */ }
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.tab) setTab(b.dataset.tab);
  if (b.dataset.go) { if (b.dataset.go === "amp") guideSeen = guideFor; setTab(b.dataset.go); $("#guide-ready").classList.add("hidden"); }
  if (b.dataset.nav && api()) api().browser_nav(b.dataset.nav);
  if (b.id === "spotify-song" && api()) { const r = await api().open_spotify_song(); toast(r.ok ? "Opened Spotify's song" : "Not found on Songsterr"); }
  if (b.dataset.sound) {
    b.disabled = true; toast("Switching... (a few seconds)");
    const r = await (await fetch(`/api/sound/${b.dataset.sound}`, { method: "POST" })).json();
    toast(r.ok ? "Done" : "Couldn't connect. See the list."); b.disabled = false; refresh();
  }
});
$("#search").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#search-q").value.trim();
  if (q && api()) { api().browser_search(q); $("#search-q").blur(); }
});
refresh();
setInterval(refresh, 2000);
// a page refresh keeps you on the tab you were on (after everything below has loaded)
window.addEventListener("load", () => { try { const t = sessionStorage.getItem("mp-tab"); if (t && t !== "songsterr" && document.querySelector(`[data-tab="${t}"]`)) setTab(t); } catch (e) { /* fine */ } });

/* ======================= music: notes, keys, chords ======================= */
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = { Db: 1, Eb: 3, Gb: 6, Ab: 8, Bb: 10, Cb: 11, Fb: 4 };
const noteIndex = (n) => (FLATS[n] ?? NOTES.indexOf(n.toUpperCase().replace("♯", "#")));
// flat keys (F, Bb, Eb, Ab, Db major; D, G, C, F, Bb, Eb minor) are spelled with flats, like guitarists write them
const NOTES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const useFlats = () => { const k = typeof P !== "undefined" && P.key; return !!k && (k.minor ? [2, 7, 0, 5, 10, 3] : [5, 10, 3, 8, 1]).includes(k.root); };
const nn = (pc) => (useFlats() ? NOTES_FLAT : NOTES)[((pc % 12) + 12) % 12];
const spell = (name) => !name || !useFlats() ? (name || "") : name.replace(/([A-G])#/g, (m, l) => NOTES_FLAT[(NOTES.indexOf(l) + 1) % 12]);
const INTERVAL = ["R", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];
const SCALES = { pent: (m) => m ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9], full: (m) => m ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11],
  blues: (m) => m ? [0, 3, 5, 6, 7, 10] : [0, 2, 3, 4, 7, 9], chord: () => [] };
const SCALE_HELP = {
  pent: "The 5 safest notes of the key: almost nothing you play from them sounds wrong. Most rock solos use them. Start here.",
  full: "Every note of the key. More melodic, but 2 of them can clash if you hold them. Try after the pentatonic.",
  blues: "The pentatonic plus one spicy \"blue\" note: slide through it, don't stop on it.",
  chord: "Only the notes of the chord playing right now: the safest notes to end a phrase on.",
};

// "F#m7", "D/A", "B5", "Cadd9", "Asus2" -> {root, minor, tones}
function chordInfo(name) {
  const m = /^([A-G])([#b]?)([^/]*)/.exec(name || "");
  if (!m) return null;
  const r = noteIndex(m[1] + m[2]), q = m[3];
  const minor = /^m(?!aj)/.test(q) || /^min/.test(q);
  let iv = minor ? [0, 3, 7] : [0, 4, 7];
  if (/^5/.test(q)) iv = [0, 7];
  else if (/dim|°/.test(q)) iv = [0, 3, 6];
  else if (/aug|\+/.test(q)) iv = [0, 4, 8];
  else if (/sus2/.test(q)) iv = [0, 2, 7];
  else if (/sus/.test(q)) iv = [0, 5, 7];
  if (/maj7/.test(q)) iv.push(11); else if (/7/.test(q)) iv.push(10);
  if (/(add)?9/.test(q)) iv.push(2);
  if (/(^|[^1])6/.test(q)) iv.push(9);
  return { root: r, minor, tones: [...new Set(iv.map((i) => (r + i) % 12))] };
}
// a key from what's been heard (Krumhansl-Schmuckler profiles)
const PROF_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROF_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function guessKey(acc) {
  let best = null;
  for (let r = 0; r < 12; r++) for (const [prof, minor] of [[PROF_MAJ, false], [PROF_MIN, true]]) {
    const score = prof.reduce((s, p, i) => s + p * acc[(i + r) % 12], 0);
    if (!best || score > best.score) best = { root: r, minor, score };
  }
  return best;
}
// chords of the key get a bonus, so passing notes can't flip the display to a random chord
function inKey(root, q, key) {
  if (!key) return false;
  const deg = (root - key.root + 12) % 12;
  const major = { 0: "", 2: "m", 4: "m", 5: "", 7: "", 9: "m" }, minor = { 0: "m", 3: "", 5: "m", 7: "m", 8: "", 10: "" };
  return (key.minor ? minor : major)[deg] === q || (key.minor && deg === 7 && q === "");  // + the major V in minor
}
function detectChord(c, key) {
  let best = null, second = null;
  for (let r = 0; r < 12; r++) for (const [shape, q] of [[[0, 4, 7], ""], [[0, 3, 7], "m"]]) {
    const tones = shape.map((i) => (r + i) % 12);
    const on = tones.reduce((s, t) => s + c[t], 0) + c[r] * 0.5;
    const off = c.reduce((s, v, i) => s + (tones.includes(i) ? 0 : v), 0) / 9;
    const score = on - off * 2 + (inKey(r, q, key) ? 0.25 : 0);
    const cand = { root: r, q, tones, score };
    if (!best || score > best.score) { second = best; best = cand; } else if (!second || score > second.score) second = cand;
  }
  best.margin = best.score - (second ? second.score : 0);
  return best;
}
const fmtT = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
// binary search: the last item whose time is <= t
const lastAt = (arr, t, key) => { let lo = 0, hi = arr.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (key(arr[m]) <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };

/* ======================= the fretboard ======================= */
// o = {tuning, key, scale (intervals), chordTones, labels, area, frets, now, next}
function fretboard(svg, o) {
  const W = svg.clientWidth || 1000, H = svg.clientHeight || 300, FR = o.frets || 15;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const left = 84, right = 22, top = 40, bottom = 30;  // the string names get their own space on the left
  // real guitar spacing: frets get closer up the neck
  // even spacing (a neat grid, easy to read) or real guitar spacing (frets get closer up the neck) - Settings
  const real = document.body.classList.contains("real-frets");
  const scaleLen = (W - left - right) / (1 - Math.pow(2, -FR / 12));
  const fx = (f) => real ? left + scaleLen * (1 - Math.pow(2, -f / 12)) : left + (W - left - right) * f / FR;

  const tuning = o.tuning, strings = tuning.length, sy = (s) => top + (s * (H - top - bottom)) / (strings - 1);
  const key = o.key, scale = o.scale || [], chordTones = o.chordTones || [], mode = o.labels, area = o.area || "all";
  const lowOpen = tuning[strings - 1] % 12;
  const rootFret = key ? ((key.root - lowOpen) % 12 + 12) % 12 : 0;
  const boxFrom = area === "all" || !key ? 0 : (rootFret + [0, 3, 5, 7, 10][Number(area) - 1]) % 12;
  const inArea = (f) => area === "all" || !key || (f >= boxFrom - 1 && f <= boxFrom + 4) || (f >= boxFrom + 11 && f <= boxFrom + 16);
  const r = Math.min(16, (H - top - bottom) / (strings - 1) / 2.25);
  let g = "";
  for (let f = 1; f <= FR; f++) g += `<line class="fret ${f === 12 ? "twelve" : ""}" x1="${fx(f)}" y1="${top}" x2="${fx(f)}" y2="${H - bottom}"/>`;
  g += `<rect class="nut" x="${left - 7}" y="${top - 3}" width="9" height="${H - top - bottom + 4}"/>`;
  for (const f of [3, 5, 7, 9, 15, 17, 19, 21].filter((f) => f <= FR)) g += `<circle class="inlay" cx="${(fx(f - 1) + fx(f)) / 2}" cy="${H - bottom + 17}" r="5"/>`;
  g += `<circle class="inlay" cx="${(fx(11) + fx(12)) / 2 - 8}" cy="${H - bottom + 17}" r="5"/><circle class="inlay" cx="${(fx(11) + fx(12)) / 2 + 8}" cy="${H - bottom + 17}" r="5"/>`;
  for (let f = 1; f <= FR; f++) g += `<text class="fnum" x="${(fx(f - 1) + fx(f)) / 2}" y="${top - 20}">${f}</text>`;
  tuning.forEach((open, s) => {
    g += `<line class="string s${s}" x1="${left}" y1="${sy(s)}" x2="${W - right}" y2="${sy(s)}" style="stroke-width:${1.6 + s * 0.6}"/>`;
    g += `<text class="sname" x="20" y="${sy(s) + 5}">${nn(open % 12)}</text>`;
    for (let f = 0; f <= FR; f++) {
      const pc = (open + f) % 12;
      const isChord = chordTones.includes(pc), iv = key ? (pc - key.root + 12) % 12 : null;
      const inScale = key && scale.includes(iv);
      if (!(inScale || isChord) || !inArea(f)) continue;
      const cls = key && iv === 0 && (inScale || isChord) ? "root" : isChord ? "chord" : "scale";
      const x = f === 0 ? left - 26 : (fx(f - 1) + fx(f)) / 2, label = mode === "intervals" && key ? INTERVAL[iv] : nn(pc);
      g += `<g class="note ${cls} ${isChord ? "hot" : ""} ${o.dim ? "dim" : ""}"><circle cx="${x}" cy="${sy(s)}" r="${isChord ? r + 1.5 : r}"/><text x="${x}" y="${sy(s) + 5}">${label}</text></g>`;
    }
  });
  // what the guitarist plays now (filled) and next (outlined), on the exact string/fret
  const spot = (s, f, cls) => {
    if (s >= strings) return "";
    const x = f === 0 ? left - 26 : (fx(f - 1) + fx(f)) / 2;
    return `<g class="note ${cls}"><circle cx="${x}" cy="${sy(s)}" r="${cls === "play" ? r + 5 : r + 3}"/><text x="${x}" y="${sy(s) + 5}">${f}</text></g>`;
  };
  for (const [s, f] of o.next || []) g += spot(s, f, "next");
  // techniques on the notes played now: an arrow along the string to where a slide / hammer-on goes, badges for the rest
  const xAt = (f) => (f === 0 ? left - 26 : (fx(f - 1) + fx(f)) / 2);
  for (const [s, f, fl = ""] of o.now || []) {
    if (s >= strings) continue;
    const to = (o.ahead || o.next || []).find((n) => n[0] === s && n[1] !== f);  // where the slide / hammer-on goes
    if (to && (fl.includes("s") || fl.includes("h"))) {
      const x1 = xAt(f), x2 = xAt(to[1]), y = sy(s), dir = x2 > x1 ? 1 : -1, r2 = r + 6;
      g += `<g class="tech-arrow ${fl.includes("s") ? "slide" : "hammer"}"><line x1="${x1 + dir * r2}" y1="${y}" x2="${x2 - dir * r2}" y2="${y}"/>
        <path d="M${x2 - dir * r2} ${y} l${-dir * 9} -6 v12 z"/>
        <text x="${(x1 + x2) / 2}" y="${y - 9}">${fl.includes("s") ? "slide" : "hammer-on"}</text></g>`;
    }
    if (!o.animate && /[bB]/.test(fl)) g += `<g class="tech-bend"><path d="M${xAt(f)} ${sy(s) - r - 6} v-16 m-6 6 l6 -6 l6 6"/><text x="${xAt(f) + 10}" y="${sy(s) - r - 12}">bend</text></g>`;
  }
  if (o.animate) {  // the animator draws the playing notes (moving bubbles + trails) into this layer
    svg._geo = { xAt, sy, strings, r, left, x2: W - right, gap: (H - top - bottom) / (strings - 1) };
    // the bubble layers stay put (rebuilding them on every note blanked the bubbles until the next frame = flicker);
    // the board under them is only replaced when it really changed
    let base = svg.querySelector("#fb-base");
    if (!base || !svg.querySelector("#fx-now")) {
      svg.innerHTML = `<g id="fb-base"></g><g id="fx-trail"></g><g id="fx-now"></g>`;
      base = svg.querySelector("#fb-base"); svg._html = null;
    }
    if (svg._base !== g) { base.innerHTML = g; svg._base = g; }
    return;
  }
  for (const [s, f, fl = ""] of o.now || []) {
    g += spot(s, f, "play");
    const badge = fl.includes("x") ? "x" : fl.includes("H") ? "harm" : fl.includes("v") ? "~" : fl.includes("h") ? "h" : "";
    if (badge && s < strings) g += `<g class="tech-badge"><rect x="${xAt(f) + r - 2}" y="${sy(s) - r - 14}" width="${badge.length * 8 + 10}" height="16" rx="8"/><text x="${xAt(f) + r + 3 + badge.length * 4}" y="${sy(s) - r - 2}">${badge}</text></g>`;
  }
  if (svg._html !== g) { svg.innerHTML = g; svg._html = g; svg._base = null; }  // unchanged = leave it alone
}

/* ======================= PLAY (any app's song: scrolling tab, chords, fretboard) ======================= */
// What plays on the Mac (macOS "Now Playing": Spotify, YouTube in a browser, Music...) -> its Songsterr tab, pulled
// in the background -> the tab scrolls with the music, the chord of the bar playing now, what's coming.
// No tab (or "by ear"): the chords are worked out from the sound (MasterPrac's own ears), slowly and steadily.
const P = { info: null, tab: null, songId: null, track: null, mode: "jam", src: "tab", offset: 0, key: null, chord: "",
  barIdx: -1, beatIdx: -1, sig: "", PX: 150, nowNotes: [], nextNotes: [],
  ear: { smooth: Array(12).fill(0), acc: Array(12).fill(0), chord: null, cand: null, since: 0, keyCand: null, keySince: 0 } };
const STD = [64, 59, 55, 50, 45, 40];
const usingTab = () => P.src === "tab" && P.tab && !P.tab.error;
// where the player is right now (what it is SENDING to the speakers)
const playerPos = () => {
  const p = P.info;
  if (!p || !p.title) return 0;
  return p.pos + (p.playing ? Date.now() / 1000 - p.at : 0);
};
// where the tab should be: what you HEAR (speakers play a bit later, e.g. 0.24 s on Bluetooth) + the sync shift
// sync points heard along the song ({pos, off}). With 2+ points far apart the offset follows a straight line:
// a recording that is a little faster or slower than the tab's drifts, and the line follows that drift.
function offsetAt(pos) {
  const pts = SYNC.points || [];
  if (pts.length < 2) return P.offset;
  const span = pts[pts.length - 1].pos - pts[0].pos;
  if (span < 30) return P.offset;
  const n = pts.length, mx = pts.reduce((a, q) => a + q.pos, 0) / n, my = pts.reduce((a, q) => a + q.off, 0) / n;
  const sxx = pts.reduce((a, q) => a + (q.pos - mx) ** 2, 0), sxy = pts.reduce((a, q) => a + (q.pos - mx) * (q.off - my), 0);
  const b = sxx ? sxy / sxx : 0;
  if (Math.abs(b) > 0.05) return P.offset;  // more than 5% speed difference: not drift, something else
  return my + b * (pos - mx);
}
const playTime = () => {
  if (PR.on && PR.ready) return videoToTab(PR.yt.getCurrentTime() - ((P.info && P.info.latency) || 0));  // exact
  const pos = playerPos() - ((P.info && P.info.latency) || 0); return pos + offsetAt(pos);
};
// practice mode: a video's time -> tab time, through that video's own timing points (one per bar)
const PR = { on: false, ready: false, yt: null, kind: "song", vid: null };
function videoToTab(t) {
  const d = P.tab, pts = PR.vid && PR.vid.points;
  if (!d || !pts || pts.length < 2) return t;
  let i = 0; while (i < pts.length - 2 && pts[i + 1] <= t) i++;
  const bar = d.bars[Math.min(i, d.bars.length - 1)], span = Math.max(0.01, pts[i + 1] - pts[i]);
  return bar.t + ((t - pts[i]) / span) * (bar.end - bar.t);
}

async function pollNow() {
  if (tab !== "play" || PR.on) return;  // practice mode: the song is the one you picked
  let p;  // eslint-disable-line prefer-const
  try { p = await (await fetch(SYNC.on ? "/api/now?listen=1" : "/api/now")).json(); } catch (e) { return; }
  if (PR.on) return;  // practice started while this was on its way
  if (!p.title && P.info && P.info.title) p = { ...P.info, playing: false, pos: playerPos(), at: Date.now() / 1000 };  // paused: keep everything
  const changed = !P.info || P.info.title !== p.title || P.info.artist !== p.artist;
  P.info = p;
  $("#pl-app").textContent = p.title ? `${p.playing ? "PLAYING" : "PAUSED"} IN ${(p.app || "AN APP").toUpperCase()}` : "NOTHING PLAYING";
  if (!changed) return;
  $("#pl-title").textContent = p.title || "Play a song in any app";
  $("#pl-artist").textContent = p.title ? (p.artist || "Unknown artist") : "Spotify, YouTube, Apple Music... MasterPrac follows it.";
  const btn = $("#pl-open");
  btn.disabled = !p.title;
  btn.innerHTML = p.match ? "Open in Songsterr &#8599;" : "Search on Songsterr &#8599;";
  P.ear = { ...P.ear, chord: null, cand: null, acc: Array(12).fill(0), keyCand: null };
  P.key = null; P.chord = ""; P.sig = "";
  const id = p.match && p.match.id;
  if (id !== P.songId) {
    P.songId = id; P.tab = null; drawTab(); $("#tab-sync").classList.add("hidden");
    P.offset = Number(localStorage.getItem("pl-offset-" + id) || 0); showOffset();
    if (id) {
      const saved = localStorage.getItem("pl-track-" + id);
      await loadTab(id, saved === null ? null : Number(saved));
    } else { tabEmpty(p.title ? "Songsterr doesn't have this exact song: MasterPrac listens and works the chords out by ear." : "The song's tab scrolls here while it plays."); }
  }
  headsUp();
}
setInterval(pollNow, 1000);

// tabs are kept in memory per song + guitar part, so switching guitars is instant (and keeps the sync)
const TABS = new Map();
async function fetchTab(id, track) {
  const k = `${id}:${track ?? "auto"}`;
  if (TABS.has(k)) return TABS.get(k);
  let d;
  try { d = await (await fetch(`/api/now/tab/${id}` + (track !== null && track !== undefined ? `?lead=${track}` : ""))).json(); }
  catch (e) { d = { error: "Couldn't reach Songsterr." }; }
  if (!d.error) { TABS.set(k, d); TABS.set(`${id}:${d.lead}`, d); }
  if (TABS.size > 12) TABS.delete(TABS.keys().next().value);  // a few songs' worth, not more (memory)
  return d;
}
const isAcoustic = (t) => /acoustic|nylon|steel/i.test(`${t.instrument} ${t.name}`);
async function loadTab(id, track, keepSync) {
  if (!keepSync) tabEmpty("Pulling the tab from Songsterr...");
  let d = await fetchTab(id, track);
  if (P.songId !== id) return;  // the song changed meanwhile
  // no part chosen yet: the preferred kind (electric / acoustic), if that part plays a good share of the song
  const pref = $("#o-prefer").value;
  if ((track === null || track === undefined) && !d.error && pref !== "any") {
    const most = Math.max(...d.tracks.map((t) => t.played || 0));
    const want = d.tracks.filter((t) => (pref === "acoustic") === isAcoustic(t) && (t.played || 0) >= most * 0.5).sort((a, b) => b.played - a.played)[0];
    if (want && want.i !== d.lead) { d = await fetchTab(id, want.i); if (P.songId !== id) return; }
  }
  applyTab(d, keepSync);
  // get the next most-played guitar ready in the background (instant switch / auto-switch)
  if (!d.error) {
    const other = d.tracks.filter((t) => t.i !== d.lead).sort((a, b) => (b.played || 0) - (a.played || 0))[0];
    if (other) setTimeout(() => fetchTab(id, other.i), 1500);
  }
}
function applyTab(d, keepSync) {
  const id = P.songId;
  P.tab = d; P.track = d.lead; P.sig = ""; P.barIdx = -1; P.beatIdx = -1;
  if (!keepSync) { SYNC.recent = []; SYNC.shifts = []; SYNC.points = []; SYNC.state = ""; SYNC.shift = 0; SYNC.keyNote = ""; }
  if (d.error) { tabEmpty(esc(d.error) + " Chords by ear instead."); return; }
  P.key = { root: d.key.root, minor: d.key.minor };
  $("#tab-partbox").classList.toggle("hidden", d.tracks.length < 1);
  $("#tab-part").classList.add("hidden");
  partButtons();
  if (!keepSync) { P.lrc = []; P.lyBarIdx = undefined; }
  drawTab(); buildMap(); headsUp(); drawPlayBoard();
  if (!keepSync && !(d.lyrics && d.lyrics.length)) {  // no words in the tab: timed lines for the recording itself (LRCLIB)
    fetch("/api/lyrics").then((r) => r.json()).then((l) => { if (P.songId === id && l.lines && l.lines.length) { P.lrc = l.lines; P.lrcSyl = l.syl || []; drawTab(); } }).catch(() => {});
  }
}
// one button per guitar part: who plays it, electric or acoustic, how much of the song it plays (a little bar)
function partButtons() {
  const d = P.tab;
  $("#part-btns").classList.toggle("many", d.tracks.length > 4);
  const names = d.tracks.map(partName), seen = {};
  $("#part-btns").innerHTML = d.tracks.map((t, k) => {
    const share = Math.round(100 * (t.played || 0) / Math.max(1, d.bars.length));
    // two parts with the same name ("Acoustic Guitar (steel)" twice): number them
    const twins = names.filter((x) => x === names[k]).length, label = twins > 1 ? `${names[k]} ${(seen[names[k]] = (seen[names[k]] || 0) + 1)}` : names[k];
    return `<button class="part-b ${t.i === d.lead ? "on" : ""} ${P.autoFrom != null && t.i === d.lead ? "auto" : ""}" data-part="${t.i}" title="${esc(t.name)} · plays ${share}% of the song">
      <span class="pk">${isAcoustic(t) ? "AC" : "EL"}</span>${esc(label)}<i class="share"><b style="width:${share}%"></b></i></button>`;
  }).join("");
}
// "Thom Yorke | Takamine EN10C | Rhythm Guitar" -> "Thom Yorke · Rhythm Guitar"
function partName(t) {
  const bits = (t.name || "").split(/\s*\|\s*|\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  const name = (bits.length >= 3 ? [bits[0], bits[bits.length - 1]] : bits).join(" · ") || t.instrument || "Guitar";
  return name.length > 34 ? name.slice(0, 33) + "..." : name;  // player · role, short
}
function restNote(bi) {
  const d = P.tab, me = d.tracks.find((t) => t.i === d.lead), box = $("#tab-rest");
  if (!me || !me.active || me.active[bi] === "1" || me.active[bi + 1] === "1") { box.classList.add("hidden"); return; }
  let n = 0; while (bi + n < me.active.length && me.active[bi + n] !== "1") n++;
  const other = d.tracks.find((t) => t.i !== d.lead && t.active && t.active[bi] === "1");
  const left = bi + n >= me.active.length;
  box.innerHTML = other || !tabIncomplete()
    ? `${left ? "Part done" : `Rests ${n} bar${n > 1 ? "s" : ""}`}
      ${other ? `<button class="ghost" data-part="${other.i}" title="Follow ${esc(other.name || partName(other))} instead">Follow ${esc(partName(other).split(" · ").pop())}</button>` : ""}`
    : `No guitar written here`;
  box.classList.remove("hidden");
}
// an unfinished tab: even its busiest guitar part has notes in under a quarter of the bars
function tabIncomplete() {
  const d = P.tab, most = Math.max(0, ...d.tracks.map((t) => t.played || 0));
  return d.tracks.length && most < d.bars.length * 0.25 ? most : false;
}
function setPart(i) {
  if (!P.songId) return;
  localStorage.setItem("pl-track-" + P.songId, i);
  P.autoFrom = null; P.manualAt = Date.now();  // you chose it: the auto-switch leaves it alone for a while
  document.querySelectorAll("#part-btns [data-part]").forEach((b) => b.classList.toggle("on", b.dataset.part === String(i)));
  loadTab(P.songId, Number(i), true);  // same song: the sync stays
}
// auto-switch: your guitar rests for 2+ bars and another one plays -> show that one, and come back when yours returns
function autoPart(bi) {
  if (!$("#o-autopart").checked || !P.tab || P.tab.error || Date.now() - (P.manualAt || 0) < 30000) return;
  const d = P.tab, mine = P.autoFrom ?? d.lead, mineT = d.tracks.find((t) => t.i === mine);
  if (!mineT || !mineT.active) return;
  const plays = (t, b) => t.active && t.active[b] === "1";
  if (P.autoFrom != null && plays(mineT, bi)) {  // yours is back
    const back = TABS.get(`${P.songId}:${mine}`);
    if (back) { P.autoFrom = null; applyTab(back, true); toast("Back to your guitar"); }
    return;
  }
  if (P.autoFrom == null && !plays(mineT, bi) && !plays(mineT, bi + 1)) {
    const pref = $("#o-prefer").value;
    const cands = d.tracks.filter((t) => t.i !== mine && plays(t, bi))
      .sort((a, b) => ((pref !== "any" && (pref === "acoustic") === isAcoustic(b)) - (pref !== "any" && (pref === "acoustic") === isAcoustic(a))) || b.played - a.played);
    const to = cands[0] && TABS.get(`${P.songId}:${cands[0].i}`);
    if (to) { P.autoFrom = mine; applyTab(to, true); toast(`Your part rests: showing ${partName(cands[0])}`); }
    else if (cands[0]) fetchTab(P.songId, cands[0].i);  // get it ready for next time
  }
}

function tabEmpty(msg) {
  $("#tab-empty").innerHTML = msg; $("#tab-empty").classList.remove("hidden"); $("#tab-svg").classList.add("hidden");
}

// what the tab shows (its SHOW switches, remembered)
const TSHOW = { lyrics: true, chords: true, held: true, muted: true, tech: true, reps: false, strum: true };
try { Object.assign(TSHOW, JSON.parse(localStorage.getItem("pl-tshow") || "{}")); } catch (e) { /* defaults */ }
function tabChips() { document.querySelectorAll("[data-tshow]").forEach((b) => b.classList.toggle("on", !!TSHOW[b.dataset.tshow])); }
tabChips();
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tshow]");
  if (!b) return;
  TSHOW[b.dataset.tshow] = !TSHOW[b.dataset.tshow];
  try { localStorage.setItem("pl-tshow", JSON.stringify(TSHOW)); } catch (x) { /* fine */ }
  tabChips(); P.beatIdx = -1; P.lyIdx = -1; drawTab();
});

// the whole tab as one long strip; it slides left under a fixed playhead as the song plays
function drawTab() {
  const d = P.tab, svg = $("#tab-svg"), g = $("#tab-g");
  if (!d || d.error || !d.beats) { g.innerHTML = ""; return; }
  $("#tab-empty").classList.add("hidden"); svg.classList.remove("hidden");
  // spread the tab out for busy songs: the closest notes (10th percentile) get ~26 px between them
  const gaps = d.beats.slice(1).map((b, i) => b[0] - d.beats[i][0]).filter((x) => x > 0.02).sort((a, b) => a - b);
  P.PX = gaps.length ? Math.max(120, Math.min(320, 26 / gaps[Math.floor(gaps.length * 0.1)])) : 150;
  const Z = document.body.classList.contains("pl-focus") ? 1.45 : 1.2;  // the tab is drawn bigger (and bigger still in full screen)
  const PX = P.PX * (Z > 1.3 ? 1.25 : 1.1), y0 = Math.round(50 * (Z > 1.3 ? 1.25 : 1.1)), gap = Math.round(17 * Z), ys = (s) => y0 + s * gap, n = d.tuning.length, yEnd = ys(n - 1);
  P.PXdraw = PX;
  let h = "";
  const end = d.bars[d.bars.length - 1].end;
  h += d.tuning.map((_, s) => `<line class="tline" x1="0" y1="${ys(s)}" x2="${end * PX}" y2="${ys(s)}"/>`).join("");
  let lastChord = "";
  d.bars.forEach((b, i) => {
    const x = b.t * PX;
    h += `<line class="tbar" x1="${x}" y1="${y0}" x2="${x}" y2="${yEnd}"/><text class="tnum" x="${x + 3}" y="${y0 - 6 - 12 * (Z - 1)}">${i + 1}</text>`;
    if (b.section) h += `<text class="tsec" x="${x + 3}" y="14">${esc(b.section)}</text>`;
    if (TSHOW.chords && b.chord && b.chord !== lastChord) h += `<text class="tchord" x="${x + 3}" y="${Z > 1.3 ? 30 : 31}">${esc(spell(b.chord))}</text>`;
    lastChord = b.chord;
  });
  // techniques as shapes (no letters): hammer-on / pull-off = an arc to the next note on that string, slide = a slanted
  // line to it, slide in / out = a short slanted line, bend = an arrow up, vibrato = a wavy line, muted = x
  const lastOn = {};   // string -> {x, w, fl} of the previous note (to join arcs / slides)
  let tech = "";
  const flagWords = { pm: "P.M.", tr: "tremolo", wh: "whammy", gr: "grace" };  // (no "let ring" on every note: it's the normal way)
  // the same chord strummed again in the same bar: a light rhythm line instead of all the numbers again, so the eye
  // goes to where the chord CHANGES (numbers come back on a new chord / a new bar; Show > Repeated strums: numbers)
  let prevKey = "", prevBar = -1;
  d.beats.forEach(([t, dur, bar, notes, bf], i) => {
    const x = t * PX + 6;
    let s = `<g class="tb" id="tb${i}">`;
    const key = notes.filter((n) => !n[2].includes("t")).map((n) => `${n[0]}:${n[1]}:${n[2]}`).sort().join(" ");
    const plain = notes.every((n) => !/[hsiIoObBqvVHPg]/.test(n[2]));
    const repeat = !TSHOW.reps && notes.length >= 3 && plain && key === prevKey && bar === prevBar;
    prevKey = key; prevBar = bar;
    if (repeat) {
      const ss = notes.map((n) => n[0]), yA = ys(Math.min(...ss)), yB = ys(Math.max(...ss));
      s += `<rect class="tbg rep" x="${x - 1}" y="${yA - 4}" width="${10 * Z}" height="${yB - yA + 8}" rx="3"/><line class="trep" x1="${x + 4 * Z}" y1="${yA - 2}" x2="${x + 4 * Z}" y2="${yB + 2}"/>`;
      for (const [st] of notes) lastOn[st] = { x, w: 8 * Z, fl: "", f: 0 };
    }
    const muted = [];
    for (const [st, f, fl] of repeat ? [] : notes) {
      if (!TSHOW.held && fl.includes("t")) continue;  // still ringing: not picked again
      if (fl.includes("x")) { if (TSHOW.muted) muted.push(st); continue; }  // muted: one line, not a row of x's
      const label = fl.includes("x") ? "x" : /[HP]/.test(fl) ? `<${f}>` : fl.includes("g") || fl.includes("t") ? `(${f})` : String(f);
      const w = (label.length * 8 + 4) * Z, y = ys(st), prev = lastOn[st];
      s += `<rect class="tbg" x="${x - 2}" y="${y - 8 * Z}" width="${w}" height="${16 * Z}" rx="3"/><text class="tnote ${fl.includes("t") ? "tied" : ""}" x="${x}" y="${y + 5 * Z}">${esc(label)}</text>`;
      if (TSHOW.tech) {
        if (prev && /[h]/.test(prev.fl)) {  // hammer-on / pull-off: an arc from the previous note
          const x1 = prev.x + prev.w / 2, x2 = x + w / 2 - 4, top = y - 15 * Z;
          tech += `<path class="tq-arc" d="M${x1} ${y - 9 * Z} Q${(x1 + x2) / 2} ${top - 6 * Z} ${x2} ${y - 9 * Z}"/>`;
        }
        if (prev && /s/.test(prev.fl)) {   // slide: a slanted line from the previous note, up or down the neck
          const up = f > prev.f, x1 = prev.x + prev.w + 1, x2 = x - 3;
          tech += `<line class="tq-slide" x1="${x1}" y1="${y + (up ? 5 : -5) * Z}" x2="${x2}" y2="${y + (up ? -5 : 5) * Z}"/>`;
        }
        if (/[iI]/.test(fl)) tech += `<line class="tq-slide" x1="${x - 14 * Z}" y1="${y + (fl.includes("i") ? 5 : -5) * Z}" x2="${x - 3}" y2="${y + (fl.includes("i") ? -5 : 5) * Z}"/>`;
        if (/[oO]/.test(fl)) tech += `<line class="tq-slide" x1="${x + w + 1}" y1="${y + (fl.includes("O") ? 5 : -5) * Z}" x2="${x + w + 14 * Z}" y2="${y + (fl.includes("O") ? -5 : 5) * Z}"/>`;
        if (/[bBq]/.test(fl)) {           // bend: a curved arrow up, size by the step
          const hgt = (fl.includes("B") ? 15 : fl.includes("b") ? 11 : 7) * Z, bx = x + w + 2;
          tech += `<path class="tq-bend" d="M${bx} ${y} Q${bx + 9 * Z} ${y} ${bx + 9 * Z} ${y - hgt}"/><path class="tq-head" d="M${bx + 9 * Z - 4} ${y - hgt + 5} L${bx + 9 * Z} ${y - hgt} L${bx + 9 * Z + 4} ${y - hgt + 5}"/>`;
          if (fl.includes("r")) tech += `<path class="tq-bend" d="M${bx + 9 * Z} ${y - hgt} Q${bx + 18 * Z} ${y - hgt} ${bx + 18 * Z} ${y}"/>`;
        }
        if (/[vV]/.test(fl)) {            // vibrato: a wavy line above the note
          const vx = x - 1, vy = y - 12 * Z, amp = (fl.includes("V") ? 3 : 2) * Z;
          let path = `M${vx} ${vy}`;
          for (let k = 1; k <= 6; k++) path += ` Q${vx + (k - 0.5) * 3.5 * Z} ${vy + (k % 2 ? -amp : amp)} ${vx + k * 3.5 * Z} ${vy}`;
          tech += `<path class="tq-vib" d="${path}"/>`;
        }
      }
      lastOn[st] = { x, w, fl, f };
    }
    if (muted.length) {  // muted (scratchy) hit: a grey line across the muted strings
      const yA = ys(Math.min(...muted)) - 6 * Z, yB = ys(Math.max(...muted)) + 6 * Z;
      s += muted.length > 1 ? `<line class="tmute" x1="${x + 4 * Z}" y1="${yA}" x2="${x + 4 * Z}" y2="${yB}"/>`
        : `<line class="tmute" x1="${x}" y1="${yB}" x2="${x + 8 * Z}" y2="${yA}"/>`;
    }
    if (bf && (TSHOW.tech || TSHOW.strum)) {
      const words = bf.split(" ").map((k) => flagWords[k]).filter(Boolean).join(" · ");
      if (words && TSHOW.tech) s += `<text class="tflag" x="${x}" y="${yEnd + 16 * Z}">${words}</text>`;
      if (TSHOW.strum && /\bs[du]\b/.test(bf)) {  // strum direction: an arrow under the strings (Show > Strum arrows)
        const dn = /\bsd\b/.test(bf);
        s += `<path class="tq-strum" d="M${x + 4} ${yEnd + (dn ? 22 : 34) * Z} L${x + 4} ${yEnd + (dn ? 34 : 22) * Z} M${x} ${yEnd + (dn ? 30 : 26) * Z} L${x + 4} ${yEnd + (dn ? 34 : 22) * Z} L${x + 8} ${yEnd + (dn ? 30 : 26) * Z}"/>`;
      }
    }
    h += s + "</g>";
  });
  h += `<g class="tq">${tech}</g>`;
  // lyrics: ONE lane, moving with the tab. Every syllable starts exactly where it's sung (never pushed later, so it
  // reaches the playhead when it's sung); when words come fast they get squeezed narrower instead. A long-held
  // syllable gets dashes up to the next one. Songsterr keeps the words on only some parts: keep the song's words.
  if (d.lyrics && d.lyrics.length) P.lyKeep = { song: P.songId, lyrics: d.lyrics };
  const words = d.lyrics && d.lyrics.length ? d.lyrics : P.lyKeep && P.lyKeep.song === P.songId ? P.lyKeep.lyrics : [];
  P.lyDrawn = TSHOW.lyrics ? words : [];
  const fs = 17 * Z, cw = fs * 0.56, ly0 = yEnd + 56 * Z;  // below the technique words + strum arrows: nothing overlaps
  // where a word goes: always at its exact moment and normal width. One lane; when a word would run into the one
  // before it (fast singing, rap) it goes on a second lane just below instead of being squeezed or pushed late
  const lanes = [-1e9, -1e9], laneY = [ly0, ly0 + 19 * Z];
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = `700 ${fs}px -apple-system, "SF Pro Rounded", sans-serif`;
  const width = (t) => meas.measureText(t).width;
  const place = (x, text, join, newLine) => {
    const w = width(text), gap = join ? 2 : newLine ? cw * 1.2 : cw * 0.45, nudge = cw * 1.1;
    let L, at = x;
    if (x >= lanes[0] + gap) L = 0;
    else if (lanes[0] + gap - x <= nudge) { L = 0; at = lanes[0] + gap; }  // just a little crowded: nudge it (~0.05 s)
    else if (x >= lanes[1] + gap) L = 1;                                    // really crowded: the lane below
    else { L = lanes[0] <= lanes[1] ? 0 : 1; at = lanes[L] + gap; }
    lanes[L] = at + w;
    return { y: laneY[L], x: at, end: at + w, L };
  };
  const dashes = (from, to, L, max) => {  // a held syllable: dashes over the gap, on its lane
    const gap = to - from;
    if (gap < (max === 1 ? cw * 0.9 : cw * 3)) return;
    const n = max === 1 ? 1 : Math.min(max, Math.floor(gap / (cw * 2.2)));
    for (let k = 1; k <= n; k++) h += `<text class="tlyric dash" x="${(from + (gap * k) / (n + 1) - cw / 2).toFixed(1)}" y="${laneY[L]}">-</text>`;
    lanes[L] = Math.max(lanes[L], to - cw);
  };
  P.lyDrawn.forEach(([t, syl, nl], i) => {
    const x = t * PX + 6, text = syl.replace(/-$/, ""), next = P.lyDrawn[i + 1], prev = P.lyDrawn[i - 1];
    const q = place(x, text, prev && prev[1].endsWith("-") && !nl, nl);
    h += `<text class="tlyric ${nl ? "first" : ""}" id="ly${i}" x="${q.x.toFixed(1)}" y="${q.y}">${esc(text)}</text>`;
    const nx = next ? next[0] * PX + 6 : Infinity;
    if (next && !next[2] && nx - q.end > cw * 4) dashes(q.end + cw * 0.3, nx - cw * 0.3, q.L, 12);       // held long
    else if (syl.endsWith("-") && next && nx - q.end > cw * 0.9) dashes(q.end, nx, q.L, 1);             // inside a word: ev-er
  });
  // timed lines from LRCLIB (no words in the tab): they only know when each LINE starts. So each line is spread over
  // the time it's sung (up to the next line), every word given time by its syllables: the words pass the playhead
  // about when they're sung instead of the whole line flying by. Times = recording time + the sync shift.
  P.lrcDrawnAt = lrcSig(); P.lrcWords = [];
  const toTab = (r) => r + offsetAt(r);  // recording time -> tab time: the same sync the tab follows (it can change along the song)
  const lrc = TSHOW.lyrics && !P.lyDrawn.length ? P.lrc || [] : [];
  // each word split into syllables by the server (Turkish rules / English dictionary: "Yak-laş-tır-sa-na"),
  // the syllables sung at an even pace; the line's LAST syllable is held until the next line comes (dashes), the way
  // singers stretch the end of a line ("elseeeewheeere")
  lrc.forEach(([t, line], i) => {
    const words = line.split(/\s+/).filter(Boolean);
    if (!words.length) return;
    const syl = (P.lrcSyl && P.lrcSyl[i] && P.lrcSyl[i].length) ? P.lrcSyl[i] : words.map((w) => [w]), n = syl.reduce((a, w) => a + w.length, 0);
    const t0 = toTab(t), next = lrc[i + 1] ? toTab(lrc[i + 1][0]) : t0 + 8, avail = Math.max(0.6, next - t0 - 0.3);
    const pace = Math.min(0.34, (avail * 0.8) / n);  // seconds per syllable
    const holdEnd = Math.min(t0 + avail, t0 + n * pace + 2.5);
    let k = 0;
    syl.forEach((parts, wi) => {
      parts.forEach((sy, si) => {
        const st = t0 + k * pace, sx = st * PX + 6, lastOfLine = wi === syl.length - 1 && si === parts.length - 1;
        const id = `lr${i}s${k}`;
        const q = place(sx, sy, si > 0, k === 0);
        h += `<text class="tlyric ${k ? "" : "first"}" id="${id}" x="${q.x.toFixed(1)}" y="${q.y}">${esc(sy)}</text>`;
        if (si < parts.length - 1) {  // inside a word: a dash to the next syllable
          const nx = (t0 + (k + 1) * pace) * PX + 6;
          if (nx - q.end > cw * 0.9) dashes(q.end, nx, q.L, 1);
        }  // (no dashes after the end of a line: the singer simply stops)
        P.lrcWords.push([st, id]);
        k++;
      });
    });
  });
  g.innerHTML = h;
  // string names stay put on the left while the tab slides under them
  $("#tab-names").innerHTML = `<rect class="tnames-bg" x="0" y="${y0 - 10}" width="24" height="${yEnd - y0 + 20}"/>` +
    d.tuning.map((open, s) => `<text class="tname" x="12" y="${ys(s) + 4}">${nn(open % 12)}</text>`).join("");
  layoutTab();
}
// what the LRCLIB lines were placed with: when it changes, they're drawn again
const lrcSig = () => `${P.offset.toFixed(3)}|${(SYNC.points || []).length}|${offsetAt(60).toFixed(3)}`;
function layoutTab() {
  const svg = $("#tab-svg"), W = svg.clientWidth || 1000, H = svg.clientHeight || 170;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const hx = Math.round(W * 0.22);
  const head = $("#tab-head");
  head.setAttribute("x1", hx); head.setAttribute("x2", hx); head.setAttribute("y1", 38); head.setAttribute("y2", H - 6);
  P.headX = hx;
}
new ResizeObserver(() => { layoutTab(); drawPlayBoard(); }).observe($("#tabstrip"));

function playTick() {
  if (tab !== "play") return;
  const p = P.info, t = playTime();
  if (p && p.title) {
    const shown = Math.max(0, playerPos());
    $("#pl-pos").textContent = fmtT(shown); $("#pl-dur").textContent = fmtT(p.duration || 0);
    $("#pl-fill").style.width = p.duration ? `${Math.min(100, (shown / p.duration) * 100)}%` : "0";
  }
  if (!usingTab()) return;
  const d = P.tab;

  const last = d.bars[d.bars.length - 1];
  if (t > last.end + 3) {  // past the end of the tab: a longer version, or not this song
    if (P.sig !== "end") {
      P.sig = "end"; setChord("", "");
      $("#pl-section").textContent = "After the tab"; $("#pl-barno").textContent = `tab ends at ${fmtT(last.end)}`;
      $("#pl-next").textContent = "-"; $("#pl-in").textContent = "";
      headsUp(`This is ${fmtT(t)} in but the tab ends at ${fmtT(last.end)}: maybe a longer version (or not a song). Try Options → by ear.`);
    }
    return;
  }
  const bi = Math.max(0, lastAt(d.bars, t, (b) => b.t)), bar = d.bars[bi];
  const nextBar = d.bars.slice(bi + 1).find((b) => b.chord && b.chord !== bar.chord);
  $("#pl-in").textContent = nextBar ? `in ${Math.max(0, nextBar.t - t).toFixed(1)} s` : "";
  // the note(s) sounding now and the ones coming in the next ~1.2 s (Learn mode)
  const bt = lastAt(d.beats, t, (b) => b[0]);
  const ei = lastAt(d.events, t, (e) => e[0]);
  const cur = ei >= 0 && t < d.events[ei][0] + d.events[ei][1] ? d.events[ei] : null;
  if (bt !== P.beatIdx) {
    document.getElementById("tb" + P.beatIdx)?.classList.remove("on");
    if (bt >= 0 && t < d.beats[bt][0] + d.beats[bt][1]) document.getElementById("tb" + bt)?.classList.add("on");
    P.beatIdx = bt;
  }
  if (P.lrc && P.lrc.length && !(P.lyDrawn && P.lyDrawn.length)) {
    if (P.lrcDrawnAt !== lrcSig()) drawTab();  // the sync changed: move the lines with it
    const wi = lastAt(P.lrcWords || [], t, (x) => x[0]), id = wi >= 0 ? P.lrcWords[wi][1] : "";
    if (id !== P.lrIdx) { if (P.lrIdx) document.getElementById(P.lrIdx)?.classList.remove("on"); if (id) document.getElementById(id)?.classList.add("on"); P.lrIdx = id; }
  }
  if (P.lyDrawn && P.lyDrawn.length) {  // light up the syllable being sung
    const li = lastAt(P.lyDrawn, t, (x) => x[0]);
    if (li !== P.lyIdx) { document.getElementById("ly" + P.lyIdx)?.classList.remove("on"); document.getElementById("ly" + li)?.classList.add("on"); P.lyIdx = li; }
  }
  const sig = `${bi}|${notesShown() ? bt + "|" + ei + "|" + (cur ? 1 : 0) : ""}`;
  if (sig === P.sig) return;
  P.sig = sig;
  // from the tab's beats (they carry techniques: slides, hammer-ons, bends...): [string, fret, flags]
  const bnow = bt >= 0 && t < d.beats[bt][0] + d.beats[bt][1] ? d.beats[bt] : null;
  P.nowNotes = bnow ? bnow[3].filter((n) => !n[2].includes("t")) : (cur ? cur[2].map(([a, b]) => [a, b, ""]) : []);
  if (bt !== FX.beat && !FX.freeze) fxBeat(d, bt, bnow);  // (freeze: for testing the drawing)
  P.nextNotes = d.beats.slice(bt + 1).filter((b) => b[0] - t < 1.2 && b[3].length).slice(0, 4).flatMap((b) => b[3].filter((n) => !n[2].includes("t")));
  if (bi !== P.barIdx) {
    P.barIdx = bi;
    const section = d.bars.slice(0, bi + 1).reverse().find((b) => b.section)?.section || "Start";
    $("#pl-section").textContent = section;
    $("#pl-barno").textContent = `bar ${bi + 1} of ${d.bars.length}`;
    $("#pl-next").textContent = nextBar ? spell(nextBar.chord) : "-";
    document.querySelectorAll("#pl-map .ch").forEach((el) => el.classList.toggle("now", bi >= +el.dataset.from && bi <= +el.dataset.to));
    setChord(bar.chord || "", nextBar ? nextBar.chord : "");
    restNote(bi);
    autoPart(bi);
    headsUp();
  } else drawPlayBoard();
}
setInterval(playTick, 50);  // a timer, not animation frames: keeps going when the window is in the background

function setChord(name, next) {
  P.chord = name;
  $("#pl-chord").textContent = spell(name) || "-";
  const k = P.key;
  $("#pl-key").textContent = k ? `${nn(k.root)} ${k.minor ? "minor" : "major"}` : "listening...";
  $("#pl-keysub").textContent = !k ? "" : usingTab() ? `from the tab${P.tab.tempo ? ` · ${Math.round(P.tab.tempo)} BPM` : ""}` : "heard from the music";
  foot(next);
  drawPlayBoard();
}

// things worth knowing about what's coming: tuning, the next part, techniques, the tab author's notes
const TECH = { b: "bends", B: "big bends (a whole step)", s: "slides", i: "slides into notes", I: "slides into notes", o: "slides out", O: "slides out", h: "hammer-ons / pull-offs", x: "muted (scratchy) notes", v: "vibrato", H: "harmonics",
  pm: "palm mute (rest your picking hand on the strings)", tr: "fast tremolo picking" };  // (no "let ring" tip: it's the normal way)
function headsUp(extra) {
  const out = [], d = usingTab() ? P.tab : null;
  if (extra) out.push(extra);
  if (d && SYNC.keyNote) out.push(SYNC.keyNote);
  if (d) {
    const bi = Math.max(0, P.barIdx);
    if (JSON.stringify(d.tuning) !== JSON.stringify(STD)) out.push(`<b>Tuning: ${esc(d.tuning_name)}</b>: tune your guitar to this first.`);
    const most = tabIncomplete();
    if (most !== false) out.push(`<b>Unfinished tab:</b> Songsterr only has guitar written for ${most} of ${d.bars.length} bars (no better version there). Chords still work.
      <button class="ghost mini" data-othertabs>Look on Ultimate Guitar</button>`);
    const nextSec = d.bars.slice(bi + 1).findIndex((b) => b.section);
    if (nextSec >= 0 && nextSec < 4) out.push(`<b>${esc(d.bars[bi + 1 + nextSec].section)}</b> ${nextSec === 0 ? "starts next bar" : `in ${nextSec + 1} bars`}.`);
    const soon = d.beats.filter((b) => b[2] >= bi && b[2] <= bi + 2);
    const tech = new Set();
    soon.forEach(([, , , notes, bf]) => { notes.forEach((n) => [...n[2]].forEach((c) => TECH[c] && c !== "t" && tech.add(TECH[c]))); bf.split(" ").forEach((f) => TECH[f] && tech.add(TECH[f])); });
    if (tech.size) out.push(`Coming up: ${[...tech].join(", ")}.`);
    const note = d.beats.find((b) => b[5] && b[2] >= bi - 1 && b[2] <= bi + 2);
    if (note) out.push(`Tab note: "${esc(note[5].slice(0, 140))}${note[5].length > 140 ? "..." : ""}"`);
  } else if (P.info && P.info.title) out.push(P.src === "ear" || !P.info.match ? "Chords by ear: a change shows after about a bar." : "Pulling the tab from Songsterr...");
  $("#pl-heads-list").innerHTML = out.slice(0, 4).map((x) => `<li>${x}</li>`).join("");
  $("#pl-heads").classList.toggle("quiet", !out.length);  // nothing to say: the box steps aside
}

// under the fretboard: what to do, in one line
function foot(next) {
  const k = P.key, c = chordInfo(P.chord), n = chordInfo(next);
  if (!k) { $("#pl-foot").innerHTML = ""; return; }
  const chip = (pc) => `<span class="${pc === k.root ? "root" : c && c.tones.includes(pc) ? "chord" : ""}">${nn(pc)}</span>`;
  if (P.mode === "learn") {
    const how = (fl = "") => /[siIoO]/.test(fl) ? " (slide)" : fl.includes("h") ? " (hammer-on / pull-off)" : fl.includes("B") ? " (bend a whole step)" : fl.includes("b") ? " (bend)" : fl.includes("v") ? " (vibrato)" : fl.includes("x") ? " (muted)" : "";
    const strs = P.nowNotes.map(([s, f, fl]) => `string ${s + 1} fret ${f}${how(fl)}`).join(", ");
    $("#pl-foot").innerHTML = `<div><span class="kicker">PLAY NOW</span> ${strs ? `<b>${strs}</b>` : `<span class="sub">rest</span>`}</div>
      <div class="sub"><i class="dot play"></i>red = play this now &nbsp; <i class="dot next"></i>dashed = coming next &nbsp; numbers = frets &nbsp; string 1 = thinnest</div>`;
    return;
  }
  const lowE = ((k.root - (P.tab && usingTab() ? P.tab.tuning[P.tab.tuning.length - 1] : 40)) % 12 + 12) % 12;
  $("#pl-foot").innerHTML = `
    <div title="The 5 notes of the key's pentatonic scale: play any of them over this song and it won't sound wrong. Orange = the home note."><span class="kicker">SAFE NOTES</span> <span class="notes">${SCALES.pent(k.minor).map((i) => chip((k.root + i) % 12)).join("")}</span></div>
    <div><span class="kicker">LAND ON NOW</span> <span class="notes">${c ? c.tones.map((pc) => `<span class="chord">${nn(pc)}</span>`).join("") : "-"}</span>
      ${n ? `<span class="sub">then ${esc(spell(next))}: ${n.tones.map((pc) => nn(pc)).join(" ")}</span>` : ""}</div>
    <div class="sub foot-help">Safe notes: any of them sound fine over the whole song. Land on now: the notes of the chord playing now, the best ones to end a phrase on. Start at <b>${lowE === 0 ? "the open thickest string (or fret 12)" : `fret ${lowE} of the thickest string`}</b>: that's ${nn(k.root)}, home.</div>`;
}

// what the fretboard shows (the SHOW switches); Jam and Learn each remember their own
const SHOW = { jam: { now: false, next: false, chord: true, scale: true }, learn: { now: true, next: true, chord: false, scale: true } };
try { Object.assign(SHOW, JSON.parse(localStorage.getItem("pl-show") || "{}")); } catch (e) { /* defaults */ }
const show = () => SHOW[P.mode];
const notesShown = () => show().now || show().next;
function showChips() {
  document.querySelectorAll("[data-show]").forEach((b) => b.classList.toggle("on", !!show()[b.dataset.show]));
}
function drawPlayBoard() {
  if (tab !== "play") return;
  const k = P.key, c = chordInfo(P.chord), which = $("#o-scale").value, sh = show();
  let key = k, scale = k ? SCALES[which](k.minor) : [];
  if (which === "chord" && c) { key = { root: c.root, minor: c.minor }; scale = [0]; }
  fretboard($("#pl-board"), { tuning: usingTab() ? P.tab.tuning : STD, key, scale: sh.scale ? scale : [],
    chordTones: sh.chord && c ? c.tones : [], labels: $("#o-labels").value, area: $("#o-area").value,
    dim: notesShown() && (sh.scale || sh.chord),  // the guitarist's notes stand out over faded safe notes
    frets: notesShown() && usingTab() ? Math.min(22, Math.max(15, ...P.tab.events.flatMap((e) => e[2].map((x) => x[1] + 1)))) : 15,
    now: sh.now ? P.nowNotes : [], next: sh.next ? P.nextNotes : [], ahead: P.nextNotes, animate: sh.now && usingTab() });
  if (sh.now && usingTab()) fxDraw();  // bubbles drawn in the same step as the board: never a frame without them
  if (P.mode === "learn") foot();
}
showChips();

// close / open the tab and the fretboard (remembered)
let collapsed = [];
try { collapsed = JSON.parse(localStorage.getItem("pl-collapsed") || "[]"); } catch (e) { /* none */ }
function applyCollapsed() {
  document.querySelectorAll("[data-body]").forEach((el) => el.classList.toggle("hidden", collapsed.includes(el.dataset.body)));
  document.querySelectorAll("[data-panel]").forEach((el) => el.classList.toggle("collapsed", collapsed.includes(el.dataset.panel)));
  drawTab(); drawPlayBoard();
}

// full screen: just the chord, the tab and the fretboard (Esc or the button to leave)
function setFull(on) {
  document.body.classList.toggle("pl-focus", on);
  $("#pl-full").textContent = on ? "Leave full screen" : "Full screen";
  // entering also puts the window in macOS full screen; leaving only leaves the focus view (the app stays full screen)
  if (on && api() && api().fullscreen) api().fullscreen(true);
  setTimeout(() => { drawTab(); layoutTab(); drawPlayBoard(); }, 400);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("pl-focus")) setFull(false); });

// the song's chord map (pop-up): one row per part, chords in order, repeats merged
function buildMap() {
  const d = P.tab;
  if (!d || d.error) { $("#pl-map").innerHTML = `<p class="explain">No tab for this song: no chord map.</p>`; return; }
  const secs = [];
  d.bars.forEach((b, i) => {
    if (b.section || !secs.length) secs.push({ name: b.section || "Start", from: i, chords: [] });
    const s = secs[secs.length - 1], last = s.chords[s.chords.length - 1];
    if (b.chord && (!last || last.name !== b.chord)) s.chords.push({ name: b.chord, from: i, to: i });
    else if (last) last.to = i;
  });
  $("#pl-map").innerHTML = secs.map((s) => `<div class="sec"><b>${esc(s.name)}</b><span class="sub">bar ${s.from + 1}</span>${s.chords.map((c) =>
    `<span class="ch" data-from="${c.from}" data-to="${c.to}">${esc(spell(c.name))}</span>`).join("") || `<span class="sub">no chords</span>`}</div>`).join("");
}

// by ear: 1.2 s average, chords in the key preferred, a change must hold ~1.6 s
async function playEar() {
  if (tab !== "play" || usingTab() || !(P.info && P.info.title)) return;
  let d;
  try { d = await (await fetch("/api/live")).json(); } catch (e) { return; }
  if (!d.live || d.rms < 0.004) {
    $("#pl-section").textContent = d.error ? "Can't hear" : "Silent"; $("#pl-barno").textContent = d.error ? "see Heads up" : "";
    if (d.error && d.error !== P.earError) { P.earError = d.error; headsUp(esc(d.error)); }
    return;
  }
  if (P.earError) { P.earError = null; headsUp(); }
  $("#pl-section").textContent = "by ear"; $("#pl-barno").textContent = ""; $("#pl-next").textContent = "?"; $("#pl-in").textContent = "";
  const e = P.ear, kk = Math.exp(-0.12 / 1.2), now = performance.now() / 1000;
  e.smooth = e.smooth.map((v, i) => v * kk + d.chroma[i] * (1 - kk));
  e.acc = e.acc.map((v, i) => v * 0.997 + d.chroma[i]);
  const g = guessKey(e.acc);
  if (!e.keyCand || g.root !== e.keyCand.root || g.minor !== e.keyCand.minor) { e.keyCand = g; e.keySince = now; }
  if (!P.key || (now - e.keySince > 8 && (P.key.root !== g.root || P.key.minor !== g.minor))) P.key = { root: g.root, minor: g.minor };
  const cand = detectChord(e.smooth, P.key), id = (x) => x && `${x.root}${x.q}`;
  if (!e.chord || (id(cand) !== id(e.chord) && id(cand) === id(e.cand) && now - e.since > 1.6 && cand.margin > 0.05)) {
    e.chord = cand; setChord(nn(cand.root) + cand.q, "");
  } else if (id(cand) !== id(e.cand)) { e.cand = cand; e.since = now; }
}
setInterval(playEar, 120);

/* ---------- auto-sync: slide the tab until what MasterPrac hears matches what the tab says should sound ---------- */
// Songsterr times its tab to one recording (often a YouTube video); Spotify's version may start earlier or later.
// Every ~150 ms: what's sounding now (12 note strengths) + where the player says we are. Every 3 s: try every shift
// from -10 s to +10 s, score how well the heard notes match the tab's fingerprint, and lock onto the best one.
const SYNC = { on: true, state: "", score: 0 };
try { SYNC.on = localStorage.getItem("pl-autosync") !== "off"; } catch (e) { /* fine */ }
$("#o-autosync").checked = SYNC.on;
// every 2.5 s the server listens to the last ~20 s and compares it with the tab (sync.py): notes to get close,
// then the attacks of every instrument (drums, bass, guitars) to within ~10 ms
async function syncListen() {
  if (tab !== "play" || !SYNC.on || !usingTab() || !(P.info && P.info.playing) || SYNC.busy) return;
  // every second until it has locked on, then every 2.5 s
  if (SYNC.state === "locked" && performance.now() - (SYNC.lastAsk || 0) < (POWER.battery ? 4900 : 2400)) return;
  SYNC.lastAsk = performance.now();
  SYNC.busy = true;
  let d;
  const nowOff = offsetAt(playerPos());
  const q = SYNC.state === "locked" ? `?near=${nowOff.toFixed(2)}` : "";
  try { d = await (await fetch(`/api/sync/${P.tab.song_id}${q}`)).json(); } catch (e) { SYNC.busy = false; return; }
  SYNC.busy = false;
  if (d.error && d.error !== P.earError) { P.earError = d.error; headsUp(esc(d.error)); }
  const r = d.result;
  if (!r) { if (SYNC.state !== "locked") syncStatus(d.error ? "Can't hear the music: see Heads up" : "Listening to sync..."); return; }
  SYNC.score = r.note_score;
  // only clear answers count: a strong note match that stands out, and not stuck at the edge of the search (+-10 s)
  const sure = r.note_score > 0.5 && r.note_conf > 0.15 && Math.abs(r.coarse) < 9.8;
  if (!sure) { if (SYNC.state !== "locked") syncStatus("Listening to sync... (not sure yet)"); return; }
  // which key the recording is in: switch only after 3 answers in a row agree (one-off answers are ignored)
  SYNC.shifts = [...(SYNC.shifts || []), r.shift].slice(-3);
  if (r.shift !== (SYNC.shift || 0) && SYNC.shifts.length === 3 && SYNC.shifts.every((x) => x === r.shift)) {
    SYNC.shift = r.shift; SYNC.recent = [];
    const up = r.shift <= 6 ? r.shift : r.shift - 12;
    SYNC.keyNote = r.shift ? `<b>This recording is ${Math.abs(up)} half-step${Math.abs(up) > 1 ? "s" : ""} ${up > 0 ? "higher" : "lower"} than the tab.</b> ${up > 0 ? `Put a capo on fret ${up} and play the tab as written.` : `Tune down ${-up} half-step${up < -1 ? "s" : ""} to play along.`}` : "";
    headsUp();
  }
  if (r.shift !== (SYNC.shift || 0)) return;  // an answer for another key than the one we're in: not a timing
  let raw = r.attack_conf >= 1.8 ? r.offset : r.coarse;  // precise attacks when they stand out, else the note match
  // a far answer that is only a little better than the timing we're at = the same riff a few bars away: stay
  if (SYNC.state === "locked" && Math.abs(raw - nowOff) > 1.5 && r.near_coarse != null && r.near_score >= r.note_score - 0.04) {
    raw = Math.abs(r.offset - r.near_coarse) < 0.3 ? r.offset : r.near_coarse;
  }
  // the middle of the last 3 answers: one odd reading is ignored, a real change wins after 2 checks
  SYNC.recent = [...(SYNC.recent || []), raw].slice(-3);
  const sorted = [...SYNC.recent].sort((a, b) => a - b), target = sorted[Math.floor(sorted.length / 2)];
  // a sync point at this place in the song (for following drift); points that disagree a lot with the line are dropped
  const here = playerPos();
  SYNC.points = [...(SYNC.points || []).filter((p) => Math.abs(p.pos - here) > 4), { pos: here, off: target }]
    .sort((a, b) => a.pos - b.pos).slice(-24);
  if (SYNC.points.length >= 4) {
    const fit = SYNC.points.map((p) => ({ ...p, err: Math.abs(p.off - offsetAt(p.pos)) }));
    SYNC.points = fit.filter((p) => p.err < 0.6).map(({ pos, off }) => ({ pos, off }));
  }
  if (Math.abs(target - P.offset) >= 0.03) {  // small wobbles are ignored, real changes are followed
    P.offset = Math.round(target * 100) / 100; showOffset(); P.sig = "";
    if (P.songId) localStorage.setItem("pl-offset-" + P.songId, P.offset);
  }
  SYNC.state = "locked";
  const dr = (SYNC.points || []).length >= 2 && SYNC.points[SYNC.points.length - 1].pos - SYNC.points[0].pos >= 30;
  syncStatus(`In sync ${P.offset >= 0 ? "+" : ""}${P.offset.toFixed(2)} s${dr ? " · following speed" : ""}`, true);
}
setInterval(syncListen, 1000);
function syncStatus(text, ok) {
  const el = $("#tab-sync");
  el.textContent = text; el.classList.toggle("ok", !!ok); el.classList.toggle("hidden", !SYNC.on || !usingTab());
}
$("#o-autosync").addEventListener("change", (e) => {
  SYNC.on = e.target.checked; SYNC.recent = []; SYNC.state = "";
  try { localStorage.setItem("pl-autosync", SYNC.on ? "on" : "off"); } catch (x) { /* fine */ }
  syncStatus("Listening to sync...");
});

function showOffset() { $("#o-off").textContent = `${P.offset >= 0 ? "+" : ""}${P.offset.toFixed(2)} s`; }
function scaleHelp() { $("#o-scale-help").textContent = SCALE_HELP[$("#o-scale").value]; }
scaleHelp();
["o-scale", "o-labels", "o-area"].forEach((id) => $("#" + id).addEventListener("change", () => { scaleHelp(); drawPlayBoard(); }));
$("#tab-part").addEventListener("change", (e) => setPart(e.target.value));
document.addEventListener("click", (e) => { const b = e.target.closest("[data-part]"); if (b) setPart(b.dataset.part); });
$("#o-src").addEventListener("change", (e) => {
  P.src = e.target.value; P.sig = ""; P.barIdx = -1; P.ear.chord = null;
  if (usingTab()) { P.key = { root: P.tab.key.root, minor: P.tab.key.minor }; drawTab(); }
  else tabEmpty("Chords by ear: MasterPrac listens to the music and works out the chords.");
  headsUp();
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.mode) {
    P.mode = b.dataset.mode; P.sig = "";
    document.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === b));
    document.body.classList.toggle("mode-learn", P.mode === "learn");
    showChips(); P.sig = ""; foot(); headsUp(); drawPlayBoard();
    toast(P.mode === "jam" ? "Jam: make up your own part. The fretboard shows the safe notes and the chord now"
      : "Learn the part: copy the guitarist. The fretboard shows exactly what they play");
  }
  if (b.id === "pl-options") setTab("settings");
  if (b.id === "pl-full") setFull(!document.body.classList.contains("pl-focus"));
  if (b.dataset.show) {
    show()[b.dataset.show] = !show()[b.dataset.show];
    try { localStorage.setItem("pl-show", JSON.stringify(SHOW)); } catch (x) { /* fine */ }
    showChips(); P.sig = ""; drawPlayBoard();
  }
  if (b.dataset.collapse) {
    const id = b.dataset.collapse;
    collapsed = collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id];
    try { localStorage.setItem("pl-collapsed", JSON.stringify(collapsed)); } catch (x) { /* fine */ }
    applyCollapsed();
  }
  if (b.id === "pl-chords") setSheet(!document.body.classList.contains("sheet-mode"));
  if (b.dataset.nudge && P.songId) {
    if (SYNC.on) { SYNC.on = false; $("#o-autosync").checked = false; syncStatus(""); toast("Auto-sync off: you're setting the timing"); }
    SYNC.points = [];
    P.offset = Math.round((P.offset + Number(b.dataset.nudge)) * 100) / 100;
    localStorage.setItem("pl-offset-" + P.songId, P.offset); showOffset();
  }
  if (b.dataset.othertabs !== undefined && api() && P.info) {  // other tab sites, inside the built-in browser
    api().browser_go(`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(`${P.info.artist} ${P.info.title}`.trim())}`);
    setTab("songsterr");
  }
  if (b.id === "pl-open" && api() && P.info && P.info.title) {
    if (P.info.match) api().browser_go(P.info.match.url); else api().browser_search(`${P.info.artist} ${P.info.title}`.trim());
    setTab("songsterr");
  }
});

/* ======================= AMP & TONE ======================= */
const dial = (label, v) => {
  const a = -135 + (Math.max(0, Math.min(10, v)) / 10) * 270, r = 22;
  const x = 30 + r * Math.sin(a * Math.PI / 180), y = 30 - r * Math.cos(a * Math.PI / 180);
  return `<div class="dial"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" class="dial-bg"/><line x1="30" y1="30" x2="${x}" y2="${y}" class="dial-hand"/></svg><b>${v}</b><span>${label}</span></div>`;
};
const SWITCH = ["Bridge", "Bridge + middle", "Middle", "Middle + neck", "Neck"];
function stratSwitch(pos, lead) {
  return `<div class="switch">${SWITCH.map((n, i) => `<div class="pos ${i + 1 === pos ? "on" : ""} ${i + 1 === lead && lead !== pos ? "lead" : ""}"><i></i><span>${i + 1} · ${n}</span></div>`).join("")}</div>`;
}
const bar = (label, v) => `<div class="bar"><span>${label}</span><div><i style="width:${Math.max(0, Math.min(10, v)) * 10}%"></i></div><b>${v}</b></div>`;

let guideFor = null, guideSeen = null;
async function loadGuide() {
  let g, raw;
  try { raw = await (await fetch("/api/guide")).text(); g = JSON.parse(raw); } catch (e) { return; }
  if (raw === loadGuide.last) return;  // nothing new: don't rebuild the page every 3 s
  loadGuide.last = raw;
  const el = $("#guide");
  if (g.status === "none") { el.innerHTML = `<p class="explain">Open a song in the Songsterr tab: its tone guide appears here.</p>`; return; }
  if (g.status !== "ready") {
    el.innerHTML = String(g.status).startsWith("error")
      ? `<p class="explain">Couldn't write the guide: ${esc(g.status.slice(7))}</p>`
      : `<p class="explain">Writing the tone guide for this song (about 20 seconds)...</p>`;
    return;
  }
  const x = g.guide;
  if (guideFor !== g.song_id) {
    guideFor = g.song_id;
    $("#guide-ready").classList.toggle("hidden", guideSeen === g.song_id || tab === "amp");
  }
  el.innerHTML = `
    <h2>${esc(x.song.title)} <span class="sub">${esc(x.song.artist)}</span></h2>
    <p class="explain">${esc(x.summary)}</p>
    <div class="chips"><span>Key: <b>${esc(x.key)}</b></span><span>Tempo: <b>~${x.tempo_bpm} BPM</b></span><span>Tuning: <b>${esc(x.tuning)}</b></span></div>
    <div class="cards">
      <div class="card"><p class="label">Your Strat</p>
        ${stratSwitch(x.strat.switch, x.strat.lead_switch)}
        <p class="why"><b>Rhythm:</b> position ${x.strat.switch} (${esc(x.strat.switch_name)}). ${esc(x.strat.why)}</p>
        ${x.strat.lead_switch !== x.strat.switch ? `<p class="why"><b>Solos:</b> position ${x.strat.lead_switch}. ${esc(x.strat.lead_why)}</p>` : ""}
        <div class="dials">${dial("Volume", x.strat.volume)}${dial("Tone (neck)", x.strat.tone_neck)}${dial("Tone (middle)", x.strat.tone_middle)}</div>
      </div>
      <div class="card"><p class="label">Amp</p>
        <p class="why"><b>${esc(x.amp.type)}</b></p>
        ${bar("Gain", x.amp.gain)}${bar("Bass", x.amp.bass)}${bar("Mid", x.amp.mid)}${bar("Treble", x.amp.treble)}${bar("Presence", x.amp.presence)}
        <ul class="fx">${x.amp.effects.map((e) => `<li><b>${esc(e.name)}</b> ${esc(e.setting)}</li>`).join("")}</ul>
        <button disabled title="Coming next: builds this into the '! Workbench' practice rig, muted and checked">Build this tone on my amp (next)</button>
      </div>
      <div class="card"><p class="label">Improvise</p>
        <p class="why"><b>${esc(x.improv.scale)}</b>${x.improv.also_try ? ` · also try ${esc(x.improv.also_try)}` : ""}</p>
        <p class="why">Land on: ${esc(x.improv.target_notes)}</p><p class="why">${esc(x.improv.tip)}</p>
        <p class="why"><b>Chords:</b> ${esc(x.chords)}</p>
        <button class="ghost" data-go="play">Show it on the fretboard</button>
      </div>
      <div class="card"><p class="label">Tips</p><ul class="fx">${x.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
    </div>`;
}
async function loadAmp() {
  if (tab !== "amp") return;
  let a;
  try { a = await (await fetch("/api/amp")).json(); } catch (e) { return; }
  const el = $("#amp");
  if (!a || !a.reachable) { el.innerHTML = `<p class="explain">Can't see your HeadRush: is it on and on the same Wi-Fi?</p>`; return; }
  el.innerHTML = `
    <div class="chips"><span>Rig: <b>${esc(a.rig)}</b></span><span>Volume: <b>${a.volume_db} dB</b></span></div>
    <div class="blocks">${a.blocks.map((b) => `
      <div class="block ${b.on ? "on" : ""}"><p><b>${esc(b.name)}</b><span>${b.on ? "ON" : "off"}</span></p>
        <p class="sub">${esc(b.preset)}</p>${b.knobs.slice(0, 4).map(([l, v]) => bar(esc(l), v)).join("")}</div>`).join("")}</div>
    <p class="label" style="margin-top:14px">Footswitches</p>
    <div class="chips">${a.switches.map((s) => `<span>${s.n}: <b>${esc(s.label)}</b> <i class="sub">${s.mode}</i></span>`).join("")}</div>`;
}
setInterval(loadGuide, 3000);
setInterval(loadAmp, 4000);

/* ======================= MY SONGS ======================= */
const mins = (s) => s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`;
async function loadSongs(force) {
  if (force !== true && tab !== "songs" && tab !== "songsterr") return;  // only where the lists or the star show
  let d, raw;
  try { raw = await (await fetch("/api/songs")).text(); d = JSON.parse(raw); } catch (e) { return; }
  if (raw === loadSongs.last) return;
  loadSongs.last = raw;
  const row = (e) => `<li><button class="song" data-url="${esc(e.url)}"><b>${esc(e.title)}</b><span>${esc(e.artist)}</span></button>
    <span class="sub">${mins(e.seconds)} · ${e.sessions}×${e.last ? " · last " + e.last : ""}</span>
    <button class="ghost icon" data-unfav="${e.id}" title="Remove from favourites">${d.fav_ids.includes(e.id) ? "&#9733;" : "&#9734;"}</button></li>`;
  $("#favs").innerHTML = d.favorites.map(row).join("") || `<li class="sub">No favourites yet: press &#9734; Favourite in the Songsterr tab.</li>`;
  $("#practised").innerHTML = d.practised.map(row).join("") || `<li class="sub">Open songs in Songsterr and practise: they show up here.</li>`;
  const cur = d.current;
  $("#fav-btn").innerHTML = cur && d.fav_ids.includes(cur) ? "&#9733; Favourite" : "&#9734; Favourite";
  $("#fav-btn").classList.toggle("on", !!(cur && d.fav_ids.includes(cur)));
}
setInterval(loadSongs, 5000);
loadSongs(true);


/* ======================= LEARN: how keys work + ask Claude ======================= */
function songKey() {
  const k = P.key || { root: 9, minor: true };
  return { ...k, name: `${nn(k.root)} ${k.minor ? "minor" : "major"}`, rel: k.minor ? `${nn((k.root + 3) % 12)} major` : `${nn((k.root + 9) % 12)} minor` };
}
const scaleNotes = (root, ivs) => ivs.map((i) => nn((root + i) % 12)).join(" ");
function fretOf(note, open) { return ((noteIndex(note) - open % 12) + 12) % 12; }
function renderLessons() {
  const k = songKey(), song = (P.info && P.info.title) || "this song";
  const chords = usingTab() ? [...new Set(P.tab.bars.map((b) => b.chord).filter(Boolean))].slice(0, 7) : [];
  const pent = k.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9], full = k.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const rootLowE = fretOf(nn(k.root), 40), rootA = fretOf(nn(k.root), 45);
  const L = [
    ["1 · The 12 notes", `Music uses only <b>12 notes</b>: C, C#, D, D#, E, F, F#, G, G#, A, A#, B, then it repeats one octave higher.
      On the guitar, <b>each fret = one step</b> (a half step). Fret 12 is the same note as the open string, one octave up (that's why it has two dots).`],
    ["2 · What a key is", `A <b>key</b> is a "home" note plus a family of 7 notes that sound right together. ${esc(song)} is in <b>${k.name}</b>:
      its home note is <b>${nn(k.root)}</b> and its family is <b>${scaleNotes(k.root, full)}</b>. Melodies and solos mostly use these notes,
      and the song feels "finished" when it lands back on ${nn(k.root)}.`],
    ["3 · Major vs minor", `<b>Major</b> sounds bright/happy, <b>minor</b> sounds darker/sad. The difference is mostly one note, the <b>3rd</b>:
      4 frets above the root in major, <b>3 frets (the "b3")</b> in minor. ${k.name} shares all its notes with <b>${k.rel}</b> (its "relative" key):
      same notes, different home.`],
    ["4 · Scales vs chords", `A <b>scale</b> is the key's notes in a row. A <b>chord</b> is 3+ notes played together, usually the 1st, 3rd and 5th
      of a scale (the "chord tones"). This song's chords: <b>${chords.length ? chords.join(" · ") : "play a song and open the Play tab to see them"}</b>.
      <b>Improv secret:</b> landing on a <b>chord tone of the chord playing right now</b> always sounds good. That's what the green notes on the Play page show.`],
    ["5 · The pentatonic: your first improv tool", `The <b>${k.minor ? "minor" : "major"} pentatonic</b> keeps the 5 safest notes of the key:
      <b>${scaleNotes(k.root, pent)}</b>. It has no "wrong" notes over this song. Start in <b>box 1</b>: the root ${nn(k.root)} is on
      <b>fret ${rootLowE || 12} of the low E string</b> and fret ${rootA || 12} of the A string. In Play → Options choose <i>Part of the neck → Box 1</i>, then try
      boxes 2–5 to connect the whole neck.`],
    ["6 · Intervals: shapes that work in any key", `An <b>interval</b> is the distance from the root: <b>R</b> (root), <b>b3</b>, <b>3</b>, <b>5</b>, <b>b7</b>...
      In Play → Options set <i>Dots show → Note jobs</i>: the same shape spells R-b3-4-5-b7 in every minor key, just moved up or down the neck.
      Learn the shape once, play it in all 12 keys.`],
  ];
  $("#lessons").innerHTML = `<h2>How keys work <span class="sub">with ${esc(song)} as the example</span></h2>` +
    L.map(([t, body]) => `<details class="lesson"><summary>${t}</summary><p>${body}</p></details>`).join("") +
    `<div class="row"><button class="ghost" data-go="play">Try it on the fretboard &#8594;</button></div>`;
  const ideas = [`Which notes should I aim for over ${chords[0] || "the first chord"}?`, `How do I find the key of a song by ear?`,
    `Give me a 3-note lick in ${k.name} with frets`, `What's the difference between ${nn(k.root)} minor and ${nn(k.root)} dorian?`];
  $("#ask-ideas").innerHTML = ideas.map((q) => `<button class="ghost idea" data-ask="${esc(q)}">${esc(q)}</button>`).join("");
}
const chat = [];
async function ask(q) {
  chat.push({ role: "user", text: q });
  drawChat(true);
  const now = { key: songKey().name, chord_now: $("#pl-chord").textContent, section_info: `${$("#pl-section").textContent} ${$("#pl-barno").textContent}`,
    song: P.info && P.info.title ? `${P.info.title} by ${P.info.artist}` : "" };
  try {
    const r = await (await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, history: chat.slice(0, -1), context: now }) })).json();
    chat.push({ role: "claude", text: r.answer || r.error });
  } catch (e) { chat.push({ role: "claude", text: "Couldn't reach Claude. Try again." }); }
  drawChat(false);
}
function drawChat(waiting) {
  $("#msgs").innerHTML = chat.map((m) => `<div class="msg ${m.role}">${esc(m.text).replace(/\n/g, "<br>")}</div>`).join("")
    + (waiting ? `<div class="msg claude wait">thinking...</div>` : "");
  $("#msgs").scrollTop = $("#msgs").scrollHeight;
}
$("#ask-form").addEventListener("submit", (e) => { e.preventDefault(); const q = $("#ask-q").value.trim(); if (q) { $("#ask-q").value = ""; ask(q); } });
document.addEventListener("click", (e) => { const b = e.target.closest("[data-ask]"); if (b) ask(b.dataset.ask); });

applyCollapsed();

/* ---------- tab version picker ---------- */
async function openVersions() {
  openPop("#pop-versions");
  $("#ver-list").innerHTML = `<p class="explain">Looking at every Songsterr tab of this song (a few seconds the first time)...</p>`;
  let d;
  try { d = await (await fetch("/api/now/versions")).json(); } catch (e) { $("#ver-list").innerHTML = `<p class="explain">Couldn't reach Songsterr.</p>`; return; }
  if (!d.versions.length) { $("#ver-list").innerHTML = `<p class="explain">Songsterr has no tab of this song. Paste a link below if you found one.</p>`; return; }
  const len = (x) => fmtT(x);
  $("#ver-intro").innerHTML = `Songsterr has <b>${d.versions.length}</b> tab${d.versions.length > 1 ? "s" : ""} of this song. Pick the one whose guitars and length match your recording${d.duration ? ` (yours is <b>${len(d.duration)}</b> long)` : ""}.`;
  $("#ver-list").innerHTML = d.versions.map((v) => {
    const close = d.duration && Math.abs(v.length - d.duration) <= 8;
    return `<div class="ver ${v.chosen ? "on" : ""}">
      <div class="ver-main"><b>${esc(v.title)}</b> <span class="sub">by ${esc(v.artist)} on Songsterr</span>
        <div class="ver-tags"><span class="${close ? "good" : ""}">${len(v.length)} long${close ? " · same as yours" : ""}</span>${v.synced ? `<span class="good">timed to a recording</span>` : `<span>timing from tempo</span>`}${v.lyrics ? "<span>lyrics</span>" : ""}</div>
        <div class="ver-parts">${v.parts.map((t) => `<span>${esc(partName(t))} <i>${t.played}/${v.bars} bars</i></span>`).join("") || `<span class="sub">no guitar parts</span>`}</div></div>
      ${v.chosen ? `<span class="ver-cur">IN USE</span>` : `<button data-version="${v.id}">Use this</button>`}</div>`;
  }).join("");
}
async function useVersion(body) {
  const r = await fetch("/api/now/version", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) { toast(d.error || "Couldn't use that tab"); return; }
  toast("Using that tab"); closePops();
  P.info = null; P.songId = null; pollNow();  // reload the song with the new tab
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.id === "pl-versions") openVersions();
  if (b.dataset.version) useVersion({ id: Number(b.dataset.version) });
});
$("#ver-paste").addEventListener("submit", (e) => { e.preventDefault(); const u = $("#ver-url").value.trim(); if (u) useVersion({ url: u }); });

/* ---------- fretboard animations: the notes being played move like the guitarist's fingers ---------- */
// slide = glide along the string (to the next note, or in from 2 frets away, or out and fade), bend = push upward
// (half / whole step), vibrato = wobble, hammer-on / pull-off = quick snap, a jump to a new spot = a fast flight.
// Every moving bubble leaves a fast-fading trail. Timed by the song (playTime), so it follows the sync.
const FX = { beat: -2, notes: [], trails: [], last: {} };
function fxBeat(d, bt, bnow) {
  FX.beat = bt;
  if (!bnow) { FX.notes = []; return; }
  const [t0, dur] = bnow, after = d.beats.slice(bt + 1).find((b) => b[3].length);
  const before = FX.notes || [];
  // the hand shape: notes played in the same position stay "held" until the hand moves (a note on the same string at
  // another fret, or a fret out of the hand's reach, or a long gap)
  const fretted = bnow[3].filter((n) => !n[2].includes("t") && !n[2].includes("x"));
  const shape = FX.shape || new Map(), lo = Math.min(...[...shape.values()].filter((f) => f > 0), 99);
  const moved = fretted.some(([st, f]) => (shape.has(st) && shape.get(st) !== f) || (f > 0 && lo < 99 && Math.abs(f - lo) > 4))
    || bnow[0] - (FX.shapeAt || 0) > 2.5;
  if (moved) shape.clear();
  for (const [st, f] of fretted) shape.set(st, f);
  FX.shape = shape; FX.shapeAt = bnow[0] + bnow[1];
  // let ring: the notes that were ringing keep a fading halo for a moment
  const nowMs = performance.now();
  FX.ringing = [...(FX.ringing || []).filter((r) => nowMs - r.at < 1600),
    ...before.filter((b) => b.bf && b.bf.includes("lr") && b._q).map((b) => ({ x: b._q.x, y: b._q.y, s: b.s, f: b._q.fret, at: nowMs }))];
  const sounding = bnow[3].filter((n) => !n[2].includes("t"));
  // the same chord strummed again (8th-note strumming): a quiet pulse, not a fresh "new notes" burst every beat
  const key = (arr) => arr.map((n) => `${n[0]}:${n[1]}`).sort().join(" ");
  const rep = sounding.length >= 2 && key(sounding) === key(before.map((b) => [b.s, b.f]));
  const gap = Math.max(0.12, (after ? after[0] : t0 + dur) - t0);  // time until the next hit: effects fit inside it
  const down = /\bsd\b/.test(bnow[4] || ""), strummed = /\bs[du]\b/.test(bnow[4] || "") || sounding.length >= 3;
  const order = [...sounding].sort((a, b) => (down ? b[0] - a[0] : a[0] - b[0])).map((n) => n[0]);  // thick -> thin when down
  FX.notes = sounding.map(([s, f, fl]) => {
    const to = after && after[3].find((n) => n[0] === s);
    const again = !rep && sounding.length === 1 && before.some((b) => b.s === s && b.f === f);  // one note picked again
    const prev = FX.last[s] ?? Object.values(FX.last).sort((a, b) => b.t - a.t)[0];
    const delay = strummed ? order.indexOf(s) * Math.min(0.014, gap / 24) : 0;  // a strum reaches the strings one by one
    return { s, f, fl, bf: bnow[4] || "", t0, dur: Math.max(0.08, dur), to: to ? to[1] : null, again, rep, gap, delay,
      pickedAt: performance.now() + delay * 1000,
      from: !rep && prev && t0 - prev.t < 0.8 ? prev : null };  // where the finger comes from (for the fast flight)
  });
}
const ease = (p) => (p < 0 ? 0 : p > 1 ? 1 : p * p * (3 - 2 * p));
function fxPos(n, t, geo) {
  const p = (t - n.t0) / n.dur, fl = n.fl;
  let fret = n.f, lift = 0, fade = 1;
  if (fl.includes("i")) fret = n.f - 2 * (1 - ease(p / 0.25));            // slide in from 2 frets below
  if (fl.includes("I")) fret = n.f + 2 * (1 - ease(p / 0.25));            // ... or above
  if (fl.includes("s") && n.to != null) fret = n.f + (n.to - n.f) * ease((p - 0.15) / 0.75);  // glide to the next note
  if (fl.includes("h") && n.to != null) fret = n.f + (n.to - n.f) * ease((p - 0.8) / 0.12);   // quick snap at the end
  if (fl.includes("o")) { fret = n.f - 3 * ease((p - 0.55) / 0.45); fade = 1 - ease((p - 0.6) / 0.4); }  // slide out, fade
  if (fl.includes("O")) { fret = n.f + 3 * ease((p - 0.55) / 0.45); fade = 1 - ease((p - 0.6) / 0.4); }
  // bend: push the string toward the middle of the neck, like a real finger (high strings down, low strings up)
  if (/[bBq]/.test(fl)) {  // bend: quarter / half / whole step; with a release it comes back down
    const size = fl.includes("B") ? 0.95 : fl.includes("b") ? 0.55 : 0.28;
    const up = ease(p / 0.35) * (fl.includes("r") ? 1 - ease((p - 0.6) / 0.3) : 1);
    lift = (n.s < geo.strings / 2 ? -1 : 1) * size * geo.gap * up;
  }
  if (fl.includes("v")) lift += Math.sin(t * 2 * Math.PI * 6) * 3;                      // vibrato: wobble
  if (fl.includes("V")) lift += Math.sin(t * 2 * Math.PI * 5) * 6;                      // wide vibrato
  if ((n.bf || "").includes("wh")) lift += Math.sin(t * 2 * Math.PI * 4) * 4;            // whammy bar: the whole note wobbles
  if (fl.includes("c")) fade = Math.min(fade, 1 - ease((p - 0.35) / 0.2));              // staccato: cut short
  // a new note right after another: fly in from where the finger was (fast)
  const fly = n.from && !/[iIsh]/.test(fl) ? 1 - ease((t - n.t0) / 0.09) : 0;
  let x = fretX(geo, fret), y = geo.sy(n.s) - lift;
  if (fly > 0 && n.from) { x = x + (n.from.x - x) * fly; y = y + (n.from.y - y) * fly; }
  return { x, y, fade, fret: Math.round(fret) };
}
function fretX(geo, fret) {  // x of a (possibly in-between) fret position
  const a = Math.floor(fret), b = Math.ceil(fret), k = fret - a;
  const xa = geo.xAt(Math.max(0, a)), xb = geo.xAt(Math.max(0, b));
  return xa + (xb - xa) * k;
}
function fxFrame() { requestAnimationFrame(fxFrame); if (!skipFrame("fx")) fxDraw(); }
// backup timer: screen-refresh callbacks pause when the window isn't visible; draw anyway (~30 fps)
setInterval(() => { if (performance.now() - (FX.drawnAt || 0) > 60) fxDraw(); }, 33);
function fxDraw() {
  FX.drawnAt = performance.now();
  if (tab !== "play" || !usingTab() || !show().now) return;
  const svg = $("#pl-board"), geo = svg._geo, layer = svg.querySelector("#fx-now"), trail = svg.querySelector("#fx-trail");
  if (!geo || !layer) return;
  const t = playTime(), now = performance.now();
  let h = "";
  // hand shape: notes still held (pressed but not sounding right now) are see-through blue
  const shape = FX.shape || new Map(), sounding = new Set(FX.notes.map((n) => `${n.s}:${n.f}`));
  for (const [st, f] of shape) {
    if (f > 0 && st < geo.strings && !sounding.has(`${st}:${f}`)) {
      h += `<circle class="fx-held" cx="${fretX(geo, f)}" cy="${geo.sy(st)}" r="${geo.r + 3}"/>`;
    }
  }
  // barre: worked out from the whole shape, like a guitarist would
  const sh = [...shape.entries()].filter(([st]) => st < geo.strings);
  const frettedS = sh.filter(([, f]) => f > 0);
  if (frettedS.length >= 2) {
    const f0 = Math.min(...frettedS.map(([, f]) => f));
    const atF0 = frettedS.filter(([, f]) => f === f0).map(([st]) => st), from = Math.min(...atF0), to = Math.max(...atF0);
    const openBetween = sh.some(([st, f]) => f === 0 && st > from && st < to);   // an open string inside = no barre
    const above = frettedS.filter(([, f]) => f > f0).length;                     // notes the other 3 fingers must play
    const adjacentOnly = to - from === 1 && atF0.length === 2;
    // a barre only when the hand needs one: more notes than 4 fingers, or 4+ strings on one fret (F, Bm...). The
    // chord's real shape decides when it's a known one (D = 3 separate fingers, not a barre over G and high E)
    const known = (() => {
      const bar = P.tab && P.tab.bars[Math.max(0, P.barIdx)], cs = bar && bar.chord && typeof chordShape === "function" ? chordShape(bar.chord) : null;
      if (!cs) return null;
      const match = frettedS.every(([st, f]) => cs.frets[geo.strings - 1 - st] === f);
      return match ? !!(cs.barre && cs.barre.fret === f0) : null;
    })();
    const isBarre = known ?? (atF0.length >= 2 && !openBetween && above <= 3 && (frettedS.length > 4 || atF0.length >= 4) && !adjacentOnly);
    if (isBarre) {
      const x = fretX(geo, f0), w = geo.r * 2 + 10, y1 = geo.sy(from) - geo.r - 4, y2 = geo.sy(to) + geo.r + 4;
      const live = FX.notes.some((n) => n.f === f0 && n.s >= from && n.s <= to);
      h += `<rect class="fx-barre main ${live ? "" : "idle"}" x="${x - w / 2}" y="${y1}" width="${w}" height="${y2 - y1}" rx="${w / 2}"/>`;
      for (const [st, f] of frettedS) {  // strings under the barre where another finger sounds a higher fret
        if (st > from && st < to && f > f0) {
          const y = geo.sy(st);
          h += `<rect class="fx-barre-under" x="${x - w / 2 + 2}" y="${y - geo.r - 2}" width="${w - 4}" height="${geo.r * 2 + 4}" rx="${(w - 4) / 2}"/>`;
          h += `<circle class="fx-barre-ring" cx="${x}" cy="${y}" r="${geo.r * 0.55}"/>`;
          h += `<line class="fx-barre-link" x1="${x + geo.r * 0.6}" y1="${y}" x2="${fretX(geo, f) - geo.r - 6}" y2="${y}"/>`;
        }
      }
      if (to - from >= 2) h += `<text class="fx-barre-label" x="${x}" y="${y1 - 7}">barre ${f0}</text>`;
    }
  }
  // let ring: earlier notes still ringing (fading halos)
  for (const r of FX.ringing || []) {
    const a = 1 - (now - r.at) / 1600;
    if (a > 0) h += `<circle class="fx-ringing s${r.s}" cx="${r.x}" cy="${r.y}" r="${geo.r + 5}" opacity="${(a * 0.45).toFixed(2)}"/>`;
  }
  // strum: a sweeping arrow across the chord's strings (down = from the thick string to the thin one)
  const strum = FX.notes.find((n) => /\bs[du]\b/.test(n.bf || ""));
  if (strum && FX.notes.length >= 2) {
    const ages = (now - strum.pickedAt + strum.delay * 1000) / 1000, down = /\bsd\b/.test(strum.bf), life = Math.min(0.45, strum.gap * 0.85);
    if (ages < life) {
      const ss = FX.notes.map((n) => n.s), lo = Math.max(...ss), hi = Math.min(...ss);
      const xs = Math.min(...FX.notes.map((n) => fretX(geo, n.f))) - geo.r * 2.4;
      const yA = geo.sy(down ? lo : hi), yB = geo.sy(down ? hi : lo), k = ease(ages / 0.18), yt = yA + (yB - yA) * k;
      const k2 = ease(ages / Math.min(0.18, life * 0.5)), yt2 = yA + (yB - yA) * k2;
      h += `<g class="fx-strum ${strum.rep ? "rep" : ""}" opacity="${((strum.rep ? 0.6 : 1) * (1 - ease((ages - life * 0.55) / (life * 0.45)))).toFixed(2)}"><line x1="${xs}" y1="${yA}" x2="${xs}" y2="${yt2}"/>
        <path d="M${xs} ${yt2} l-7 ${down ? 10 : -10} h14 z"/>${strum.rep ? "" : `<text x="${xs - 12}" y="${(yA + yB) / 2}">${down ? "strum down" : "strum up"}</text>`}</g>`;
    }
  }
  // palm mute: the picking hand resting on the strings at the bridge end
  if (FX.notes.some((n) => (n.bf || "").includes("pm"))) {
    const ss = FX.notes.map((n) => n.s);
    h += `<g class="fx-palm"><rect x="${geo.x2 - 70}" y="${geo.sy(Math.min(...ss)) - geo.r}" width="64" height="${geo.sy(Math.max(...ss)) - geo.sy(Math.min(...ss)) + geo.r * 2}" rx="14"/>
      <text x="${geo.x2 - 38}" y="${geo.sy(Math.min(...ss)) - geo.r - 6}">palm mute</text></g>`;
  }
  for (const n of FX.notes) {
    if (n.s >= geo.strings) continue;
    const q = fxPos(n, t, geo);
    const prev = n._q;
    if (prev && (Math.abs(prev.x - q.x) > 1.5 || Math.abs(prev.y - q.y) > 1.5)) FX.trails.push({ x: q.x, y: q.y, at: now, s: n.s });  // moving: leave a trail
    n._q = q;
    FX.last[n.s] = { x: q.x, y: q.y, t };
    if (n.f === 0 && !/[siIoOh]/.test(n.fl)) {  // an open string: the whole string lights up, fading over the note
      const a = Math.max(0, 1 - Math.max(0, (t - n.t0) / Math.max(0.25, n.dur)));
      h += `<line class="fx-string s${n.s}" x1="${geo.left}" y1="${q.y}" x2="${geo.x2}" y2="${q.y}" opacity="${(0.35 + 0.65 * a).toFixed(2)}"/>`;
    }
    const since = (now - n.pickedAt) / 1000, col = strColor(n.s);
    // just picked: the string shimmers (a fading wave) and a ring pulses out; it all fits before the next hit, and a
    // repeated strum of the same chord only gives a small, quiet pulse
    const life = Math.min(0.5, Math.max(0.16, n.gap * 0.9));
    if (since >= 0 && since < life && !n.fl.includes("x") && q.fret > 0) {
      const k = since / life, amp = (n.rep ? 2.5 : n.again ? 8 : 6) * Math.pow(1 - k, 1.5), y0 = geo.sy(n.s);
      let path = `M${geo.left} ${y0}`;
      for (let x = geo.left; x <= geo.x2; x += 6) path += ` L${x} ${(y0 + Math.sin((x - geo.left) / 9 + since * 110) * amp * Math.sin(Math.PI * (x - geo.left) / (geo.x2 - geo.left))).toFixed(1)}`;
      h += `<path class="fx-shimmer" style="--sc:${col}" d="${path}" opacity="${((n.rep ? 0.5 : 1) * (1 - k)).toFixed(2)}"/>`;
      const rg = (geo.r + 5) * (1 + k * (n.rep ? 0.35 : n.again || n.fl.includes("a") ? 1.3 : 0.8));
      h += `<circle class="fx-ring" style="stroke:${col}" cx="${q.x}" cy="${q.y}" r="${rg.toFixed(1)}" opacity="${((n.rep ? 0.35 : n.again ? 0.95 : 0.6) * (1 - k)).toFixed(2)}"/>`;
    }
    if (q.fret === 0 && !/[siIoOh]/.test(n.fl)) {  // open string: no bubble, the string's name lights up instead
      const lit = 1 - Math.min(1, Math.max(0, (t - n.t0) / Math.max(0.3, n.dur)));
      h += `<g class="fx-open s${n.s}" opacity="${(0.55 + 0.45 * lit).toFixed(2)}"><rect x="2" y="${q.y - 14}" width="36" height="28" rx="9"/>
        <text x="20" y="${q.y + 6}">${esc(nn(P.tab.tuning[n.s] % 12))}</text></g>`;
      continue;
    }
    let rr = geo.r + 5;
    if ((n.bf || "").includes("tr")) rr *= 1 + 0.12 * Math.sin(now / 1000 * 2 * Math.PI * 14);  // tremolo picking: fast flicker
    if ((n.bf || "").includes("pm")) rr *= 0.85;                                                   // palm muted: smaller, dull
    const op = q.fade * (n.fl.includes("g") ? 0.5 : 1);
    if (n.fl.includes("x")) {  // muted (dead) hit: the string goes grey and still for a moment, a band where the hand damps it
      const a = Math.max(0, 1 - (now - n.pickedAt) / 1000 / Math.min(0.35, Math.max(0.15, n.gap * 0.9)));
      if (a > 0) h += `<g class="fx-mute" opacity="${(a * op).toFixed(2)}"><line x1="${geo.left}" y1="${q.y}" x2="${geo.x2}" y2="${q.y}"/>
        <rect x="${q.x - rr * 1.6}" y="${q.y - rr * 0.45}" width="${rr * 3.2}" height="${rr * 0.9}" rx="${rr * 0.45}"/></g>`;
    } else if (/[HP]/.test(n.fl)) {  // harmonic: a diamond with a sparkle
      h += `<g class="note play harm s${n.s}" opacity="${op.toFixed(2)}"><path d="M${q.x} ${q.y - rr - 3} L${q.x + rr + 3} ${q.y} L${q.x} ${q.y + rr + 3} L${q.x - rr - 3} ${q.y} Z"/>
        <path class="spark" d="M${q.x + rr + 6} ${q.y - rr - 6} l6 -6 M${q.x + rr + 10} ${q.y - rr} h8 M${q.x + rr} ${q.y - rr - 10} v-8"/><text x="${q.x}" y="${q.y + 5}">${q.fret}</text></g>`;
    } else {
      h += `<g class="note play s${n.s} ${n.fl.includes("g") ? "ghost" : ""} ${(n.bf || "").includes("pm") ? "muted" : ""}" opacity="${op.toFixed(2)}"><circle cx="${q.x}" cy="${q.y}" r="${rr}"/><text x="${q.x}" y="${q.y + 5}">${q.fret}</text></g>`;
    }
    const pick = /\bpd\b/.test(n.bf || "") ? "⊓" : /\bpu\b/.test(n.bf || "") ? "V" : "";
    if (pick) h += `<text class="fx-pick" x="${q.x - rr - 9}" y="${q.y - rr + 2}">${pick}</text>`;
  }
  // the next note is coming (a gap before it): a ring closes in on where the finger goes, landing when it's played
  const d0 = P.tab, nb = d0 && d0.beats[lastAt(d0.beats, t, (b) => b[0]) + 1];
  if (nb && nb[3].length) {
    const lead = nb[0] - t, curEnd = FX.notes.length ? Math.max(...FX.notes.map((n) => n.t0 + n.dur)) : -1e9, gapBefore = nb[0] - curEnd;
    if (lead > 0 && lead < 0.9 && gapBefore > 0.3) {
      const k = 1 - lead / 0.9;  // 0 -> 1 as it comes
      for (const [st, f, fl] of nb[3]) {
        if (st >= geo.strings || fl.includes("t") || fl.includes("x")) continue;
        const x = f > 0 ? fretX(geo, f) : geo.left - 20, y = geo.sy(st), r = (geo.r + 5) * (1 + 1.4 * (1 - k));
        h += `<circle class="fx-incoming" style="stroke:${strColor(st)}" cx="${x}" cy="${y}" r="${r.toFixed(1)}" opacity="${(0.25 + 0.65 * k).toFixed(2)}"/>`;
      }
    }
  }
  FX.trails = FX.trails.filter((p) => now - p.at < 220);  // fast fade
  trail.innerHTML = FX.trails.map((p) => { const a = 1 - (now - p.at) / 220;
    return `<circle class="fx-trail s${p.s}" cx="${p.x}" cy="${p.y}" r="${(geo.r + 5) * (0.55 + 0.45 * a)}" opacity="${(a * 0.55).toFixed(2)}"/>`; }).join("");
  layer.innerHTML = h;
}
requestAnimationFrame(fxFrame);

/* ---------- Look: Classic / Neon (Guitar Hero style), remembered ---------- */
function setLook(look) {
  document.body.classList.toggle("neon", look === "neon");
  try { localStorage.setItem("mp-look", look); } catch (e) { /* fine */ }
  $("#o-look").value = look; syncPills();
  document.querySelectorAll("[data-look]").forEach((b) => b.classList.toggle("on", b.dataset.look === look));
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-look]"); if (b) setLook(b.dataset.look); });
// string colours: two alternating (easier on the eyes) or one per string (Guitar Hero)
function setStrings(v) {
  document.body.classList.toggle("str-two", v === "two");
  document.body.classList.toggle("str-each", v === "each");
  try { localStorage.setItem("mp-strings", v); } catch (e) { /* fine */ }
  $("#o-strings").value = v; syncPills();
}
try { setStrings(localStorage.getItem("mp-strings") || "two"); } catch (e) { setStrings("two"); }
$("#o-strings").addEventListener("change", (e) => setStrings(e.target.value));
try { setLook(localStorage.getItem("mp-look") || "classic"); } catch (e) { setLook("classic"); }
$("#o-look").addEventListener("change", (e) => setLook(e.target.value));

/* ---------- smooth page changes ---------- */
const _setTab = setTab;
setTab = function (name) {  // eslint-disable-line no-func-assign
  _setTab(name);
  const v = $(`#view-${name}`);
  if (v) {  // fade in; fail safe: the class goes away even if the animation never runs
    v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter");
    clearTimeout(v._enterT); v._enterT = setTimeout(() => { v.classList.remove("enter"); placeBrowser(); }, 300);  // place again once it has settled
  }
};

/* ---------- Tab | Highway (Guitar Hero style: notes come toward you down a lane per string) ---------- */
let TVIEW = "tab";
try { TVIEW = localStorage.getItem("pl-tview") || "tab"; } catch (e) { /* fine */ }
function setTView(v) {
  TVIEW = v;
  try { localStorage.setItem("pl-tview", v); } catch (e) { /* fine */ }
  document.querySelectorAll("[data-tview]").forEach((b) => b.classList.toggle("on", b.dataset.tview === v));
  $("#highway").classList.toggle("off", v !== "highway");
  $("#tabstrip").classList.toggle("off", v === "highway");
  if (v === "tab") { layoutTab(); drawTab(); }
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-tview]"); if (b) { if (document.body.classList.contains("sheet-mode")) setSheet(false); setTView(b.dataset.tview); } });
$("#highway").classList.remove("hidden");
setTView(TVIEW);

// lane colours = the string colours (Options); with colours off, every lane is violet
const laneColor = (s) => (typeof strColor === "function" && strColor(s) !== "#ffd27a" ? strColor(s) : "#9b5cff");
const AHEAD = 2.6;  // seconds of song visible on the highway
function hwDraw() {
  if (tab !== "play" || TVIEW !== "highway" || !usingTab()) return;
  const cv = $("#hw-canvas"), box = cv.parentElement;
  const dpr = window.devicePixelRatio || 1, W = box.clientWidth, H = box.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const d = P.tab, T = playTime(), lanes = d.tuning.length;
  const hitY = H - 44, topY = 26, cx = W / 2, near = Math.min(W * 0.66, 820), far = near * 0.3;
  const depth = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 2);  // simple perspective: far notes bunch up
  const yAt = (p) => hitY - (hitY - topY) * depth(p), wAt = (p) => near + (far - near) * depth(p);
  const xAt = (lane, p) => cx - wAt(p) / 2 + wAt(p) * (lane + 0.5) / lanes;  // lane 0 = low E (left), like Guitar Hero
  const laneOf = (s) => lanes - 1 - s;
  // background + the highway
  const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#04040a"); bg.addColorStop(1, "#0c0920");
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  c.beginPath(); c.moveTo(cx - far / 2, topY); c.lineTo(cx + far / 2, topY); c.lineTo(cx + near / 2, hitY + 30); c.lineTo(cx - near / 2, hitY + 30); c.closePath();
  const hw = c.createLinearGradient(0, topY, 0, hitY); hw.addColorStop(0, "#0b0b1c"); hw.addColorStop(1, "#191438");
  c.fillStyle = hw; c.fill();
  // lanes
  for (let l = 0; l < lanes; l++) {
    const s = lanes - 1 - l, col = laneColor(s);
    c.strokeStyle = col; c.globalAlpha = 0.28; c.lineWidth = 2;
    c.beginPath(); c.moveTo(xAt(l, 1), topY); c.lineTo(xAt(l, 0), hitY + 30); c.stroke();
  }
  c.globalAlpha = 1;
  // bar lines scrolling toward you
  for (const b of d.bars) {
    const p = (b.t - T) / AHEAD;
    if (p < 0 || p > 1) continue;
    c.strokeStyle = "#ffffff"; c.globalAlpha = 0.12 + 0.2 * (1 - p); c.lineWidth = 1 + 2 * (1 - p);
    c.beginPath(); c.moveTo(cx - wAt(p) / 2, yAt(p)); c.lineTo(cx + wAt(p) / 2, yAt(p)); c.stroke();
  }
  c.globalAlpha = 1;
  // the hit line + a target ring per lane
  c.shadowBlur = 18; c.shadowColor = "#9b5cff"; c.strokeStyle = "#9b5cff"; c.lineWidth = 3;
  c.beginPath(); c.moveTo(cx - near / 2, hitY); c.lineTo(cx + near / 2, hitY); c.stroke(); c.shadowBlur = 0;
  for (let l = 0; l < lanes; l++) {
    const s = lanes - 1 - l;
    c.strokeStyle = laneColor(s); c.lineWidth = 3; c.globalAlpha = 0.8;
    c.beginPath(); c.arc(xAt(l, 0), hitY, 17, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = 0.9; c.fillStyle = "#cfcdf5"; c.font = "700 12px -apple-system, sans-serif"; c.textAlign = "center";
    c.fillText(nn(d.tuning[s] % 12), xAt(l, 0), hitY + 34);
  }
  c.globalAlpha = 1;
  // the notes: far to near, held notes with a tail, a flash when they hit the line
  const from = lastAt(d.beats, T - 0.35, (b) => b[0]);
  for (let i = Math.max(0, from); i < d.beats.length; i++) {
    const [t, dur, , notes] = d.beats[i];
    if (t > T + AHEAD) break;
    const p = (t - T) / AHEAD;
    for (const [s, f, fl] of notes) {
      if (fl.includes("t") || s >= lanes) continue;
      const l = laneOf(s), col = laneColor(s);
      if (dur > 0.45 && !fl.includes("x")) {  // a held note: a tail to where it ends
        const p2 = Math.min(1, (t + dur - T) / AHEAD), p1 = Math.max(0, p);
        if (p2 > 0) { c.strokeStyle = col; c.globalAlpha = 0.55; c.lineWidth = 7 * (1 - depth(p1) * 0.6);
          c.beginPath(); c.moveTo(xAt(l, p1), yAt(p1)); c.lineTo(xAt(l, p2), yAt(p2)); c.stroke(); c.globalAlpha = 1; }
      }
      if (p < -0.02) {  // just hit: a quick flash on the line
        const a = 1 + p / 0.13;
        if (a > 0) { c.globalAlpha = a; c.shadowBlur = 30; c.shadowColor = col; c.fillStyle = col;
          c.beginPath(); c.arc(xAt(l, 0), hitY, 22 + 10 * (1 - a), 0, Math.PI * 2); c.fill(); c.shadowBlur = 0; c.globalAlpha = 1; }
        continue;
      }
      const r = 16 * (1 - depth(p) * 0.62), x = xAt(l, p), y = yAt(p);
      if (f === 0 && !fl.includes("x")) {  // open string: a bar across its lane
        c.fillStyle = col; c.shadowBlur = 14; c.shadowColor = col;
        c.fillRect(x - wAt(p) / lanes / 2 + 3, y - r * 0.45, wAt(p) / lanes - 6, r * 0.9); c.shadowBlur = 0;
      } else {
        c.shadowBlur = 16; c.shadowColor = col; c.fillStyle = fl.includes("x") ? "#77758f" : col;
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
        c.lineWidth = 2; c.strokeStyle = "#ffffff"; c.stroke();
      }
      c.fillStyle = "#0b0716"; c.font = `800 ${Math.max(9, r * 0.95)}px -apple-system, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(fl.includes("x") ? "x" : String(f), x, y + 0.5); c.textBaseline = "alphabetic";
      if (/[sbBhvioIO]/.test(fl) && r > 9) {  // technique letter above the gem
        c.fillStyle = "#ffd27a"; c.font = `800 ${Math.max(9, r * 0.7)}px -apple-system, sans-serif`;
        c.fillText(/[siIoO]/.test(fl) ? "slide" : /[bB]/.test(fl) ? "bend" : fl.includes("h") ? "h" : "~", x, y - r - 4);
      }
    }
  }
  // chord now -> next, top left
  c.textAlign = "left"; c.fillStyle = "#39ff88"; c.font = "800 26px -apple-system, sans-serif";
  c.fillText(spell(P.chord) || "", 18, 40);
  c.fillStyle = "#9a98c6"; c.font = "600 13px -apple-system, sans-serif";
  c.fillText($("#pl-next").textContent !== "-" ? `next ${$("#pl-next").textContent} ${$("#pl-in").textContent}` : "", 18, 60);
}
const _fxDraw = fxDraw;
fxDraw = function () { _fxDraw(); hwDraw(); };  // eslint-disable-line no-func-assign

/* ---------- Mute Spotify while I practise (off unless turned on) ---------- */
fetch("/api/settings").then((r) => r.json()).then((st) => { $("#o-mute").checked = !!st.mute_spotify; }).catch(() => {});
$("#o-mute").addEventListener("change", async (e) => {
  const r = await (await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mute_spotify: e.target.checked }) })).json();
  toast(r.message || (r.mute_spotify ? "Spotify will be muted while you practise" : "Spotify keeps playing"));
  refresh();
});

document.querySelectorAll("#view-settings select").forEach(pillify);
syncPills();

/* "Show" drop-downs: one opens at a time, a click anywhere else closes them */
document.addEventListener("click", (e) => {
  document.querySelectorAll("details.dd[open]").forEach((d) => { if (!d.contains(e.target)) d.removeAttribute("open"); });
});
document.querySelectorAll("details.dd").forEach((d) => d.addEventListener("toggle", () => {
  if (d.open) document.querySelectorAll("details.dd[open]").forEach((o) => { if (o !== d) o.removeAttribute("open"); });
}));

/* play / pause: MasterPrac and Spotify start together */
$("#pl-playbtn").addEventListener("click", async () => {
  const b = $("#pl-playbtn"); b.disabled = true;
  try {
    const p = await (await fetch("/api/player/toggle", { method: "POST" })).json();
    if (P.info && p.title === P.info.title) { P.info = { ...P.info, ...p }; }
  } catch (e) { toast("Couldn't reach Spotify"); }
  b.disabled = false; pollNow();
});
setInterval(() => { const b = $("#pl-playbtn"); if (b) b.innerHTML = P.info && P.info.playing ? "&#10074;&#10074;" : "&#9654;"; }, 300);

/* smooth tab: the strip slides every screen refresh (60 fps), moved by the GPU; the rest updates 20x a second */
const tabG = $("#tab-g");
tabG.style.willChange = "transform";
function tabScroll() { requestAnimationFrame(tabScroll); if (!skipFrame("tab")) tabMove(); }
setInterval(() => { if (performance.now() - (P.movedAt || 0) > 80) tabMove(); }, 50);  // backup when screen refreshes pause
function tabMove() {
  P.movedAt = performance.now();
  if (tab !== "play" || TVIEW !== "tab" || !usingTab()) return;
  const x = (P.headX || 200) - playTime() * (P.PXdraw || P.PX) - 6;
  tabG.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
}
requestAnimationFrame(tabScroll);
// string colours, looked up once (not 6x per frame)
const COLOR = { at: 0, v: [] };
function strColor(s) {
  if (performance.now() - COLOR.at > 1000) {
    const cs = getComputedStyle(document.body);
    COLOR.v = [0, 1, 2, 3, 4, 5].map((i) => cs.getPropertyValue(`--s${i}`).trim());
    COLOR.at = performance.now();
  }
  return COLOR.v[s] || "#ffd27a";
}

/* windows: a close button + Esc bring you back to Play */
document.querySelectorAll(".view.win").forEach((v) => {
  const x = document.createElement("button");
  x.className = "ghost icon win-close"; x.innerHTML = "&#10005;"; x.title = "Back to Play (Esc)";
  x.addEventListener("click", () => setTab("play"));
  v.prepend(x);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("win-open") && !document.querySelector(".pop:not(.hidden)")) setTab("play");
});

/* settings: key box, auto-hiding bars */
function setting(k, d) { try { const v = localStorage.getItem("mp-" + k); return v === null ? d : v === "1"; } catch (e) { return d; } }
function saveSetting(k, v) { try { localStorage.setItem("mp-" + k, v ? "1" : "0"); } catch (e) { /* fine */ } }
const showKey0 = setting("showkey", false), autoHide0 = setting("autohide", true);
$("#o-showkey").checked = showKey0; $("#o-autohide").checked = autoHide0;
document.body.classList.toggle("no-key", !showKey0);
$("#o-showkey").addEventListener("change", (e) => { saveSetting("showkey", e.target.checked); document.body.classList.toggle("no-key", !e.target.checked); });
$("#o-autohide").addEventListener("change", (e) => { saveSetting("autohide", e.target.checked); idle(); });
// the CHORD NOW / NEXT / WHERE boxes: off by default (the tab and fretboard already show it)
const showBoxes0 = setting("showboxes", false);
$("#o-showboxes").checked = showBoxes0; document.body.classList.toggle("no-boxes", !showBoxes0);
$("#o-showboxes").addEventListener("change", (e) => { saveSetting("showboxes", e.target.checked); document.body.classList.toggle("no-boxes", !e.target.checked); });
// top bars: hidden after 3 s without the mouse near them; back when the mouse goes to the top
let idleT = null;
function idle() {
  document.body.classList.remove("bars-hidden");
  clearTimeout(idleT);
  if ($("#o-autohide").checked) idleT = setTimeout(() => { if (!document.querySelector("details.dd[open]") && !document.body.classList.contains("win-open")) document.body.classList.add("bars-hidden"); }, 3000);
}
document.addEventListener("mousemove", (e) => { if (e.clientY < 150 || !document.body.classList.contains("bars-hidden")) idle(); });
idle();

/* sound output icon */
setInterval(async () => {
  try {
    const s = await (await fetch("/api/session")).json(), bt = s.bt || {};
    const amp = bt["HeadRush Flex Prime"], spk = bt["LP-UNF"];
    $("#pl-out").innerHTML = `<i class="${amp ? "amp" : spk ? "spk" : "mac"}"></i>${amp ? "Amp" : spk ? "Kali speakers" : "Mac"}`;
  } catch (e) { /* fine */ }
}, 4000);

/* "Now" on by default (once, for everyone who had it off) */
try {
  if (localStorage.getItem("mp-now-default") !== "1") { SHOW.jam.now = true; SHOW.learn.now = true; localStorage.setItem("pl-show", JSON.stringify(SHOW)); localStorage.setItem("mp-now-default", "1"); showChips(); }
} catch (e) { /* fine */ }

try { $("#o-autopart").checked = setting("autopart", true); $("#o-prefer").value = localStorage.getItem("mp-prefer") || "any"; syncPills(); } catch (e) { /* fine */ }
$("#o-autopart").addEventListener("change", (e) => saveSetting("autopart", e.target.checked));
$("#o-prefer").addEventListener("change", (e) => { try { localStorage.setItem("mp-prefer", e.target.value); } catch (x) { /* fine */ } });

try { document.body.classList.toggle("real-frets", setting("realfrets", false)); $("#o-realfrets").checked = setting("realfrets", false); } catch (e) { /* fine */ }
$("#o-realfrets").addEventListener("change", (e) => { saveSetting("realfrets", e.target.checked); document.body.classList.toggle("real-frets", e.target.checked); drawPlayBoard(); });

/* ---------- Song chords mode: a song sheet (chords over the lyrics), moving with the song ---------- */
function setSheet(on) {
  document.body.classList.toggle("sheet-mode", on);
  $("#sheet").classList.toggle("hidden", !on);
  $("#pl-chords").classList.toggle("on", on);
  document.querySelectorAll("[data-tview]").forEach((b) => b.classList.toggle("on", !on && b.dataset.tview === TVIEW));
  if (on) buildSheet();
}
// lyric lines with their start time in TAB time: the tab's own words, or LRCLIB lines (recording time + sync shift)
function sheetLines(d) {
  if (d.lyrics && d.lyrics.length) {
    const out = [];
    for (const [t, syl, nl] of d.lyrics) {
      if (nl || !out.length) out.push({ t, words: [] });
      out[out.length - 1].words.push([t, syl]);
    }
    return out.map((l) => ({ t: l.t, text: l.words.map(([, w]) => w).join(" ").replace(/- /g, ""), words: l.words }));
  }
  return (P.lrc || []).map(([t, line]) => ({ t: t + offsetAt(t), text: line }));
}
function buildSheet() {
  const d = P.tab;
  if (!d || d.error) { $("#sheet-lines").innerHTML = `<p class="explain">No tab for this song, so no chords to show.</p>`; return; }
  // every chord in the song, once, as a small diagram (click for a big one)
  const uniq = [...new Set(d.bars.map((b) => b.chord).filter(Boolean))].slice(0, 14);
  $("#sheet-chords").innerHTML = uniq.map((c) => `<button class="cd-btn" data-chord="${esc(c)}" title="How to play ${esc(spell(c))}">${chordSVG(spell(c), 0.8)}</button>`).join("");
  // lines: lyrics with the chord changes placed over the right word; parts of the song as headings
  const lines = sheetLines(d), end = d.bars[d.bars.length - 1].end;
  const changes = []; let last = "";
  d.bars.forEach((b) => { if (b.chord && b.chord !== last) changes.push({ t: b.t, c: b.chord }); last = b.chord || last; });
  const secs = d.bars.filter((b) => b.section).map((b) => ({ t: b.t, name: b.section }));
  let html = "", si = 0;
  const lineStarts = lines.length ? lines : [{ t: 0, text: "" }];
  const rows = [];
  // instrumental gaps (no lyrics for 6+ s) become chord-only rows, so every chord appears in order
  let prevEnd = 0;
  lineStarts.forEach((l, i) => {
    const lEnd = i + 1 < lineStarts.length ? lineStarts[i + 1].t : end;
    if (l.t - prevEnd > 6) rows.push({ t: prevEnd, end: l.t, text: "" });
    rows.push({ t: l.t, end: lEnd, text: l.text, words: l.words });
    prevEnd = lEnd;
  });
  if (end - prevEnd > 6) rows.push({ t: prevEnd, end, text: "" });
  rows.forEach((r, i) => {
    while (si < secs.length && secs[si].t <= r.t + 0.5) { html += `<h4 class="sh-sec">${esc(secs[si].name)}</h4>`; si++; }
    const cs = changes.filter((c) => c.t >= r.t - 0.3 && c.t < r.end - 0.3);
    if (!r.text) {  // instrumental: the chords in a row
      html += `<div class="sh-line inst" data-t="${r.t}" data-end="${r.end}">${cs.map((c) => `<span class="sh-c solo" data-chord="${esc(c.c)}">${esc(spell(c.c))}</span>`).join("") || `<span class="sh-dim">(instrumental)</span>`}</div>`;
      return;
    }
    // each chord sits over the word being sung when it changes (by the word's time, or by its share of the line)
    const text = r.text, n = text.length;
    const posOf = (t) => {
      if (r.words && r.words.length) {
        let acc = 0, best = 0;
        for (const [wt, w] of r.words) { if (wt <= t + 0.05) best = acc; acc += w.replace(/-$/, "").length + (w.endsWith("-") ? 0 : 1); }
        return Math.min(n - 1, best);
      }
      return Math.max(0, Math.min(n - 1, Math.round(((t - r.t) / Math.max(0.5, r.end - r.t)) * n)));
    };
    const marks = cs.map((c) => ({ at: posOf(c.t), c: c.c }));
    let top = "", used = -2;
    for (const m of marks) {
      const at = Math.max(m.at, used + 1);
      top += `<span class="sh-c" style="left:${at}ch" data-chord="${esc(m.c)}">${esc(spell(m.c))}</span>`;
      used = at + spell(m.c).length + 1;
    }
    html += `<div class="sh-line" data-t="${r.t}" data-end="${r.end}"><div class="sh-top">${top}</div><div class="sh-text">${esc(text)}</div></div>`;
  });
  $("#sheet-lines").innerHTML = html;
  P.sheetIdx = -1;
}
// follow the song: light up the line being sung and keep it in view
setInterval(() => {
  if (!document.body.classList.contains("sheet-mode") || !usingTab()) return;
  const t = playTime(), rows = [...document.querySelectorAll("#sheet-lines .sh-line")];
  const i = rows.findIndex((r) => t >= +r.dataset.t - 0.2 && t < +r.dataset.end - 0.2);
  if (i === P.sheetIdx) return;
  rows.forEach((r, k) => { r.classList.toggle("on", k === i); r.classList.toggle("past", k < i); });
  P.sheetIdx = i;
  if (rows[i]) rows[i].scrollIntoView({ block: "center", behavior: "smooth" });
}, 150);
// click a chord (in the sheet, the chord row, or the CHORD NOW box): how to play it
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-chord]");
  if (!c) return;
  const name = spell(c.dataset.chord);
  $("#cd-title").textContent = name;
  const sh = chordShape(name);
  $("#cd-body").innerHTML = `${chordSVG(name, 2)}<p class="explain">${sh ? (sh.barre ? `A barre chord: lay your first finger flat across fret ${sh.barre.fret}, then the numbers show which finger goes where.` : "Numbers = which finger (1 = index). o = play the open string, x = don't play that string.") : "No diagram for this chord yet."}</p>`;
  openPop("#pop-chord");
});
$("#pl-chord").setAttribute("data-chord", ""); $("#pl-chord").title = "Click: how to play this chord";
setInterval(() => { $("#pl-chord").dataset.chord = P.chord || ""; }, 500);

/* ---------- practice mode ---------- */
let ytApi = null;
function loadYouTubeApi() {
  if (ytApi) return ytApi;
  ytApi = new Promise((ok) => {
    window.onYouTubeIframeAPIReady = ok;
    const sc = document.createElement("script"); sc.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(sc);
  });
  return ytApi;
}
async function prSearch(q) {
  $("#pr-list").innerHTML = `<p class="explain">Searching...</p>`;
  let hits = [];
  try { hits = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json(); } catch (e) { /* none */ }
  prShow(hits);
}
async function prShow(hits) {
  if (!hits) {  // the songs you practise most
    try { const d = await (await fetch("/api/songs")).json(); hits = [...d.favorites, ...d.practised].map((x) => ({ id: x.id, title: x.title, artist: x.artist })); } catch (e) { hits = []; }
  }
  const seen = new Set();
  $("#pr-list").innerHTML = hits.filter((x) => !seen.has(x.id) && seen.add(x.id)).map((x) => `<div class="ver"><div class="ver-main"><b>${esc(x.title)}</b> <span class="sub">${esc(x.artist)}</span></div>
    <button data-practice="${x.id}" data-title="${esc(x.title)}" data-artist="${esc(x.artist)}">Practice</button></div>`).join("") || `<p class="explain">Nothing found.</p>`;
}
async function startPractice(id, title, artist) {
  closePops();
  fetch("/api/player/pause", { method: "POST" }).catch(() => {});  // Spotify pauses, so you don't hear two songs
  PR.on = true; PR.ready = false; SYNC.on = false;
  P.info = { title, artist, app: "MasterPrac", playing: false, pos: 0, at: Date.now() / 1000, duration: 0, latency: P.info ? P.info.latency : 0, match: { id } };
  $("#pl-app").textContent = "PLAYING HERE · ALWAYS IN SYNC"; $("#pl-title").textContent = title; $("#pl-artist").textContent = artist;
  P.songId = id; P.offset = 0;
  document.body.classList.add("practice"); $("#practice-bar").classList.remove("hidden"); setModeSeg("play");
  await loadTab(id, null);
  const d = P.tab;
  if (!d || d.error || !(d.videos || []).length) { toast("This tab has no recording to practise with"); stopPractice(); return; }
  $("#pk-backing").classList.toggle("hidden", !d.videos.some((v) => v.kind === "backing"));
  fetch(`/api/lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`).then((r) => r.json())
    .then((l) => { if (PR.on && P.songId === id && !(d.lyrics && d.lyrics.length) && l.lines) { P.lrc = l.lines; P.lrcSyl = l.syl || []; drawTab(); } }).catch(() => {});
  playVideo(PR.kind);
}
async function playVideo(kind, skip = 0) {
  const d = P.tab, list = d.videos.filter((v) => v.kind === kind);
  const v = list[skip] || d.videos.filter((x) => x.kind === "song")[0];
  if (!v) return;
  PR.vid = v; PR.kind = v.kind; PR.ready = false;
  document.querySelectorAll("[data-pkind]").forEach((b) => b.classList.toggle("on", b.dataset.pkind === v.kind));
  await loadYouTubeApi();
  const at = PR.yt && PR.ready ? PR.yt.getCurrentTime() : 0;
  if (PR.yt) { PR.yt.destroy(); PR.yt = null; }
  $("#yt-box").innerHTML = `<div id="yt"></div>`;
  PR.yt = new YT.Player("yt", { videoId: v.id, width: 240, height: 135, host: "https://www.youtube-nocookie.com",
    playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0, start: Math.floor(at), playsinline: 1, origin: location.origin },
    events: {
      onReady: () => { PR.ready = true; if (window.TEST_MUTE) PR.yt.mute(); PR.yt.setPlaybackRate(PR.speed || 1); PR.yt.playVideo(); },
      onStateChange: (e) => { if (P.info) P.info.playing = e.data === 1; },
      onError: () => { PR.ready = false; if (skip + 1 < list.length) playVideo(kind, skip + 1); else toast("YouTube won't play this one here: try the other track"); },
    } });
}
function stopPractice() {
  PR.on = false; PR.ready = false; SYNC.on = $("#o-autosync").checked;
  if (PR.yt) { PR.yt.destroy(); PR.yt = null; }
  document.body.classList.remove("practice"); $("#practice-bar").classList.add("hidden"); setModeSeg("follow");
  P.info = null; P.songId = null; pollNow();
}
function setModeSeg(mode) {
  document.querySelectorAll("[data-appmode]").forEach((b) => b.classList.toggle("on", b.dataset.appmode === mode));
}
// Play here: start with the song Spotify is on (its tab is already found); nothing playing -> search
function playHere() {
  const i = P.info;
  if (!PR.on && P.songId && i && i.title) { startPractice(P.songId, i.title, i.artist || ""); return; }
  setModeSeg(PR.on ? "play" : "follow");
  openPop("#pop-practice"); prShow(null); setTimeout(() => $("#pr-q").focus(), 50);
}
$("#pr-form").addEventListener("submit", (e) => { e.preventDefault(); const q = $("#pr-q").value.trim(); if (q) prSearch(q); });
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.appmode === "play" && !PR.on) playHere();
  if (b.dataset.appmode === "follow" && PR.on) stopPractice();
  if (b.id === "practice-other") { openPop("#pop-practice"); prShow(null); setTimeout(() => $("#pr-q").focus(), 50); }
  if (b.dataset.practice) startPractice(Number(b.dataset.practice), b.dataset.title, b.dataset.artist);
  if (b.id === "practice-exit") stopPractice();
  if (b.dataset.pkind && PR.on) playVideo(b.dataset.pkind);
  if (b.dataset.speed && PR.on) {
    PR.speed = Number(b.dataset.speed); if (PR.yt && PR.ready) PR.yt.setPlaybackRate(PR.speed);
    document.querySelectorAll("[data-speed]").forEach((x) => x.classList.toggle("on", x === b));
  }
}, true);
// the play button controls the video in practice mode (instead of Spotify)
$("#pl-playbtn").addEventListener("click", (e) => {
  if (!PR.on || !PR.yt || !PR.ready) return;
  e.stopImmediatePropagation();
  if (PR.yt.getPlayerState() === 1) PR.yt.pauseVideo(); else PR.yt.playVideo();
}, true);
// the time bar in practice mode
setInterval(() => {
  if (!PR.on || !PR.yt || !PR.ready) return;
  const t = PR.yt.getCurrentTime(), dur = PR.yt.getDuration() || 0;
  P.info.pos = t; P.info.at = Date.now() / 1000; P.info.duration = dur;
}, 250);

/* ---------- Party mode: every guitar part at once, each on its own fretboard ---------- */
async function setParty(on) {
  document.body.classList.toggle("party-mode", on);
  $("#party").classList.toggle("hidden", !on);
  $("#pl-party").textContent = on ? "Back to one guitar" : "All"; $("#pl-party").classList.toggle("on", on);
  if (!on || !usingTab()) return;
  const d = P.tab, parts = d.tracks.slice().sort((a, b) => (b.played || 0) - (a.played || 0)).slice(0, 4);
  $("#party").innerHTML = parts.map((t) => `<div class="party-part" data-pi="${t.i}">
    <div class="party-head"><span class="pk">${isAcoustic(t) ? "AC" : "EL"}</span><b>${esc(partName(t))}</b><span class="sub" id="party-now-${t.i}"></span></div>
    <svg class="board party-board" id="party-b-${t.i}"></svg></div>`).join("");
  P.partyTabs = {};
  for (const t of parts) P.partyTabs[t.i] = await fetchTab(P.songId, t.i);
}
setInterval(() => {
  if (!document.body.classList.contains("party-mode") || !P.partyTabs) return;
  const t = playTime();
  for (const [i, pt] of Object.entries(P.partyTabs)) {
    if (!pt || pt.error) continue;
    const bi = lastAt(pt.beats, t, (b) => b[0]), b = bi >= 0 && t < pt.beats[bi][0] + pt.beats[bi][1] + 0.05 ? pt.beats[bi] : null;
    const notes = b ? b[3].filter((n) => !n[2].includes("t")) : [];
    const sig = `${bi}|${notes.length}`, svg = $(`#party-b-${i}`);
    if (!svg || svg._sig === sig) continue;
    svg._sig = sig;
    fretboard(svg, { tuning: pt.tuning, key: null, scale: [], labels: "names", area: "all", frets: 15, now: notes, next: [] });
    const el = $(`#party-now-${i}`);
    if (el) {  // like a chord chart, thick string to thin: "3 2 0 0 3 3" (x = not played)
      const by = {}; notes.forEach(([s, f]) => { by[s] = f; });
      el.textContent = notes.length ? pt.tuning.map((_, k) => by[pt.tuning.length - 1 - k] ?? "x").join(" ") : "resting";
    }
  }
}, 80);
document.addEventListener("click", (e) => { const b = e.target.closest("#pl-party"); if (b) setParty(!document.body.classList.contains("party-mode")); });

/* practice: learn one section at a time (like a lesson): click a part to loop it; click again to stop */
function tabToVideo(t) {
  const d = P.tab, pts = PR.vid && PR.vid.points;
  if (!d || !pts) return t;
  const i = Math.max(0, Math.min(lastAt(d.bars, t, (b) => b.t), pts.length - 2)), bar = d.bars[i];
  return pts[i] + ((t - bar.t) / Math.max(0.01, bar.end - bar.t)) * (pts[i + 1] - pts[i]);
}
function prSections() {
  const d = P.tab;
  if (!d || d.error) return;
  const secs = [];
  d.bars.forEach((b, i) => { if (b.section) secs.push({ name: b.section, from: b.t, i }); });
  secs.forEach((s, k) => { s.to = k + 1 < secs.length ? secs[k + 1].from : d.bars[d.bars.length - 1].end; });
  PR.secs = secs;
  $("#pr-secs").innerHTML = `<span class="kicker">LOOP A PART</span>` + secs.map((s, k) => `<button class="chip-t" data-loop="${k}">${esc(s.name)}</button>`).join("");
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-loop]");
  if (!b || !PR.on || !PR.ready) return;
  const k = Number(b.dataset.loop);
  PR.loop = PR.loop === k ? null : k;
  document.querySelectorAll("[data-loop]").forEach((x) => x.classList.toggle("on", Number(x.dataset.loop) === PR.loop));
  if (PR.loop != null) { PR.yt.seekTo(tabToVideo(PR.secs[k].from), true); PR.yt.playVideo(); toast(`Looping ${PR.secs[k].name}. Click it again to stop`); }
});
setInterval(() => {  // the loop: back to the start of the part when it ends
  if (!PR.on || !PR.ready || PR.loop == null) return;
  const s = PR.secs[PR.loop];
  if (playTime() >= s.to - 0.05) PR.yt.seekTo(tabToVideo(s.from), true);
}, 60);
document.addEventListener("click", (e) => {
  if (!e.target.closest("#practice-lesson") || !api() || !P.info) return;
  api().browser_go(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${P.info.title} ${P.info.artist} guitar lesson tab`)}`);
  setTab("songsterr");
});
const _applyTabPr = applyTab;
applyTab = function (d, keep) { _applyTabPr(d, keep); if (PR.on) prSections(); };  // eslint-disable-line no-func-assign

/* ---------- lyrics check: the tab's words vs the recording's timed lyrics (LRCLIB) ----------
   Each line found in both gives "tab time - recording time" at that point of the song: sync points without listening,
   which also show a recording that's a bit faster or slower than the tab. */
async function lyricsCheck(d, id) {
  if (PR.on || !(d.lyrics && d.lyrics.length)) return;
  let l;
  try { l = await (await fetch("/api/lyrics")).json(); } catch (e) { return; }
  if (P.songId !== id || !l.lines || l.lines.length < 3) return;
  const key = (txt) => txt.toLowerCase().replace(/-/g, "").replace(/[^a-z0-9ğüşöçıİ ]/g, "").split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  const tabLines = sheetLines(d).map((x) => ({ t: x.t, k: key(x.text) })).filter((x) => x.k.split(" ").length >= 2);
  const used = new Set(), pts = [];
  for (const [t, line] of l.lines) {
    const k = key(line);
    if (k.split(" ").length < 2) continue;
    // the same words in the tab, the closest one in time (repeated choruses)
    const cand = tabLines.map((x, i) => ({ ...x, i })).filter((x) => x.k === k && !used.has(x.i))
      .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
    if (cand && Math.abs(cand.t - t) < 15) { used.add(cand.i); pts.push({ pos: t, off: cand.t - t }); }
  }
  if (pts.length < 3) return;
  const offs = pts.map((p) => p.off).sort((a, b) => a - b), med = offs[Math.floor(offs.length / 2)];
  const good = pts.filter((p) => Math.abs(p.off - med) < 1);
  if (good.length < 3) return;
  P.lyricPoints = good;
  if (!SYNC.points || SYNC.points.length < 2) {  // start from the lyrics; listening refines it
    SYNC.points = good.map((p) => ({ ...p }));
    P.offset = Math.round(med * 100) / 100; showOffset(); P.sig = "";
    if (SYNC.state !== "locked") { SYNC.state = "locked"; syncStatus(`In sync ${P.offset >= 0 ? "+" : ""}${P.offset.toFixed(2)} s · from lyrics`, true); }
  }
}
const _applyTabLy = applyTab;
applyTab = function (d, keep) { _applyTabLy(d, keep); if (!keep && !d.error) lyricsCheck(d, P.songId); };  // eslint-disable-line no-func-assign
