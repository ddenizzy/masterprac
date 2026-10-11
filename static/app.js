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
  if (tab !== "songsterr") { api().browser_hide(); return; }
  const r = $("#browser-area").getBoundingClientRect();
  api().browser_place(r.left, r.top, r.width, r.height);
}
new ResizeObserver(placeBrowser).observe($("#browser-area"));
window.addEventListener("resize", placeBrowser);
window.addEventListener("pywebviewready", placeBrowser);

function setTab(name) {
  tab = name;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hidden", v.id !== `view-${name}`));
  placeBrowser();
  if (name === "notes") { drawBoard(); if (live.mode === "tab") loadTab(); }
  if (name === "now") { pollNow(); drawNow(); }
  if (name === "amp") { guideSeen = guideFor; $("#guide-ready").classList.add("hidden"); loadGuide(); loadAmp(); }
  if (name === "songs") loadSongs();
  if (name === "learn") { if (!tabState.data) loadTab().then(renderLessons); renderLessons(); }
}

function render(s) {
  $("#song-chip").textContent = s.song ? `${s.song.title} · ${s.song.artist}` : "No song yet";
  if (s.song && typeof tabState !== "undefined" && tabState.songId && tabState.songId !== s.song.id && tab === "notes" && live.mode === "tab") loadTab();
  const gt = s.song && s.song.tracks.find((t) => /guitar/i.test(t.instrument) && t.tuning);
  if (gt && JSON.stringify(gt.tuning) !== JSON.stringify(live.tuning)) { live.tuning = gt.tuning; if (tab === "notes") drawBoard(); }
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

/* ======================= music: notes, scales, chords ======================= */
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = { Db: 1, Eb: 3, Gb: 6, Ab: 8, Bb: 10 };
const noteIndex = (n) => (FLATS[n] ?? NOTES.indexOf(n.toUpperCase().replace("♯", "#")));
const INTERVAL = ["R", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];
const SCALES = {
  "minor pentatonic": [0, 3, 5, 7, 10], "major pentatonic": [0, 2, 4, 7, 9], "blues": [0, 3, 5, 6, 7, 10],
  "natural minor": [0, 2, 3, 5, 7, 8, 10], "major": [0, 2, 4, 5, 7, 9, 11], "dorian": [0, 2, 3, 5, 7, 9, 10],
  "mixolydian": [0, 2, 4, 5, 7, 9, 10],
};
// plain-words name in the menu + what it's for (shown under the menus)
const SCALE_INFO = {
  "minor pentatonic": ["Minor pentatonic (start here)", "The 5 safest notes for a sad / rock / blues song. Almost nothing you play from these sounds wrong. Most rock solos use it."],
  "major pentatonic": ["Major pentatonic (happy songs)", "The 5 safest notes for a happy / country / pop song. Same idea as minor pentatonic, brighter sound."],
  "blues": ["Blues (minor pentatonic + 1)", "Minor pentatonic plus one spicy \"blue\" note. Slide through that extra note, don't stop on it."],
  "natural minor": ["Natural minor (all 7 notes)", "Every note of a minor key. More notes = more melodic, but 2 of them can clash if you hold them. Try after the pentatonic."],
  "major": ["Major (all 7 notes)", "Every note of a major key (do-re-mi). Try after the major pentatonic."],
  "dorian": ["Dorian (jazzy / funky minor)", "A minor sound that's a bit brighter. Santana's \"Oye Como Va\", funk, and many Pink Floyd jams."],
  "mixolydian": ["Mixolydian (bluesy major)", "A major sound with a rough edge. Classic rock and jam bands (Grateful Dead, Allman Brothers)."],
};
$("#scale").innerHTML = Object.keys(SCALES).map((s) => `<option value="${s}">${SCALE_INFO[s][0]}</option>`).join("");
const SHOW_INFO = {
  names: "Each dot shows its note name (A, C#...).",
  intervals: "Each dot shows its job in the key: R = root (home), b3 = the sad minor note, 5 = the strong note, b7 = the bluesy note. Shapes stay the same in every key.",
};
function explainMenus() {
  const area = $("#area").value;
  $("#menu-help").innerHTML = `<b>Scale:</b> which notes are lit up. ${SCALE_INFO[$("#scale").value][1]}
    <br><b>Show:</b> ${SHOW_INFO[$("#labels").value]}
    <br><b>Area:</b> ${area === "all" ? "Every safe note on the whole neck." : `Box ${area} is one hand position (about 4 frets) where you can reach all the notes without sliding. Learn Box 1 first.`}`;
}
const live = { key: null, keyMinor: true, keySrc: "", chord: null, history: [], chroma: Array(12).fill(0), acc: Array(12).fill(0),
  tuning: [64, 59, 55, 50, 45, 40], userScale: false };

// "C# minor", "Eb major (relative ...)" -> {root, minor}
function parseKey(text) {
  const m = /([A-G](?:#|b)?)\s*(minor|min|m\b|major|maj)?/i.exec(text || "");
  if (!m) return null;
  return { root: noteIndex(m[1].length > 1 && m[1][1] === "b" ? m[1] : m[1].toUpperCase()), minor: /^m(in|inor)?$/i.test(m[2] || "") || /minor/i.test(m[2] || "") };
}
// a key from what's been heard (Krumhansl-Schmuckler profiles), when no guide key is known
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
// best major/minor triad for the 12 note strengths
// chords that belong to the key (I ii iii IV V vi for major, i III iv v VI VII for minor) get a bonus:
// the band mostly plays those, so passing notes can't flip the display to a random chord
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
    const on = tones.reduce((s, t) => s + c[t], 0) + c[r] * 0.5;  // the root counts a bit extra
    const off = c.reduce((s, v, i) => s + (tones.includes(i) ? 0 : v), 0) / 9;
    const score = on - off * 2 + (inKey(r, q, key) ? 0.25 : 0);
    const cand = { root: r, q, tones, score };
    if (!best || score > best.score) { second = best; best = cand; } else if (!second || score > second.score) second = cand;
  }
  best.margin = best.score - (second ? second.score : 0);
  return best;
}

/* ======================= the fretboard ======================= */
let FRETS = 15;
// One fretboard drawing used by every page. o = {tuning, key, scale (intervals), chordTones, labels, area, frets, now, next}
function fretboard(svg, o) {
  const W = svg.clientWidth || 1000, H = 270, FR = o.frets || 15;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const left = 46, right = 18, top = 38, bottom = 30;
  // real guitar spacing: frets get closer up the neck
  const scaleLen = (W - left - right) / (1 - Math.pow(2, -FR / 12));
  const fx = (f) => left + scaleLen * (1 - Math.pow(2, -f / 12));
  const tuning = o.tuning, strings = tuning.length, sy = (s) => top + (s * (H - top - bottom)) / (strings - 1);
  const key = o.key, scale = o.scale, chordTones = o.chordTones || [], mode = o.labels, area = o.area || "all";
  // box positions (pentatonic boxes) start on the scale notes of the low string, from the root
  const lowOpen = tuning[strings - 1] % 12;
  const rootFret = key ? ((key.root - lowOpen) % 12 + 12) % 12 : 0;
  const boxFrom = area === "all" || !key ? 0 : (rootFret + [0, 3, 5, 7, 10][Number(area) - 1]) % 12;
  const inArea = (f) => area === "all" || !key || (f >= boxFrom - 1 && f <= boxFrom + 4) || (f >= boxFrom + 11 && f <= boxFrom + 16);
  let g = "";
  for (let f = 1; f <= FR; f++) g += `<line class="fret ${f === 12 ? "twelve" : ""}" x1="${fx(f)}" y1="${top}" x2="${fx(f)}" y2="${H - bottom}"/>`;
  g += `<rect class="nut" x="${left - 5}" y="${top - 2}" width="6" height="${H - top - bottom + 4}"/>`;
  for (const f of [3, 5, 7, 9, 15, 17, 19, 21].filter((f) => f <= FR)) g += `<circle class="inlay" cx="${(fx(f - 1) + fx(f)) / 2}" cy="${H - bottom + 16}" r="4"/>`;
  g += `<circle class="inlay" cx="${(fx(11) + fx(12)) / 2 - 7}" cy="${H - bottom + 16}" r="4"/><circle class="inlay" cx="${(fx(11) + fx(12)) / 2 + 7}" cy="${H - bottom + 16}" r="4"/>`;
  for (let f = 1; f <= FR; f++) g += `<text class="fnum" x="${(fx(f - 1) + fx(f)) / 2}" y="${top - 20}">${f}</text>`;
  tuning.forEach((open, s) => {
    g += `<line class="string" x1="${left}" y1="${sy(s)}" x2="${W - right}" y2="${sy(s)}" style="stroke-width:${1 + s * 0.35}"/>`;
    g += `<text class="sname" x="${left - 26}" y="${sy(s) + 4}">${NOTES[open % 12]}</text>`;
    for (let f = 0; f <= FR; f++) {
      const pc = (open + f) % 12;
      const isChord = chordTones.includes(pc), iv = key ? (pc - key.root + 12) % 12 : null;
      const inScale = key && scale.includes(iv);
      if (!(inScale || isChord) || !inArea(f)) continue;
      const cls = key && iv === 0 ? "root" : isChord ? "chord" : "scale";
      const x = f === 0 ? left - 16 : (fx(f - 1) + fx(f)) / 2, label = mode === "intervals" && key ? INTERVAL[iv] : NOTES[pc];
      g += `<g class="note ${cls} ${isChord ? "hot" : ""}"><circle cx="${x}" cy="${sy(s)}" r="${isChord ? 13 : 11}"/><text x="${x}" y="${sy(s) + 4}">${label}</text></g>`;
    }
  });
  // follow-the-tab overlay: what the lead guitar plays now (filled) and next (outlined), on the exact string/fret
  const spot = (s, f, cls) => {
    if (s >= strings) return "";
    const x = f === 0 ? left - 16 : (fx(f - 1) + fx(f)) / 2;
    return `<g class="note ${cls}"><circle cx="${x}" cy="${sy(s)}" r="${cls === "play" ? 16 : 14}"/><text x="${x}" y="${sy(s) + 4}">${f}</text></g>`;
  };
  for (const [s, f] of o.next || []) g += spot(s, f, "next");
  for (const [s, f] of o.now || []) g += spot(s, f, "play");
  svg.innerHTML = g;
}
function drawBoard() {
  const tabMode = live.mode === "tab";
  fretboard($("#board"), { tuning: live.tuning, key: live.key, scale: SCALES[$("#scale").value], labels: $("#labels").value,
    area: $("#area").value, frets: FRETS, chordTones: tabMode ? (live.barChordTones || []) : live.chord ? live.chord.tones : [],
    now: tabMode ? live.nowNotes : [], next: tabMode ? live.nextNotes : [] });
}
["scale", "labels", "area"].forEach((id) => $("#" + id).addEventListener("change", () => { if (id === "scale") live.userScale = true; explainMenus(); drawBoard(); }));
explainMenus();
new ResizeObserver(drawBoard).observe($("#board"));

function showKey() {
  const k = live.key;
  $("#key-name").textContent = k ? `${NOTES[k.root]} ${k.minor ? "minor" : "major"}` : "listening...";
  $("#key-src").textContent = live.keySrc;
  if (k && !live.userScale) $("#scale").value = k.minor ? "minor pentatonic" : "major pentatonic";
  explainMenus();
}

// ~8 times a second while the LIVE NOTES tab is open. Stable on purpose (from chord-recognition research):
// the sound is averaged over ~1.2 s, chords in the key are preferred, and a new chord has to keep winning for
// about one bar (from the song's tempo) before the display changes. HOLD freezes chord and key.
const POLL = 120;
let smooth = Array(12).fill(0), challenger = null, challengerSince = 0, keyGuess = null, keyGuessSince = 0;
const barSeconds = () => Math.min(3, Math.max(1.2, 4 * 60 / (live.bpm || 100)));
async function pollLive() {
  if (tab !== "notes" || live.mode === "tab") return;
  let d;
  try { d = await (await fetch("/api/live")).json(); } catch (e) { return; }
  if (!d.live || d.rms < 0.004) {
    $("#live-status").textContent = d.error || "Silent: play the song (Songsterr's player or Spotify) and the chord follows it.";
    return;
  }
  if (d.onset) { const b = $("#beat"); b.classList.remove("on"); void b.offsetWidth; b.classList.add("on"); }
  if (live.hold) { $("#live-status").textContent = "On hold: chord and key are frozen. Press Hold again to follow the song."; return; }
  $("#live-status").textContent = `Following the song: a chord change shows after about ${barSeconds().toFixed(1)} s (one bar).`;
  let c = d.chroma;
  if ($("#focus").value === "guitar" && d.chroma_mid) c = d.chroma_mid;
  const k = Math.exp(-POLL / 1000 / 1.2);  // ~1.2 s memory
  smooth = smooth.map((v, i) => v * k + c[i] * (1 - k));
  live.acc = live.acc.map((v, i) => v * 0.997 + c[i]);  // long memory for guessing the key
  const cand = detectChord(smooth, live.key), now = performance.now() / 1000;
  const id = (x) => x && `${x.root}${x.q}`;
  if (!live.chord) { setChord(cand); }
  else if (id(cand) === id(live.chord)) { challenger = null; }
  else {
    if (id(cand) !== id(challenger)) { challenger = cand; challengerSince = now; }
    if (now - challengerSince >= barSeconds() && cand.margin > 0.05) { setChord(cand); challenger = null; }
  }
  if (live.keySrc !== "from the song guide") {  // no guide key: change the key only after ~10 steady seconds
    const g = guessKey(live.acc);
    if (!keyGuess || g.root !== keyGuess.root || g.minor !== keyGuess.minor) { keyGuess = g; keyGuessSince = now; }
    if ((!live.key || now - keyGuessSince > 10) && (!live.key || live.key.root !== g.root || live.key.minor !== g.minor)) {
      live.key = g; live.keySrc = "heard from the music"; showKey(); drawBoard();
    }
  }
}
function setChord(c) {
  live.chord = c;
  const name = NOTES[c.root] + c.q;
  $("#now-chord").textContent = name;
  live.trail = [...(live.trail || []), name].slice(-10);
  $("#trail").innerHTML = `<span class="now-label">HEARD</span> ` + live.trail.map((n, i) =>
    `<span class="ch ${i === live.trail.length - 1 ? "now" : ""}">${n}</span>`).join("");
  highlightProg(name);
  drawBoard();
}
setInterval(pollLive, 120);

function highlightProg(name) {
  document.querySelectorAll("#prog .ch").forEach((el) => el.classList.toggle("now", el.textContent === name));
}

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
    const k = parseKey(x.key);
    if (k) { live.key = k; live.keySrc = "from the song guide"; live.userScale = false; showKey(); drawBoard(); }
    live.bpm = x.tempo_bpm || 100;
    $("#prog").innerHTML = x.chords ? `<span class="now-label">PROGRESSION</span> ${esc(x.chords).replace(/\b([A-G][#b]?m?(?:7|maj7|sus[24]|add9|5)?)\b/g, '<span class="ch">$1</span>')}` : "";
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
        <button class="ghost" data-go="notes">Show it on the fretboard</button>
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

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.id === "hold") { live.hold = !live.hold; b.classList.toggle("on", live.hold); b.textContent = live.hold ? "Holding" : "Hold"; }
  if (b.dataset.go) { if (b.dataset.go === "amp") guideSeen = guideFor; setTab(b.dataset.go); $("#guide-ready").classList.add("hidden"); }
  if (b.id === "fav-btn") { await fetch("/api/songs/fav", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); loadSongs(); toast("Saved in My songs"); }
  if (b.dataset.unfav) { await fetch("/api/songs/fav", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: Number(b.dataset.unfav) }) }); loadSongs(); }
  if (b.dataset.url && api()) { api().browser_go(b.dataset.url); setTab("songsterr"); }
});


