/* Chord shapes for the chord diagrams: how to finger a chord on a standard-tuned guitar.
 * A shape is 6 strings, low E -> high E: fret number, 0 = open, -1 = don't play; plus which finger (1-4, 0 open).
 * Common open chords are written out; anything else gets a movable barre shape (E-shape: root on the low E string,
 * A-shape: root on the A string), whichever sits lower on the neck. */
const CHORD_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const OPEN_CHORDS = {
  "C": [[-1, 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0]], "A": [[-1, 0, 2, 2, 2, 0], [0, 0, 1, 2, 3, 0]],
  "G": [[3, 2, 0, 0, 0, 3], [2, 1, 0, 0, 0, 3]], "E": [[0, 2, 2, 1, 0, 0], [0, 2, 3, 1, 0, 0]],
  "D": [[-1, -1, 0, 2, 3, 2], [0, 0, 0, 1, 3, 2]], "Am": [[-1, 0, 2, 2, 1, 0], [0, 0, 2, 3, 1, 0]],
  "Em": [[0, 2, 2, 0, 0, 0], [0, 2, 3, 0, 0, 0]], "Dm": [[-1, -1, 0, 2, 3, 1], [0, 0, 0, 2, 3, 1]],
  "A7": [[-1, 0, 2, 0, 2, 0], [0, 0, 2, 0, 3, 0]], "E7": [[0, 2, 0, 1, 0, 0], [0, 2, 0, 1, 0, 0]],
  "D7": [[-1, -1, 0, 2, 1, 2], [0, 0, 0, 2, 1, 3]], "G7": [[3, 2, 0, 0, 0, 1], [3, 2, 0, 0, 0, 1]],
  "C7": [[-1, 3, 2, 3, 1, 0], [0, 3, 2, 4, 1, 0]], "B7": [[-1, 2, 1, 2, 0, 2], [0, 2, 1, 3, 0, 4]],
  "Am7": [[-1, 0, 2, 0, 1, 0], [0, 0, 2, 0, 1, 0]], "Em7": [[0, 2, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0]],
  "Dm7": [[-1, -1, 0, 2, 1, 1], [0, 0, 0, 2, 1, 1]], "Cmaj7": [[-1, 3, 2, 0, 0, 0], [0, 3, 2, 0, 0, 0]],
  "Fmaj7": [[-1, -1, 3, 2, 1, 0], [0, 0, 3, 2, 1, 0]], "Amaj7": [[-1, 0, 2, 1, 2, 0], [0, 0, 2, 1, 3, 0]],
  "Dmaj7": [[-1, -1, 0, 2, 2, 2], [0, 0, 0, 1, 1, 1]], "Gmaj7": [[3, 2, 0, 0, 0, 2], [3, 2, 0, 0, 0, 1]],
  "Asus2": [[-1, 0, 2, 2, 0, 0], [0, 0, 1, 2, 0, 0]], "Asus4": [[-1, 0, 2, 2, 3, 0], [0, 0, 1, 2, 3, 0]],
  "Dsus2": [[-1, -1, 0, 2, 3, 0], [0, 0, 0, 1, 3, 0]], "Dsus4": [[-1, -1, 0, 2, 3, 3], [0, 0, 0, 1, 3, 4]],
  "Esus4": [[0, 2, 2, 2, 0, 0], [0, 2, 3, 4, 0, 0]], "Cadd9": [[-1, 3, 2, 0, 3, 0], [0, 2, 1, 0, 3, 0]],
  "Em9": [[0, 2, 0, 0, 0, 2], [0, 2, 0, 0, 0, 3]], "F": [[1, 3, 3, 2, 1, 1], [1, 3, 4, 2, 1, 1]],
  "Bm": [[-1, 2, 4, 4, 3, 2], [0, 1, 3, 4, 2, 1]], "E5": [[0, 2, 2, -1, -1, -1], [0, 1, 2, 0, 0, 0]],
  "A5": [[-1, 0, 2, 2, -1, -1], [0, 0, 1, 2, 0, 0]], "D5": [[-1, -1, 0, 2, 3, -1], [0, 0, 0, 1, 2, 0]],
};
// movable shapes: semitones above the root fret per string, -1 = muted. [frets, fingers]
const BARRE = {
  E: { "": [[0, 2, 2, 1, 0, 0], [1, 3, 4, 2, 1, 1]], m: [[0, 2, 2, 0, 0, 0], [1, 3, 4, 1, 1, 1]], "7": [[0, 2, 0, 1, 0, 0], [1, 3, 1, 2, 1, 1]],
       m7: [[0, 2, 0, 0, 0, 0], [1, 3, 1, 1, 1, 1]], "5": [[0, 2, 2, -1, -1, -1], [1, 3, 4, 0, 0, 0]], maj7: [[0, -1, 1, 1, 0, -1], [1, 0, 3, 4, 2, 0]],
       sus4: [[0, 2, 2, 2, 0, 0], [1, 2, 3, 4, 1, 1]] },
  A: { "": [[-1, 0, 2, 2, 2, 0], [0, 1, 3, 3, 3, 1]], m: [[-1, 0, 2, 2, 1, 0], [0, 1, 3, 4, 2, 1]], "7": [[-1, 0, 2, 0, 2, 0], [0, 1, 3, 1, 4, 1]],
       m7: [[-1, 0, 2, 0, 1, 0], [0, 1, 3, 1, 2, 1]], "5": [[-1, 0, 2, 2, -1, -1], [0, 1, 3, 4, 0, 0]], maj7: [[-1, 0, 2, 1, 2, 0], [0, 1, 3, 2, 4, 1]],
       sus2: [[-1, 0, 2, 2, 0, 0], [0, 1, 3, 4, 1, 1]], sus4: [[-1, 0, 2, 2, 3, 0], [0, 1, 2, 3, 4, 1]] },
};
const FLAT2SHARP = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };

