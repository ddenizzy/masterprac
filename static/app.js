// report page errors to the app log (so problems never stay invisible)
window.addEventListener("error", (e) => fetch("/api/jslog", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ msg: String(e.message), at: `${e.filename}:${e.lineno}` }) }).catch(() => {}));
window.addEventListener("unhandledrejection", (e) => fetch("/api/jslog", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ msg: String(e.reason), at: "promise" }) }).catch(() => {}));
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// the app's bridge; usable only once its functions are attached (a moment after the page loads)
const api = () => { const a = window.pywebview && window.pywebview.api; return a && typeof a.browser_place === "function" ? a : null; };
let tab = "songsterr";

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
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hidden", v.id !== `view-${name}`));
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
async function refresh() {
  try { render(await (await fetch("/api/session")).json()); } catch (e) { /* starting */ }
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
  const left = 58, right = 22, top = 40, bottom = 30;
  // real guitar spacing: frets get closer up the neck
  const scaleLen = (W - left - right) / (1 - Math.pow(2, -FR / 12));
  const fx = (f) => left + scaleLen * (1 - Math.pow(2, -f / 12));
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
    g += `<line class="string" x1="${left}" y1="${sy(s)}" x2="${W - right}" y2="${sy(s)}" style="stroke-width:${1.6 + s * 0.6}"/>`;
    g += `<text class="sname" x="4" y="${sy(s) + 4}">${nn(open % 12)}</text>`;
    for (let f = 0; f <= FR; f++) {
      const pc = (open + f) % 12;
      const isChord = chordTones.includes(pc), iv = key ? (pc - key.root + 12) % 12 : null;
      const inScale = key && scale.includes(iv);
      if (!(inScale || isChord) || !inArea(f)) continue;
      const cls = key && iv === 0 && (inScale || isChord) ? "root" : isChord ? "chord" : "scale";
      const x = f === 0 ? left - 20 : (fx(f - 1) + fx(f)) / 2, label = mode === "intervals" && key ? INTERVAL[iv] : nn(pc);
      g += `<g class="note ${cls} ${isChord ? "hot" : ""} ${o.dim ? "dim" : ""}"><circle cx="${x}" cy="${sy(s)}" r="${isChord ? r + 1.5 : r}"/><text x="${x}" y="${sy(s) + 5}">${label}</text></g>`;
    }
  });
  // what the guitarist plays now (filled) and next (outlined), on the exact string/fret
  const spot = (s, f, cls) => {
    if (s >= strings) return "";
    const x = f === 0 ? left - 20 : (fx(f - 1) + fx(f)) / 2;
    return `<g class="note ${cls}"><circle cx="${x}" cy="${sy(s)}" r="${cls === "play" ? r + 5 : r + 3}"/><text x="${x}" y="${sy(s) + 5}">${f}</text></g>`;
  };
  for (const [s, f] of o.next || []) g += spot(s, f, "next");
  for (const [s, f] of o.now || []) g += spot(s, f, "play");
  svg.innerHTML = g;
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
const playTime = () => {
  const p = P.info;
  if (!p || !p.title) return 0;
  return p.pos + (p.playing ? Date.now() / 1000 - p.at : 0) + P.offset;
};

async function pollNow() {
  if (tab !== "play") return;
  let p;
  try { p = await (await fetch("/api/now")).json(); } catch (e) { return; }
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
    P.songId = id; P.tab = null; drawTab();
    P.offset = Number(localStorage.getItem("pl-offset-" + id) || 0); showOffset();
    if (id) {
      const saved = localStorage.getItem("pl-track-" + id);
      await loadTab(id, saved === null ? null : Number(saved));
    } else { tabEmpty(p.title ? "Songsterr doesn't have this exact song: MasterPrac listens and works the chords out by ear." : "The song's tab scrolls here while it plays."); }
  }
  headsUp();
}
setInterval(pollNow, 1000);

async function loadTab(id, track) {
  tabEmpty("Pulling the tab from Songsterr...");
  let d;
  try { d = await (await fetch(`/api/now/tab/${id}` + (track !== null && track !== undefined ? `?lead=${track}` : ""))).json(); }
  catch (e) { d = { error: "Couldn't reach Songsterr." }; }
  if (P.songId !== id) return;  // the song changed meanwhile
  P.tab = d; P.track = d.lead; P.sig = ""; P.barIdx = -1; P.beatIdx = -1;
  if (d.error) { tabEmpty(esc(d.error) + " Chords by ear instead."); return; }
  P.key = { root: d.key.root, minor: d.key.minor };
  $("#tab-part").innerHTML = d.tracks.map((t) => `<option value="${t.i}" ${t.i === d.lead ? "selected" : ""}>${esc(partName(t))}${t.played != null ? ` (plays ${t.played} of ${d.bars.length} bars)` : ""}</option>`).join("");
  $("#tab-partbox").classList.toggle("hidden", d.tracks.length < 1);
  drawTab(); buildMap(); headsUp(); drawPlayBoard();
}