/* ======================= FOLLOW THE TAB ======================= */
// The lead guitar's exact notes from the song's tab, synced to Spotify's play position (it keeps
// running while muted) using Songsterr's bar timings for the real recording.
live.mode = "tab";
const tabState = { data: null, songId: null, pos: null, offset: 0, evIndex: -1, lastDraw: "" };
const norm = (s) => String(s || "").toLowerCase().replace(/\(.*?\)|-.*$/g, "").replace(/[^a-z0-9]/g, "");
const chordTonesOf = (name) => {
  const m = /^([A-G]#?)(m?)$/.exec(name || "");
  if (!m) return [];
  const r = NOTES.indexOf(m[1]);
  return (m[2] ? [0, 3, 7] : [0, 4, 7]).map((i) => (r + i) % 12);
};
async function loadTab() {
  const s = await (await fetch("/api/session")).json();
  if (!s.song) { tabInfo("Open a song in the Songsterr tab first."); return; }
  if (tabState.songId === s.song.id && tabState.data) return;
  tabInfo(`Loading the tab of "${esc(s.song.title)}"...`);
  const r = await fetch("/api/tab");
  const d = await r.json();
  if (!r.ok) { tabInfo(esc(d.error)); return; }
  tabState.data = d; tabState.songId = s.song.id; tabState.song = s.song;
  tabState.offset = Number(localStorage.getItem("mp-offset-" + s.song.id) || 0);
  live.tuning = d.tuning;
  FRETS = Math.min(22, Math.max(15, ...d.events.flatMap((e) => e[2].map((n) => n[1] + 1))));
  live.key = { root: d.key.root, minor: d.key.minor }; live.keySrc = "from the tab"; live.userScale = false; showKey();
  $("#prog").innerHTML = "";
  drawBoard();
}
function tabInfo(html) { $("#tabinfo").innerHTML = html; }
async function pollPos() {
  if (tab !== "notes" || live.mode !== "tab") return;
  try { const p = await (await fetch("/api/pos")).json(); p.local = performance.now(); tabState.pos = p; } catch (e) { /* retry */ }
}
setInterval(pollPos, 400);
// binary search: the last item whose time is <= t
const lastAt = (arr, t, key) => { let lo = 0, hi = arr.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (key(arr[m]) <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
function tabTick() {
  if (tab !== "notes" || live.mode !== "tab") return;
  const d = tabState.data, p = tabState.pos;
  if (!d) return;
  if (!p || p.state === "off") { tabInfo("Spotify isn't open. Play the song on Spotify (muted is fine) and the fretboard follows the tab."); return; }
  const sameSong = norm(p.title).startsWith(norm(tabState.song.title).slice(0, 8)) || norm(tabState.song.title).startsWith(norm(p.title).slice(0, 8));
  const t = p.pos + (p.state === "playing" ? (performance.now() - p.local) / 1000 : 0) + tabState.offset;
  const bi = lastAt(d.bars, t, (b) => b.t), bar = d.bars[Math.max(0, bi)];
  const section = d.bars.slice(0, bi + 1).reverse().find((b) => b.section)?.section || "";
  const next = d.bars.slice(bi + 1).find((b) => b.chord && b.chord !== bar.chord);
  const ei = lastAt(d.events, t, (e) => e[0]);
  const cur = ei >= 0 && t < d.events[ei][0] + d.events[ei][1] ? d.events[ei] : null;
  const upcoming = d.events.slice(ei + 1).filter((e) => e[0] - t < 1.2).slice(0, 4);
  live.nowNotes = cur ? cur[2] : [];
  live.nextNotes = upcoming.flatMap((e) => e[2]);
  live.barChordTones = chordTonesOf(bar.chord);
  $("#now-chord").textContent = bar.chord || "-";
  const key = `${ei}|${bi}|${upcoming.length}`;
  if (key !== tabState.lastDraw) { tabState.lastDraw = key; drawBoard(); }
  tabInfo(`${sameSong ? "" : `<b class="warn">Spotify is playing "${esc(p.title)}", not this song: play this song on Spotify to sync.</b><br>`}
    <b>${esc(section || "-")}</b> · bar ${bi + 1}/${d.bars.length} · chord <b>${esc(bar.chord || "-")}</b>${next ? ` &#8594; next <b>${esc(next.chord)}</b>` : ""}
    · ${p.state === "playing" ? "playing" : "paused"} ${fmtT(t)}
    <span class="nudge">timing <button class="ghost icon" data-nudge="-0.25" title="Notes come too late">&#8722;</button>${tabState.offset >= 0 ? "+" : ""}${tabState.offset.toFixed(2)} s<button class="ghost icon" data-nudge="0.25" title="Notes come too early">+</button></span>
    <span class="sub">Lead: ${esc(d.lead_name.split("|").slice(-2).join("·"))}${d.synced ? "" : " (not synced to the recording: timing from the tempo)"}</span>`);
}
const fmtT = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
setInterval(tabTick, 100);  // a timer, not animation frames: keeps going when the window is in the background
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.follow) {
    live.mode = b.dataset.follow;
    document.querySelectorAll("[data-follow]").forEach((x) => x.classList.toggle("on", x === b));
    document.body.classList.toggle("tabmode", live.mode === "tab");
    if (live.mode === "tab") loadTab(); else { tabInfo("Listening to the music: chords follow what's heard."); live.nowNotes = live.nextNotes = []; drawBoard(); }
  }
  if (b.dataset.nudge && tabState.songId) {
    tabState.offset = Math.round((tabState.offset + Number(b.dataset.nudge)) * 100) / 100;
    localStorage.setItem("mp-offset-" + tabState.songId, tabState.offset);
  }
});
document.body.classList.add("tabmode");


/* ======================= LEARN: how keys work + ask Claude ======================= */
function songKey() {
  const k = live.key || { root: 9, minor: true };
  return { ...k, name: `${NOTES[k.root]} ${k.minor ? "minor" : "major"}`, rel: k.minor ? `${NOTES[(k.root + 3) % 12]} major` : `${NOTES[(k.root + 9) % 12]} minor` };
}
const scaleNotes = (root, ivs) => ivs.map((i) => NOTES[(root + i) % 12]).join(" ");
function fretOf(note, open) { return ((NOTES.indexOf(note) - open % 12) + 12) % 12; }
function renderLessons() {
  const k = songKey(), song = (tabState.song && tabState.song.title) || "this song";
  const chords = tabState.data ? [...new Set(tabState.data.bars.map((b) => b.chord).filter(Boolean))].slice(0, 7) : [];
  const pent = k.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9], full = k.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const rootLowE = fretOf(NOTES[k.root], 40), rootA = fretOf(NOTES[k.root], 45);
  const L = [
    ["1 · The 12 notes", `Music uses only <b>12 notes</b>: C, C#, D, D#, E, F, F#, G, G#, A, A#, B, then it repeats one octave higher.
      On the guitar, <b>each fret = one step</b> (a half step). Fret 12 is the same note as the open string, one octave up (that's why it has two dots).`],
    ["2 · What a key is", `A <b>key</b> is a "home" note plus a family of 7 notes that sound right together. ${esc(song)} is in <b>${k.name}</b>:
      its home note is <b>${NOTES[k.root]}</b> and its family is <b>${scaleNotes(k.root, full)}</b>. Melodies and solos mostly use these notes,
      and the song feels "finished" when it lands back on ${NOTES[k.root]}.`],
    ["3 · Major vs minor", `<b>Major</b> sounds bright/happy, <b>minor</b> sounds darker/sad. The difference is mostly one note, the <b>3rd</b>:
      4 frets above the root in major, <b>3 frets (the "b3")</b> in minor. ${k.name} shares all its notes with <b>${k.rel}</b> (its "relative" key):
      same notes, different home.`],
    ["4 · Scales vs chords", `A <b>scale</b> is the key's notes in a row. A <b>chord</b> is 3+ notes played together, usually the 1st, 3rd and 5th
      of a scale (the "chord tones"). This song's chords: <b>${chords.length ? chords.join(" · ") : "open the tab in Live notes to see them"}</b>.
      <b>Improv secret:</b> landing on a <b>chord tone of the chord playing right now</b> always sounds good. That's what the green notes in Live notes show.`],
    ["5 · The pentatonic: your first improv tool", `The <b>${k.minor ? "minor" : "major"} pentatonic</b> keeps the 5 safest notes of the key:
      <b>${scaleNotes(k.root, pent)}</b>. It has no "wrong" notes over this song. Start in <b>box 1</b>: the root ${NOTES[k.root]} is on
      <b>fret ${rootLowE || 12} of the low E string</b> and fret ${rootA || 12} of the A string. In Live notes choose <i>Area → Box 1</i>, then try
      boxes 2–5 to connect the whole neck.`],
    ["6 · Intervals: shapes that work in any key", `An <b>interval</b> is the distance from the root: <b>R</b> (root), <b>b3</b>, <b>3</b>, <b>5</b>, <b>b7</b>...
      Turn on <i>Show → Intervals</i> in Live notes: the same shape spells R-b3-4-5-b7 in every minor key, just moved up or down the neck.
      Learn the shape once, play it in all 12 keys.`],
  ];
  $("#lessons").innerHTML = `<h2>How keys work <span class="sub">with ${esc(song)} as the example</span></h2>` +
    L.map(([t, body]) => `<details class="lesson"><summary>${t}</summary><p>${body}</p></details>`).join("") +
    `<div class="row"><button class="ghost" data-go="notes">Try it on the fretboard &#8594;</button></div>`;
  const ideas = [`Which notes should I aim for over ${chords[0] || "the first chord"}?`, `How do I find the key of a song by ear?`,
    `Give me a 3-note lick in ${k.name} with frets`, `What's the difference between ${NOTES[k.root]} minor and ${NOTES[k.root]} dorian?`];
  $("#ask-ideas").innerHTML = ideas.map((q) => `<button class="ghost idea" data-ask="${esc(q)}">${esc(q)}</button>`).join("");
}
const chat = [];
async function ask(q) {
  chat.push({ role: "user", text: q });
  drawChat(true);
  const now = { key: songKey().name, chord_now: $("#now-chord").textContent, section_info: $("#tabinfo").textContent.slice(0, 160) };
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


/* ======================= NOW PLAYING (any app on the Mac) ======================= */
// What plays on the Mac (macOS "Now Playing": Spotify, YouTube in a browser, Music...) -> its Songsterr tab ->
// the chord of the bar playing now (bar times from Songsterr, position from the player). No tab, or "By ear":
// the chords are worked out from the sound (Custamo's listener), slowly and steadily.
const np = { info: null, local: 0, tab: null, tabId: null, src: "tab", offset: 0, key: null, chord: "", lastDraw: "",
  ear: { smooth: Array(12).fill(0), acc: Array(12).fill(0), chord: null, cand: null, since: 0, keySince: 0, keyCand: null } };
const NP_SCALES = { pent: (m) => m ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9], full: (m) => m ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11],
  blues: (m) => m ? [0, 3, 5, 6, 7, 10] : [0, 2, 3, 4, 7, 9], chord: () => [] };
const chordInfo = (name) => {  // "F#m" -> {root, minor, tones}
  const m = /^([A-G]#?)(m?)/.exec(name || "");
  if (!m) return null;
  const r = NOTES.indexOf(m[1]);
  return { root: r, minor: !!m[2], tones: (m[2] ? [0, 3, 7] : [0, 4, 7]).map((i) => (r + i) % 12) };
};
const npUsingTab = () => np.src === "tab" && np.tab && !np.tab.error;

async function pollNow() {
  if (tab !== "now") return;
  let p;
  try { p = await (await fetch("/api/now")).json(); } catch (e) { return; }
  const changed = !np.info || np.info.title !== p.title || np.info.artist !== p.artist;
  np.info = p; np.local = Date.now() / 1000;
  if (changed) {
    $("#np-app").textContent = p.title ? `${p.playing ? "PLAYING" : "PAUSED"} IN ${(p.app || "AN APP").toUpperCase()}` : "NOTHING PLAYING";
    $("#np-title").textContent = p.title || "Play a song in any app";
    $("#np-artist").textContent = p.title ? (p.artist || "Unknown artist") : "Spotify, YouTube in Safari or Chrome, Apple Music... MasterPrac follows it.";
    np.ear = { ...np.ear, chord: null, cand: null, acc: Array(12).fill(0), keyCand: null };
    np.key = null; np.chord = "";
    const id = p.match && p.match.id;
    if (id !== np.tabId) {
      np.tabId = id; np.tab = null; $("#np-map").innerHTML = "";
      np.offset = Number(localStorage.getItem("np-offset-" + id) || 0);
      $("#np-off").textContent = `${np.offset >= 0 ? "+" : ""}${np.offset.toFixed(2)} s`;
      if (id) {
        $("#np-src").textContent = "Loading the song's chords from Songsterr...";
        try { np.tab = await (await fetch(`/api/now/tab/${id}`)).json(); } catch (e) { np.tab = { error: "Couldn't load it" }; }
        if (np.info && np.info.match && np.info.match.id === id) buildMap();
      }
    }
    const btn = $("#np-open");
    btn.disabled = !p.title;
    btn.textContent = p.match ? "Open Songsterr version" : "Search it on Songsterr";
  } else {
    $("#np-app").textContent = p.title ? `${p.playing ? "PLAYING" : "PAUSED"} IN ${(p.app || "AN APP").toUpperCase()}` : "NOTHING PLAYING";
  }
  npSourceNote();
}
setInterval(pollNow, 1000);

function npSourceNote() {
  const p = np.info || {};
  $("#np-nudge").classList.toggle("hidden", !npUsingTab());
  if (np.lastDraw === "end" && npUsingTab()) return;  // keep the "past the tab's end" note
  let t = "";
  if (!p.title) t = "";
  else if (np.src === "ear") t = "Listening to the music to work out the chords (needs Custamo open).";
  else if (!p.match) t = "Songsterr doesn't have this exact song, so the chords are worked out by ear.";
  else if (np.tab && np.tab.error) t = esc(np.tab.error) + " Using the ear instead.";
  else if (np.tab) t = `Real chords from Songsterr's tab${np.tab.synced ? ", in time with the recording" : " (timing guessed from the tempo)"}.`;
  $("#np-src").innerHTML = t;
  $("#np-nudge").classList.toggle("hidden", !npUsingTab());
}

const npTime = () => {
  const p = np.info;
  if (!p || !p.title) return 0;
  return p.pos + (p.playing ? Date.now() / 1000 - p.at : 0) + np.offset;
};

// the song's chord map: one row per part (Intro, Verse...), chords in order, repeats merged
function buildMap() {
  const d = np.tab;
  if (!d || d.error || !d.bars) return;
  const secs = [];
  d.bars.forEach((b, i) => {
    if (b.section || !secs.length) secs.push({ name: b.section || "Start", from: i, chords: [] });
    const s = secs[secs.length - 1], last = s.chords[s.chords.length - 1];
    if (b.chord && (!last || last.name !== b.chord)) s.chords.push({ name: b.chord, from: i, to: i });
    else if (last) last.to = i;
  });
  $("#np-map").innerHTML = `<span class="now-label">THE WHOLE SONG'S CHORDS</span>` + secs.map((s, si) =>
    `<div class="sec" data-sec="${si}" data-from="${s.from}"><b>${esc(s.name)}</b>${s.chords.map((c) =>
      `<span class="ch" data-from="${c.from}" data-to="${c.to}">${esc(c.name)}</span>`).join("") || `<span class="sub">no chords</span>`}</div>`).join("");
}

function npTick() {
  if (tab !== "now") return;
  const p = np.info;
  if (p && p.title) {
    const t = Math.max(0, npTime() - np.offset);
    $("#np-pos").textContent = fmtT(t); $("#np-dur").textContent = fmtT(p.duration || 0);
    $("#np-fill").style.width = p.duration ? `${Math.min(100, (t / p.duration) * 100)}%` : "0";
  }
  if (!npUsingTab()) return;
  const d = np.tab, t = npTime();
  const end = d.bars[d.bars.length - 1].end;
  if (t > end + 3) {  // past the end of the tab: a different (longer) version, or not this song
    if (np.lastDraw !== "end") {
      np.lastDraw = "end"; np.key = { root: d.key.root, minor: d.key.minor };
      $("#np-section").textContent = "After the tab's end"; $("#np-next").textContent = "-"; $("#np-in").textContent = "";
      setNpChord("", "", "from the tab");
      $("#np-src").innerHTML = `This is ${fmtT(t)} in, but Songsterr's tab ends at ${fmtT(end)}: maybe a longer version (or not a song). Try <b>By ear</b>.`;
    }
    return;
  }
  const bi = Math.max(0, lastAt(d.bars, t, (b) => b.t)), bar = d.bars[bi];
  const section = d.bars.slice(0, bi + 1).reverse().find((b) => b.section)?.section || "Start";
  const nextBar = d.bars.slice(bi + 1).find((b) => b.chord && b.chord !== bar.chord);
  np.key = { root: d.key.root, minor: d.key.minor };
  $("#np-section").textContent = section;
  $("#np-next").textContent = nextBar ? nextBar.chord : "-";
  $("#np-in").textContent = nextBar ? `in ${Math.max(0, nextBar.t - t).toFixed(1)} s` : "";
  const sig = `${bi}|${bar.chord}`;
  if (sig !== np.lastDraw) {
    np.lastDraw = sig;
    setNpChord(bar.chord || "", nextBar ? nextBar.chord : "", "from the tab");
    document.querySelectorAll("#np-map .ch").forEach((el) => el.classList.toggle("now", bi >= +el.dataset.from && bi <= +el.dataset.to));
    const secs = [...document.querySelectorAll("#np-map .sec")];
    const cur = secs.filter((el) => +el.dataset.from <= bi).pop();
    secs.forEach((el) => el.classList.toggle("on", el === cur));
  }
}
setInterval(npTick, 100);  // a timer, not animation frames: keeps going when the window is in the background

function setNpChord(name, next, keySub) {
  np.chord = name;
  $("#np-chord").textContent = name || "-";
  const k = np.key;
  $("#np-key").textContent = k ? `${NOTES[k.root]} ${k.minor ? "minor" : "major"}` : "listening...";
  $("#np-keysub").textContent = k ? keySub : "";
  npImprov(next);
  drawNow();
}

function npImprov(next) {
  const k = np.key, c = chordInfo(np.chord), n = chordInfo(next);
  if (!k) { $("#np-improv").innerHTML = ""; return; }
  const pent = NP_SCALES.pent(k.minor), rootName = NOTES[k.root];
  const lowE = ((k.root - 40 % 12) % 12 + 12) % 12 || 12;
  const chip = (pc) => `<span class="${pc === k.root ? "root" : c && c.tones.includes(pc) ? "chord" : ""}">${NOTES[pc]}</span>`;
  $("#np-improv").innerHTML = `
    <div class="card"><p class="label">NOTES TO IMPROVISE WITH</p>
      <p class="notes">${pent.map((i) => chip((k.root + i) % 12)).join("")}</p>
      <p class="sub">The ${k.minor ? "minor" : "major"} pentatonic of ${rootName}: none of these sound wrong over this song.</p></div>
    <div class="card"><p class="label">LAND ON THESE NOW</p>
      ${c ? `<p class="notes">${c.tones.map((pc) => `<span class="chord">${NOTES[pc]}</span>`).join("")}</p>
      <p class="sub">The notes of ${esc(np.chord)}. End a phrase on one of them and it sounds "right".</p>` : `<p class="sub">Waiting for a chord...</p>`}
      ${n ? `<p class="sub">Next: <b>${esc(next)}</b> (${n.tones.map((pc) => NOTES[pc]).join(" ")})</p>` : ""}</div>
    <div class="card"><p class="label">WHERE TO START</p>
      <p>${lowE === 12 ? `The <b>open thick E string</b> (or fret 12) is <b>E</b>, the home note.` : `Put your first finger on <b>fret ${lowE}</b> of the thick E string: that's <b>${rootName}</b>, the home note.`}</p>
      <p class="sub">Play the dots around it (Area: Box 1). Bend or hold the green ones.</p></div>`;
}

function drawNow() {
  if (tab !== "now") return;
  const k = np.key, c = chordInfo(np.chord), which = $("#np-scale").value;
  let key = k, scale = k ? NP_SCALES[which](k.minor) : [];
  if (which === "chord" && c) { key = { root: c.root, minor: c.minor }; scale = [0]; }
  const d = npUsingTab() ? np.tab : null;
  fretboard($("#np-board"), { tuning: d ? d.tuning : live.tuning, key, scale, chordTones: c ? c.tones : [],
    labels: $("#np-labels").value, area: $("#np-area").value, frets: 15 });
}
["np-scale", "np-labels", "np-area"].forEach((id) => $("#" + id).addEventListener("change", drawNow));
new ResizeObserver(drawNow).observe($("#np-board"));

// by ear: the same steady approach as Live notes (1.2 s average, in-key bonus, a change must last about a bar)
async function npEar() {
  if (tab !== "now" || npUsingTab() || !(np.info && np.info.title)) return;
  let d;
  try { d = await (await fetch("/api/live")).json(); } catch (e) { return; }
  if (!d.live || d.rms < 0.004) { $("#np-section").textContent = d.error ? "Can't hear" : "Silent"; return; }
  $("#np-section").textContent = "by ear"; $("#np-next").textContent = "?"; $("#np-in").textContent = "";
  if (d.onset) { const b = $("#np-beat"); b.classList.remove("on"); void b.offsetWidth; b.classList.add("on"); }
  const e = np.ear, kk = Math.exp(-0.12 / 1.2), now = performance.now() / 1000;
  e.smooth = e.smooth.map((v, i) => v * kk + d.chroma[i] * (1 - kk));
  e.acc = e.acc.map((v, i) => v * 0.997 + d.chroma[i]);
  const g = guessKey(e.acc);
  if (!e.keyCand || g.root !== e.keyCand.root || g.minor !== e.keyCand.minor) { e.keyCand = g; e.keySince = now; }
  if (!np.key || (now - e.keySince > 8 && (np.key.root !== g.root || np.key.minor !== g.minor))) np.key = { root: g.root, minor: g.minor };
  const cand = detectChord(e.smooth, np.key), id = (x) => x && `${x.root}${x.q}`;
  if (!e.chord || (id(cand) !== id(e.chord) && id(cand) === id(e.cand) && now - e.since > 1.6 && cand.margin > 0.05)) {
    e.chord = cand; setNpChord(NOTES[cand.root] + cand.q, "", "heard from the music");
  } else if (id(cand) !== id(e.cand)) { e.cand = cand; e.since = now; }
}
setInterval(npEar, 120);

document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.npsrc) {
    np.src = b.dataset.npsrc; np.lastDraw = "";
    document.querySelectorAll("[data-npsrc]").forEach((x) => x.classList.toggle("on", x === b));
    np.ear.chord = null; npSourceNote();
  }
  if (b.dataset.npnudge && np.tabId) {
    np.offset = Math.round((np.offset + Number(b.dataset.npnudge)) * 100) / 100;
    localStorage.setItem("np-offset-" + np.tabId, np.offset);
    $("#np-off").textContent = `${np.offset >= 0 ? "+" : ""}${np.offset.toFixed(2)} s`;
  }
  if (b.id === "np-open" && api() && np.info && np.info.title) {
    if (np.info.match) api().browser_go(np.info.match.url); else api().browser_search(`${np.info.artist} ${np.info.title}`.trim());
    setTab("songsterr");
  }
});
