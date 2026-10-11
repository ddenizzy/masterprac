const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = () => (window.pywebview && window.pywebview.api) || null;
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
  if (name === "notes") drawBoard();
  if (name === "amp") { guideSeen = guideFor; $("#guide-ready").classList.add("hidden"); loadGuide(); loadAmp(); }
  if (name === "songs") loadSongs();
}

function render(s) {
  $("#song-chip").textContent = s.song ? `${s.song.title} · ${s.song.artist}` : "No song yet";
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
$("#scale").innerHTML = Object.keys(SCALES).map((s) => `<option>${s}</option>`).join("");
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
const FRETS = 15;
function drawBoard() {
  const svg = $("#board"), W = svg.clientWidth || 1000, H = 260;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const left = 46, right = 14, top = 22, bottom = 30;
  // real guitar spacing: frets get closer up the neck
  const scaleLen = (W - left - right) / (1 - Math.pow(2, -FRETS / 12));
  const fx = (f) => left + scaleLen * (1 - Math.pow(2, -f / 12));
  const strings = live.tuning.length, sy = (s) => top + (s * (H - top - bottom)) / (strings - 1);
  const key = live.key, scale = SCALES[$("#scale").value];
  const chordTones = live.chord ? live.chord.tones : [];
  const mode = $("#labels").value, area = $("#area").value;
  // box positions (pentatonic boxes) start on the scale notes of the low string, from the root
  const lowOpen = live.tuning[strings - 1] % 12;
  const rootFret = key ? ((key.root - lowOpen) % 12 + 12) % 12 : 0;
  const boxStarts = key ? scale.map((iv) => (rootFret + iv) % 12).sort((a, b) => a - b) : [];
  const boxFrom = area === "all" || !key ? 0 : (rootFret + [0, 3, 5, 7, 10][Number(area) - 1]) % 12;
  const inArea = (f) => area === "all" || !key || (f >= boxFrom - 1 && f <= boxFrom + 4) || (f >= boxFrom + 11 && f <= boxFrom + 16);
  let g = "";
  for (let f = 1; f <= FRETS; f++) g += `<line class="fret ${f === 12 ? "twelve" : ""}" x1="${fx(f)}" y1="${top}" x2="${fx(f)}" y2="${H - bottom}"/>`;
  g += `<rect class="nut" x="${left - 5}" y="${top - 2}" width="6" height="${H - top - bottom + 4}"/>`;
  for (const f of [3, 5, 7, 9, 15]) g += `<circle class="inlay" cx="${(fx(f - 1) + fx(f)) / 2}" cy="${H - bottom + 16}" r="4"/>`;
  g += `<circle class="inlay" cx="${(fx(11) + fx(12)) / 2 - 7}" cy="${H - bottom + 16}" r="4"/><circle class="inlay" cx="${(fx(11) + fx(12)) / 2 + 7}" cy="${H - bottom + 16}" r="4"/>`;
  for (let f = 1; f <= FRETS; f++) g += `<text class="fnum" x="${(fx(f - 1) + fx(f)) / 2}" y="${top - 8}">${f}</text>`;
  live.tuning.forEach((open, s) => {
    g += `<line class="string" x1="${left}" y1="${sy(s)}" x2="${W - right}" y2="${sy(s)}" style="stroke-width:${1 + s * 0.35}"/>`;
    g += `<text class="sname" x="${left - 26}" y="${sy(s) + 4}">${NOTES[open % 12]}</text>`;
    for (let f = 0; f <= FRETS; f++) {
      const pc = (open + f) % 12;
      const isChord = chordTones.includes(pc), iv = key ? (pc - key.root + 12) % 12 : null;
      const inScale = key && scale.includes(iv);
      if (!(inScale || isChord) || !inArea(f)) continue;
      const cls = key && iv === 0 ? "root" : isChord ? "chord" : "scale";
      const x = f === 0 ? left - 16 : (fx(f - 1) + fx(f)) / 2, label = mode === "intervals" && key ? INTERVAL[iv] : NOTES[pc];
      g += `<g class="note ${cls} ${isChord ? "hot" : ""}"><circle cx="${x}" cy="${sy(s)}" r="${isChord ? 13 : 11}"/><text x="${x}" y="${sy(s) + 4}">${label}</text></g>`;
    }
  });
  svg.innerHTML = g;
}
["scale", "labels", "area"].forEach((id) => $("#" + id).addEventListener("change", () => { if (id === "scale") live.userScale = true; drawBoard(); }));
new ResizeObserver(drawBoard).observe($("#board"));

function showKey() {
  const k = live.key;
  $("#key-name").textContent = k ? `${NOTES[k.root]} ${k.minor ? "minor" : "major"}` : "listening...";
  $("#key-src").textContent = live.keySrc;
  if (k && !live.userScale) $("#scale").value = k.minor ? "minor pentatonic" : "major pentatonic";
}

// ~8 times a second while the LIVE NOTES tab is open. Stable on purpose (from chord-recognition research):
// the sound is averaged over ~1.2 s, chords in the key are preferred, and a new chord has to keep winning for
// about one bar (from the song's tempo) before the display changes. HOLD freezes chord and key.
const POLL = 120;
let smooth = Array(12).fill(0), challenger = null, challengerSince = 0, keyGuess = null, keyGuessSince = 0;
const barSeconds = () => Math.min(3, Math.max(1.2, 4 * 60 / (live.bpm || 100)));
async function pollLive() {
  if (tab !== "notes") return;
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