// "Thom Yorke | Takamine EN10C | Rhythm Guitar" -> "Thom Yorke · Rhythm Guitar"
function partName(t) {
  const bits = (t.name || "").split("|").map((x) => x.trim()).filter(Boolean);
  return (bits.length >= 3 ? [bits[0], bits[bits.length - 1]] : bits).join(" · ") || t.instrument || "Guitar";
}
// is the followed part silent around bar bi? then say so, and offer the guitar that IS playing
function restNote(bi) {
  const d = P.tab, me = d.tracks.find((t) => t.i === d.lead), box = $("#tab-rest");
  if (!me || !me.active || me.active[bi] === "1" || me.active[bi + 1] === "1") { box.classList.add("hidden"); return; }
  let n = 0; while (bi + n < me.active.length && me.active[bi + n] !== "1") n++;
  const other = d.tracks.find((t) => t.i !== d.lead && t.active && t.active[bi] === "1");
  const left = bi + n >= me.active.length;
  box.innerHTML = other || !tabIncomplete()
    ? `${left ? "This part is done for the song." : `This part rests here for ${n} bar${n > 1 ? "s" : ""}.`}
      ${other ? `<button class="ghost" data-part="${other.i}">Follow ${esc(partName(other))} instead</button>` : ""}`
    : `Songsterr's tab has no guitar written here (it's unfinished). The chords above still follow the song.`;
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
  loadTab(P.songId, Number(i));
}

function tabEmpty(msg) {
  $("#tab-empty").innerHTML = msg; $("#tab-empty").classList.remove("hidden"); $("#tab-svg").classList.add("hidden");
}