/** "F#m7", "Bb", "D/F#" -> { frets:[6], fingers:[6], base: lowest fretted fret, barre: {fret, from, to} | null, name } */
function chordShape(name) {
  const m = /^([A-G])([#b]?)([^/]*)(?:\/.*)?$/.exec((name || "").trim());
  if (!m) return null;
  let root = m[1] + m[2]; root = FLAT2SHARP[root] || root;
  const q = m[3], key = root + q;
  if (OPEN_CHORDS[key]) return finish(OPEN_CHORDS[key][0], OPEN_CHORDS[key][1], name);
  const kind = /^m7/.test(q) ? "m7" : /^maj7/.test(q) ? "maj7" : /^m(?!aj)/.test(q) ? "m" : /^7/.test(q) ? "7" : /^5/.test(q) ? "5"
    : /^sus2/.test(q) ? "sus2" : /^sus/.test(q) ? "sus4" : "";
  const r = CHORD_NOTES.indexOf(root);
  const onE = (r - 4 + 12) % 12 || 12, onA = (r - 9 + 12) % 12 || 12;  // root fret on the low E / A string
  const opts = [];
  if (BARRE.E[kind]) opts.push({ shape: BARRE.E[kind], at: onE });
  if (BARRE.A[kind]) opts.push({ shape: BARRE.A[kind], at: onA });
  if (!opts.length) return chordShape(root + (/^m/.test(q) ? "m" : ""));
  const best = opts.sort((a, b) => a.at - b.at)[0];
  const frets = best.shape[0].map((v) => (v < 0 ? -1 : v + best.at));
  return finish(frets, best.shape[1], name);
}
function finish(frets, fingers, name) {
  const fretted = frets.filter((f) => f > 0);
  const base = fretted.length ? Math.min(...fretted) : 1;
  // a barre: finger 1 on 2+ strings at the lowest fret
  const ones = frets.map((f, i) => (fingers[i] === 1 && f === base ? i : -1)).filter((i) => i >= 0);
  const barre = ones.length >= 2 ? { fret: base, from: Math.min(...ones), to: Math.max(...ones) } : null;
  return { frets, fingers, base, barre, name };
}

/** A small chord diagram (SVG): strings vertical (low E left), frets across, dots with finger numbers. */
function chordSVG(name, size = 1) {
  const sh = chordShape(name);
  if (!sh) return `<div class="cd-none">?</div>`;
  const W = 96 * size, H = 128 * size, x0 = 16 * size, y0 = 38 * size, gx = (W - x0 * 2) / 5, gy = 18 * size;
  const top = sh.base <= 3 ? 1 : sh.base, xs = (i) => x0 + i * gx, yf = (f) => y0 + (f - top + 0.5) * gy;
  let g = `<text class="cd-name" x="${W / 2}" y="${12 * size}">${name}</text>`;
  if (top === 1) g += `<rect class="cd-nut" x="${x0}" y="${y0 - 3 * size}" width="${gx * 5}" height="${4 * size}"/>`;
  else g += `<text class="cd-fret" x="${x0 - 4 * size}" y="${y0 + gy * 0.65}">${top}</text>`;
  for (let f = 0; f <= 5; f++) g += `<line class="cd-l" x1="${x0}" y1="${y0 + f * gy}" x2="${x0 + gx * 5}" y2="${y0 + f * gy}"/>`;
  for (let i = 0; i < 6; i++) g += `<line class="cd-l" x1="${xs(i)}" y1="${y0}" x2="${xs(i)}" y2="${y0 + 5 * gy}"/>`;
  if (sh.barre) g += `<rect class="cd-barre" x="${xs(sh.barre.from) - 6 * size}" y="${yf(sh.barre.fret) - 6 * size}" width="${xs(sh.barre.to) - xs(sh.barre.from) + 12 * size}" height="${12 * size}" rx="${6 * size}"/>`;
  sh.frets.forEach((f, i) => {
    if (f < 0) g += `<text class="cd-x" x="${xs(i)}" y="${y0 - 7 * size}">x</text>`;
    else if (f === 0) g += `<circle class="cd-o" cx="${xs(i)}" cy="${y0 - 10 * size}" r="${3.6 * size}"/>`;
    else if (!(sh.barre && f === sh.barre.fret && i >= sh.barre.from && i <= sh.barre.to && sh.fingers[i] === 1)) {
      g += `<circle class="cd-dot" cx="${xs(i)}" cy="${yf(f)}" r="${6.5 * size}"/>`;
      if (sh.fingers[i]) g += `<text class="cd-fg" x="${xs(i)}" y="${yf(f) + 3.6 * size}">${sh.fingers[i]}</text>`;
    }
  });
  return `<svg class="cd" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}</svg>`;
}
