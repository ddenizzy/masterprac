const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// MIDI note numbers (Songsterr tunings) -> names, high string first
const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const tuning = (t) => (t || []).slice().reverse().map((n) => NOTE[n % 12]).join(" ");

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), 2600);
}

function render(s) {
  const song = s.song;
  $("#song").innerHTML = song ? `
    <h2>${esc(song.title)}</h2><p class="artist">${esc(song.artist)}</p>
    <p class="explain">Guitar parts in this tab (pick one in Songsterr's track menu):</p>
    <ul class="tracks">${song.tracks.filter((t) => /guitar/i.test(t.instrument)).map((t) => `
      <li><b>${esc(t.name || t.instrument)}</b><span>${esc(t.instrument)} · tuning ${esc(tuning(t.tuning))}</span></li>`).join("")
      || "<li>No guitar track in this tab.</li>"}</ul>`
    : `<p class="muted">Open a song in the Songsterr window on the left; it appears here.</p>`;

  const bt = s.bt || {};
  const amp = bt["HeadRush Flex Prime"], spk = bt["LP-UNF"];
  $("#route").innerHTML = `
    <p class="state ${amp ? "ok" : ""}">${amp ? "Through your HeadRush amp" : spk ? "Through your Kali speakers" : "Through the Mac's own speakers"}</p>
    <p class="muted">HeadRush Bluetooth: ${amp ? "connected" : "not connected"} · Kali: ${spk ? "connected" : "not connected"}</p>`;

  const sp = s.spotify || {};
  $("#spotify").innerHTML = !sp.running ? `<p class="muted">Spotify isn't open.</p>` : `
    <p class="state ${sp.volume === 0 ? "ok" : ""}">${sp.state === "playing" ? (sp.volume === 0 ? "Playing, muted" : `Playing at ${sp.volume}%`) : esc(sp.state)}</p>
    <p class="muted">${esc(sp.title)}${sp.artist ? " · " + esc(sp.artist) : ""} · ${s.plugged ? "Mac plugged in" : "on battery"}</p>`;

  $("#log").innerHTML = s.log.slice().reverse().map((l) => `<li><span>${l.at}</span>${esc(l.text)}</li>`).join("");
}

async function refresh() {
  try { render(await (await fetch("/api/session")).json()); } catch (e) { /* app starting */ }
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.id === "help-btn") $("#help").classList.toggle("hidden");
  if (b.dataset.sound) {
    b.disabled = true; toast("Switching... (a few seconds)");
    const r = await (await fetch(`/api/sound/${b.dataset.sound}`, { method: "POST" })).json();
    toast(r.ok ? "Done" : "Couldn't connect. See the list below."); b.disabled = false; refresh();
  }
});
refresh();
setInterval(refresh, 2000);