// the whole tab as one long strip; it slides left under a fixed playhead as the song plays
function drawTab() {
  const d = P.tab, svg = $("#tab-svg"), g = $("#tab-g");
  if (!d || d.error || !d.beats) { g.innerHTML = ""; return; }
  $("#tab-empty").classList.add("hidden"); svg.classList.remove("hidden");
  // spread the tab out for busy songs: the closest notes (10th percentile) get ~26 px between them
  const gaps = d.beats.slice(1).map((b, i) => b[0] - d.beats[i][0]).filter((x) => x > 0.02).sort((a, b) => a - b);
  P.PX = gaps.length ? Math.max(120, Math.min(320, 26 / gaps[Math.floor(gaps.length * 0.1)])) : 150;
  const PX = P.PX, y0 = 50, gap = 17, ys = (s) => y0 + s * gap, n = d.tuning.length, yEnd = ys(n - 1);
  let h = "";
  const end = d.bars[d.bars.length - 1].end;
  h += d.tuning.map((_, s) => `<line class="tline" x1="0" y1="${ys(s)}" x2="${end * PX}" y2="${ys(s)}"/>`).join("");
  let lastChord = "";
  d.bars.forEach((b, i) => {
    const x = b.t * PX;
    h += `<line class="tbar" x1="${x}" y1="${y0}" x2="${x}" y2="${yEnd}"/><text class="tnum" x="${x + 3}" y="${y0 - 6}">${i + 1}</text>`;
    if (b.section) h += `<text class="tsec" x="${x + 3}" y="14">${esc(b.section)}</text>`;
    if (b.chord && b.chord !== lastChord) h += `<text class="tchord" x="${x + 3}" y="31">${esc(spell(b.chord))}</text>`;
    lastChord = b.chord;
  });
  d.beats.forEach(([t, dur, bar, notes, bf], i) => {
    const x = t * PX + 6;
    let s = `<g class="tb" id="tb${i}">`;
    for (const [st, f, fl] of notes) {
      let label = fl.includes("x") ? "x" : fl.includes("H") ? `<${f}>` : fl.includes("g") || fl.includes("t") ? `(${f})` : String(f);
      if (fl.includes("b")) label += "b"; if (fl.includes("h")) label += "h"; if (fl.includes("s")) label += "/"; if (fl.includes("v")) label += "~";
      const w = label.length * 7 + 4;
      s += `<rect class="tbg" x="${x - 2}" y="${ys(st) - 7}" width="${w}" height="14"/><text class="tnote ${fl.includes("t") ? "tied" : ""}" x="${x}" y="${ys(st) + 4}">${esc(label)}</text>`;
    }
    if (bf) s += `<text class="tflag" x="${x}" y="${yEnd + 16}">${bf.replace("pm", "P.M.").replace("lr", "let ring").replace("tr", "tremolo")}</text>`;
    h += s + "</g>";
  });
  g.innerHTML = h;
  // string names stay put on the left while the tab slides under them
  $("#tab-names").innerHTML = `<rect class="tnames-bg" x="0" y="${y0 - 10}" width="24" height="${yEnd - y0 + 20}"/>` +
    d.tuning.map((open, s) => `<text class="tname" x="12" y="${ys(s) + 4}">${nn(open % 12)}</text>`).join("");
  layoutTab();
}
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
    const shown = Math.max(0, t - P.offset);
    $("#pl-pos").textContent = fmtT(shown); $("#pl-dur").textContent = fmtT(p.duration || 0);
    $("#pl-fill").style.width = p.duration ? `${Math.min(100, (shown / p.duration) * 100)}%` : "0";
  }
  if (!usingTab()) return;
  const d = P.tab;
  $("#tab-g").setAttribute("transform", `translate(${(P.headX || 200) - t * P.PX - 6},0)`);
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
  const ei = lastAt(d.events, t, (e) => e[0]);
  const cur = ei >= 0 && t < d.events[ei][0] + d.events[ei][1] ? d.events[ei] : null;
  const bt = lastAt(d.beats, t, (b) => b[0]);
  if (bt !== P.beatIdx) {
    document.getElementById("tb" + P.beatIdx)?.classList.remove("on");
    if (bt >= 0 && t < d.beats[bt][0] + d.beats[bt][1]) document.getElementById("tb" + bt)?.classList.add("on");
    P.beatIdx = bt;
  }
  const sig = `${bi}|${P.mode === "learn" ? ei + "|" + (cur ? 1 : 0) : ""}`;
  if (sig === P.sig) return;
  P.sig = sig;
  P.nowNotes = cur ? cur[2] : [];
  P.nextNotes = d.events.slice(ei + 1).filter((e) => e[0] - t < 1.2).slice(0, 4).flatMap((e) => e[2]);
  if (bi !== P.barIdx) {
    P.barIdx = bi;
    const section = d.bars.slice(0, bi + 1).reverse().find((b) => b.section)?.section || "Start";
    $("#pl-section").textContent = section;
    $("#pl-barno").textContent = `bar ${bi + 1} of ${d.bars.length}`;
    $("#pl-next").textContent = nextBar ? spell(nextBar.chord) : "-";
    document.querySelectorAll("#pl-map .ch").forEach((el) => el.classList.toggle("now", bi >= +el.dataset.from && bi <= +el.dataset.to));
    setChord(bar.chord || "", nextBar ? nextBar.chord : "");
    restNote(bi);
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
const TECH = { b: "bends", s: "slides", h: "hammer-ons / pull-offs", x: "muted (scratchy) notes", v: "vibrato", H: "harmonics",
  pm: "palm mute (rest your picking hand on the strings)", lr: "let the notes ring", tr: "fast tremolo picking" };
function headsUp(extra) {
  const out = [], d = usingTab() ? P.tab : null;
  if (extra) out.push(extra);
  if (d) {
    const bi = Math.max(0, P.barIdx);
    if (JSON.stringify(d.tuning) !== JSON.stringify(STD)) out.push(`<b>Tuning: ${esc(d.tuning_name)}</b>: tune your guitar to this first.`);
    const most = tabIncomplete();
    if (most !== false) out.push(`<b>Unfinished tab:</b> Songsterr only has guitar written for ${most} of ${d.bars.length} bars. Chords still work; for the rest try Options → by ear.`);
    const nextSec = d.bars.slice(bi + 1).findIndex((b) => b.section);
    if (nextSec >= 0 && nextSec < 4) out.push(`<b>${esc(d.bars[bi + 1 + nextSec].section)}</b> ${nextSec === 0 ? "starts next bar" : `in ${nextSec + 1} bars`}.`);
    const soon = d.beats.filter((b) => b[2] >= bi && b[2] <= bi + 2);
    const tech = new Set();
    soon.forEach(([, , , notes, bf]) => { notes.forEach((n) => [...n[2]].forEach((c) => TECH[c] && c !== "t" && tech.add(TECH[c]))); bf.split(" ").forEach((f) => TECH[f] && tech.add(TECH[f])); });
    if (tech.size) out.push(`Coming up: ${[...tech].join(", ")}.`);
    const note = d.beats.find((b) => b[5] && b[2] >= bi - 1 && b[2] <= bi + 2);
    if (note) out.push(`Tab note: "${esc(note[5].slice(0, 140))}${note[5].length > 140 ? "..." : ""}"`);
  } else if (P.info && P.info.title) out.push(P.src === "ear" || !P.info.match ? "Chords by ear: a change shows after about a bar." : "Pulling the tab from Songsterr...");
  $("#pl-heads-list").innerHTML = out.slice(0, 4).map((x) => `<li>${x}</li>`).join("") || `<li class="sub">Nothing special right now: just play.</li>`;
}

// under the fretboard: what to do, in one line
function foot(next) {
  const k = P.key, c = chordInfo(P.chord), n = chordInfo(next);
  if (!k) { $("#pl-foot").innerHTML = ""; return; }
  const chip = (pc) => `<span class="${pc === k.root ? "root" : c && c.tones.includes(pc) ? "chord" : ""}">${nn(pc)}</span>`;
  if (P.mode === "learn") {
    const strs = P.nowNotes.map(([s, f]) => `string ${s + 1} fret ${f}`).join(", ");
    $("#pl-foot").innerHTML = `<div><span class="kicker">PLAY NOW</span> ${strs ? `<b>${strs}</b>` : `<span class="sub">rest</span>`}</div>
      <div class="sub"><i class="dot play"></i>red = play this now &nbsp; <i class="dot next"></i>dashed = coming next &nbsp; numbers = frets &nbsp; string 1 = thinnest</div>`;
    return;
  }
  const lowE = ((k.root - (P.tab && usingTab() ? P.tab.tuning[P.tab.tuning.length - 1] : 40)) % 12 + 12) % 12;
  $("#pl-foot").innerHTML = `
    <div><span class="kicker">SAFE NOTES</span> <span class="notes">${SCALES.pent(k.minor).map((i) => chip((k.root + i) % 12)).join("")}</span></div>
    <div><span class="kicker">LAND ON NOW</span> <span class="notes">${c ? c.tones.map((pc) => `<span class="chord">${nn(pc)}</span>`).join("") : "-"}</span>
      ${n ? `<span class="sub">then ${esc(spell(next))}: ${n.tones.map((pc) => nn(pc)).join(" ")}</span>` : ""}</div>
    <div class="sub">Start at <b>${lowE === 0 ? "the open thickest string (or fret 12)" : `fret ${lowE} of the thickest string`}</b>: that's ${nn(k.root)}, home.</div>`;
}

function drawPlayBoard() {
  if (tab !== "play") return;
  const k = P.key, c = chordInfo(P.chord), which = $("#o-scale").value, learn = P.mode === "learn";
  let key = k, scale = k ? SCALES[which](k.minor) : [];
  if (which === "chord" && c) { key = { root: c.root, minor: c.minor }; scale = [0]; }
  fretboard($("#pl-board"), { tuning: usingTab() ? P.tab.tuning : STD, key, scale, chordTones: !learn && c ? c.tones : [],
    labels: $("#o-labels").value, area: $("#o-area").value, dim: learn,
    frets: learn && usingTab() ? Math.min(22, Math.max(15, ...P.tab.events.flatMap((e) => e[2].map((x) => x[1] + 1)))) : 15,
    now: learn ? P.nowNotes : [], next: learn ? P.nextNotes : [] });
  if (learn) foot();
}

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
    foot(); headsUp(); drawPlayBoard();
  }
  if (b.id === "pl-options") openPop("#pop-options");
  if (b.id === "pl-chords") { buildMap(); P.barIdx = -1; openPop("#pop-chords"); }
  if (b.dataset.nudge && P.songId) {
    P.offset = Math.round((P.offset + Number(b.dataset.nudge)) * 100) / 100;
    localStorage.setItem("pl-offset-" + P.songId, P.offset); showOffset();
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
  let g;
  try { g = await (await fetch("/api/guide")).json(); } catch (e) { return; }
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
async function loadSongs() {
  let d;
  try { d = await (await fetch("/api/songs")).json(); } catch (e) { return; }
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
loadSongs();


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
