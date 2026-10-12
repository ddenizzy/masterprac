"""Follow the tab: the exact notes of the lead guitar, bar by bar, in sync with the recording.

Data comes from Songsterr (the same files its own player loads, for the song open in the app):
  /api/meta/<id>                      revision, image, track list
  CDN /<id>/<rev>/<image>/<n>.json    one track's bars, beats and notes (gzip)
  /api/video-points/<id>/<rev>/list   when each bar starts in the real recording (seconds)
Timing: Spotify's play position (keeps running while muted) + those bar times = where we are in the tab.
Chords per bar come from the rhythm guitar's notes; the key from all notes. Cached in data/tabs/.
"""
import gzip
import json
import re
from pathlib import Path

import requests

import helpers as h

CDN = "https://dqsljvtekg760.cloudfront.net"
CACHE = h.DATA / "tabs"
CACHE.mkdir(exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 MasterPrac"}
NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _json(url):
    r = requests.get(url, headers=UA, timeout=20)
    r.raise_for_status()
    b = r.content
    try:
        b = gzip.decompress(b)
    except OSError:
        pass
    return json.loads(b)


def _pick(tracks, words, avoid=()):
    """First guitar track whose name has the first word, else the second word, ..."""
    for w in words:
        for i, t in enumerate(tracks):
            name = (t.get("name") or "").lower()
            if "guitar" in (t.get("instrument") or "").lower() and w in name and not any(a in name for a in avoid):
                return i
    return None


def _measure_times(track, points):
    """Start/end seconds of every bar: Songsterr's recording sync points, else the tempo."""
    n = len(track["measures"])
    if points and len(points) >= 2:
        starts = list(points[:n + 1])
        while len(starts) < n + 1:  # fewer points than bars: continue at the last bar's length
            starts.append(starts[-1] + (starts[-1] - starts[-2]))
        return [(starts[i], starts[i + 1]) for i in range(n)]
    tempo = {a["measure"]: a["bpm"] for a in track.get("automations", {}).get("tempo", [])}
    bpm, sig, t, out = 120, [4, 4], 0.0, []
    for i, m in enumerate(track["measures"]):
        bpm = tempo.get(i, bpm)
        sig = m.get("signature") or sig
        length = sig[0] * (4 / sig[1]) * 60 / bpm
        out.append((t, t + length))
        t += length
    return out


def _events(track, times):
    """[[t, dur, [[string, fret], ...]], ...] for every played beat (rests skipped)."""
    ev = []
    for (start, end), m in zip(times, track["measures"]):
        sig = m.get("signature")
        for v in m.get("voices", [])[:1]:  # main voice
            pos, beats = 0.0, v.get("beats", [])
            total = sum(b["duration"][0] / b["duration"][1] for b in beats) or 1
            for b in beats:
                frac = b["duration"][0] / b["duration"][1] / total
                t, dur = start + pos * (end - start), frac * (end - start)
                notes = [[n["string"], n["fret"]] for n in b.get("notes", []) if "fret" in n and not n.get("rest") and not n.get("dead")]
                if notes:
                    ev.append([round(t, 3), round(dur, 3), notes])
                pos += frac
    return ev


NOTE_FLAGS = (("bend", "b"), ("slide", "s"), ("hp", "h"), ("dead", "x"), ("leftHandVibrato", "v"), ("tie", "t"),
              ("harmonic", "H"), ("ghost", "g"))


SLIDES = {"shift": "s", "legato": "s", "intoFromBelow": "i", "intoFromAbove": "I", "downwards": "o", "outDownwards": "o",
          "upwards": "O", "outUpwards": "O"}


def _flags(n):
    """Technique letters for one note. Slides: s = to the next note, i / I = into it from below / above,
    o / O = out of it downwards / upwards. Bends: b = half step, B = whole step or more."""
    out = ""
    for k, c in NOTE_FLAGS:
        if not n.get(k):
            continue
        if k == "slide":
            c = SLIDES.get(n["slide"], "s") if isinstance(n["slide"], str) else "s"
        elif k == "bend":
            c = "B" if (n["bend"] or {}).get("tone", 50) >= 100 else "b"
        out += c
    return out


def _tab_beats(track, times):
    """Every beat of the shown part, for drawing the tab: [t, dur, bar, [[string, fret, flags]], beat_flags, text].
    flags: b bend, s slide, h hammer-on/pull-off, x muted, v vibrato, t tied, H harmonic, g ghost;
    beat_flags: pm palm mute, lr let ring, tr tremolo picking."""
    out = []
    for bi, ((start, end), m) in enumerate(zip(times, track["measures"])):
        for v in m.get("voices", [])[:1]:
            pos, beats = 0.0, v.get("beats", [])
            total = sum(b["duration"][0] / b["duration"][1] for b in beats) or 1
            for b in beats:
                frac = b["duration"][0] / b["duration"][1] / total
                notes = [[n["string"], n["fret"], _flags(n)] for n in b.get("notes", []) if "fret" in n and not n.get("rest")]
                bf = " ".join(f for k, f in (("palmMute", "pm"), ("letRing", "lr"), ("tremolo", "tr")) if b.get(k))
                text = (b.get("text") or {}).get("text", "")
                if notes or text:
                    out.append([round(start + pos * (end - start), 3), round(frac * (end - start), 3), bi, notes, bf, text])
                pos += frac
    return out


def _lyrics(tracks_json, times):
    """The sung words, each syllable at the moment its note is sung: [[t, "syl", new_line], ...].
    Songsterr keeps them in the singer's track (Guitar Pro style): syllables split by spaces and '-', given out one
    per sung note (rests and held/tied notes get none), starting at the line's 'offset' bar."""
    for tr in tracks_json:
        lines = [l for l in tr.get("newLyrics") or [] if (l.get("text") or "").strip()]
        if not lines:
            continue
        line = lines[0]
        text = re.sub(r"\[[^\]]*\]", "\n", line["text"])  # [Verse 1], [Chorus]: headings, not sung
        tokens = []  # (syllable, starts a new line)
        new_line = True
        for raw_line in text.split("\n"):
            if not raw_line.strip():
                new_line = True
                continue
            # one space between words; every EXTRA space = one note sung without a new syllable (a held word)
            pieces = raw_line.lstrip().split(" ")
            for w in pieces:
                if w == "":
                    tokens.append(("", False))
                    continue
                parts = w.split("-")
                for k, part in enumerate(parts):
                    if part == "" and k:
                        continue
                    tokens.append((part + ("-" if k < len(parts) - 1 else ""), new_line))
                    new_line = False
            new_line = True
        out, ti = [], 0
        start_bar = max(0, int(line.get("offset", 1)) - 1)
        for bi, ((s, e), m) in enumerate(zip(times, tr["measures"])):
            if bi < start_bar:
                continue
            for v in m.get("voices", [])[:1]:
                beats = v.get("beats", [])
                total = sum(b["duration"][0] / b["duration"][1] for b in beats) or 1
                pos = 0.0
                for b in beats:
                    frac = b["duration"][0] / b["duration"][1] / total
                    sung = [n for n in b.get("notes", []) if not n.get("rest")]
                    # grace notes (quick ornaments) and held/tied notes get no syllable
                    if sung and not b.get("graceNote") and not all(n.get("tie") for n in sung) and ti < len(tokens):
                        syl, nl = tokens[ti]
                        if syl:  # an empty one = a held note: nothing new to sing
                            out.append([round(s + pos * (e - s), 3), syl, nl])
                        ti += 1
                    pos += frac
        return out
    return []


STEP = 0.25  # seconds per fingerprint slot


def _fingerprint(tracks, times):
    """Which of the 12 notes sound in every quarter second of the song (all guitars + bass), from the tab:
    what the music SHOULD sound like at each moment. The page compares it with what it hears to sync itself."""
    end = times[-1][1] if times else 0
    slots = [[0.0] * 12 for _ in range(int(end / STEP) + 2)]
    for tr in tracks:
        tuning = tr["tuning"]
        for (start, stop), m in zip(times, tr["measures"]):
            for v in m.get("voices", [])[:1]:
                pos, beats = 0.0, v.get("beats", [])
                total = sum(b["duration"][0] / b["duration"][1] for b in beats) or 1
                for b in beats:
                    frac = b["duration"][0] / b["duration"][1] / total
                    t0, t1 = start + pos * (stop - start), start + (pos + frac) * (stop - start)
                    pos += frac
                    for n in b.get("notes", []):
                        if "fret" not in n or n.get("rest") or n.get("dead") or n["string"] >= len(tuning):
                            continue
                        pc = (tuning[n["string"]] + n["fret"]) % 12
                        for k in range(max(0, int(t0 / STEP)), min(len(slots), int(t1 / STEP) + 1)):
                            slots[k][pc] += 1.0
    out = []
    for sl in slots:
        mx = max(sl)
        out.append([round(x / mx, 2) for x in sl] if mx else [0] * 12)
    return out


def _attacks(tracks, times):
    """When notes START in the whole band (guitars, bass, keys, drums), with a weight per moment: drums count most,
    they mark the beat. MasterPrac matches these against the attacks it hears to sync to within ~10 ms."""
    hits = {}
    for tr, w in tracks:
        for (start, stop), m in zip(times, tr["measures"]):
            for v in m.get("voices", [])[:1]:
                pos, beats = 0.0, v.get("beats", [])
                total = sum(b["duration"][0] / b["duration"][1] for b in beats) or 1
                for b in beats:
                    frac = b["duration"][0] / b["duration"][1] / total
                    new = [n for n in b.get("notes", []) if not n.get("rest") and not n.get("tie")]
                    if new:
                        t = round(start + pos * (stop - start), 2)
                        hits[t] = hits.get(t, 0) + w * min(3, len(new))
                    pos += frac
    return sorted([t, round(x, 1)] for t, x in hits.items())


def _written_chords(tracks, n_bars):
    """Chord names the tab's author wrote above the music (first one per bar), or None if there are few."""
    out = [""] * n_bars
    for t in tracks:
        for i, m in enumerate(t["measures"][:n_bars]):
            if out[i]:
                continue
            for v in m.get("voices", [])[:1]:
                for b in v.get("beats", []):
                    name = (b.get("chord") or {}).get("text", "").replace("♯", "#").replace("♭", "b").strip()
                    if name and not out[i]:
                        out[i] = name
    return out if sum(1 for c in out if c) >= max(3, n_bars // 8) else None


TUNINGS = {(64, 59, 55, 50, 45, 40): "Standard", (64, 59, 55, 50, 45, 38): "Drop D",
           (63, 58, 54, 49, 44, 39): "Half step down (Eb)", (62, 57, 53, 48, 43, 38): "Whole step down (D)",
           (62, 57, 53, 48, 43, 36): "Drop C", (63, 58, 54, 49, 44, 37): "Drop C#"}


def tuning_name(tuning):
    return TUNINGS.get(tuple(tuning)) or " ".join(NOTES[x % 12] for x in reversed(tuning))


def _bar_weights(track, i):
    """How much each pitch class sounds in bar i of a track (by note length); also its lowest note."""
    w, low = [0.0] * 12, None
    if i >= len(track["measures"]):
        return w, low
    tuning = track["tuning"]
    for v in track["measures"][i].get("voices", [])[:1]:
        for b in v.get("beats", []):
            d = b["duration"][0] / b["duration"][1]
            for n in b.get("notes", []):
                if "fret" in n and not n.get("rest") and not n.get("dead"):
                    midi = tuning[n["string"]] + n["fret"]
                    w[midi % 12] += d
                    low = midi if low is None or midi < low else low
    return w, low


def _bar_chords(harmony, bass, n_bars):
    """The chord of each bar from the accompaniment (rhythm guitars, keys) + the bass's root."""
    out = []
    for i in range(n_bars):
        w = [0.0] * 12
        for t in harmony:
            for pc, x in enumerate(_bar_weights(t, i)[0]):
                w[pc] += x
        bass_w, _ = _bar_weights(bass, i) if bass else ([0.0] * 12, None)
        for pc, x in enumerate(bass_w):
            w[pc] += x * 1.5  # the bass usually plays the chord's root
        best, score = "", 0.0
        for r in range(12):
            for shape, q in (((0, 4, 7), ""), ((0, 3, 7), "m")):
                s = sum(w[(r + i) % 12] for i in shape) + w[r] * .5 + bass_w[r] * 1.0 - sum(w) * .15
                if s > score and w[r] > 0:
                    best, score = NOTES[r] + q, s
        # no 3rd at all (only root + 5th): a power chord, neither major nor minor
        if best:
            r = NOTES.index(best.rstrip("m"))
            # judge the 3rd from the guitars/keys only: bass lines pass through other notes
            m3, M3 = (w[(r + k) % 12] - 1.5 * bass_w[(r + k) % 12] for k in (3, 4))
            no_third = m3 + M3 < 0.12 * w[r]
            both_thirds = min(m3, M3) > 0.5 * max(m3, M3)  # a chromatic riff using both: still just root + 5th
            if (no_third or both_thirds) and w[(r + 7) % 12] > 0:
                best = NOTES[r] + "5"
        out.append(best)
    # a bar without a clear chord keeps the previous one
    for i in range(1, len(out)):
        out[i] = out[i] or out[i - 1]
    return out


PROF_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
PROF_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


KEY_NOTE_WEIGHT = 1.0  # how much the notes count vs the chords when finding the key


def _corr(a, b):
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = (sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b)) ** 0.5
    return num / den if den else 0.0


def _parse_chord(c):
    """'F#m7' -> (6, 'm'), 'B5' -> (11, '5'), 'Eb' -> (3, ''); None if not a chord."""
    m = re.match(r"([A-G])([#b]?)(.*)", c or "")
    if not m:
        return None
    root = (NOTES.index(m.group(1)) + {"#": 1, "b": -1}.get(m.group(2), 0)) % 12
    rest = m.group(3)
    return root, "m" if re.match(r"m(?!aj)", rest) else "5" if rest.startswith("5") else ""


def _key(tracks_notes, bars=None, wn=None):
    """The song's key. Mostly from its chords (which chords fit the key + which one feels like home: the song lingers on,
    starts and ends with it); the notes' Krumhansl profile breaks ties between keys sharing the same notes."""
    w = [0.0] * 12
    for pcs in tracks_notes:
        for pc, d in pcs:
            w[pc] += d
    chords = [(c, b["end"] - b["t"]) for b in bars or [] if (c := _parse_chord(b["chord"]))]
    total = sum(d for _, d in chords)
    best = None
    for r in range(12):
        for minor in (False, True):
            prof = PROF_MIN if minor else PROF_MAJ
            score = (wn if wn is not None else KEY_NOTE_WEIGHT) * _corr([w[(i + r) % 12] for i in range(12)], prof)
            if len(chords) >= 4 and total:
                deg = {0: "m", 3: "", 5: "m", 7: "m", 8: "", 10: ""} if minor else {0: "", 2: "m", 4: "m", 5: "", 7: "", 9: "m"}
                fits = lambda c: (c[0] - r) % 12 in deg and c[1] in ("5", deg[(c[0] - r) % 12])
                home = lambda c: c[0] == r and c[1] in ("5", "m" if minor else "")
                fit = sum(d for c, d in chords if fits(c)) / total
                tonic = sum(d for c, d in chords if home(c)) / total
                score += fit * 2 + tonic * 1.5 + 0.25 * home(chords[0][0]) + 0.25 * home(chords[-1][0])
            if best is None or score > best[2]:
                best = (r, minor, score)
    return {"root": best[0], "minor": best[1], "name": f"{NOTES[best[0]]} {'minor' if best[1] else 'major'}"}


def load(song_id, lead_index=None):
    """Everything the fretboard needs to follow the song's lead guitar. Cached per song + track."""
    cache = CACHE / f"v16-{song_id}-{lead_index if lead_index is not None else 'auto'}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    meta = _json(f"https://www.songsterr.com/api/meta/{song_id}")
    rev, image, tracks = meta["revisionId"], meta["image"], meta["tracks"]
    # how many bars each guitar part actually plays (a lead part can be silent most of the song)
    guitars = [i for i, t in enumerate(tracks) if "guitar" in (t.get("instrument") or "").lower()]
    played, loaded, active = {}, {}, {}
    for i in guitars[:8]:
        try:
            loaded[i] = _json(f"{CDN}/{song_id}/{rev}/{image}/{i}.json")
            active[i] = "".join("1" if any("fret" in n and not n.get("rest") for v in m.get("voices", [])[:1]
                                           for b in v.get("beats", []) for n in b.get("notes", [])) else "0"
                                for m in loaded[i]["measures"])  # which bars this part plays
            played[i] = active[i].count("1")
        except Exception:
            played[i] = 0
    # the part to follow: the one asked for, else the guitar that plays the most (ties: Songsterr's most popular)
    pop = meta.get("popularTrackGuitar")
    lead = lead_index if lead_index is not None else (
        max(played, key=lambda i: (played[i], i == pop)) if played else pop if pop is not None else meta.get("defaultTrack", 0))
    rhythm = _pick(tracks, ("rhythm", "chord", "acoustic", "guitar"), avoid=("lead", "solo"))
    if rhythm is None or rhythm == lead:
        rhythm = lead
    get = lambda i: loaded[i] if i in loaded else _json(f"{CDN}/{song_id}/{rev}/{image}/{i}.json")
    lt = get(lead)
    rt = lt if rhythm == lead else get(rhythm)
    # accompaniment for chords: every other guitar/keys track (up to 4) + the bass
    others = [i for i, t in enumerate(tracks) if i not in (lead, rhythm) and re.search(
        r"guitar|piano|organ|keys", (t.get("instrument") or "") + (t.get("name") or ""), re.I)][:3]
    harmony = [rt] + [get(i) for i in others]
    bass_i = next((i for i, t in enumerate(tracks) if "bass" in (t.get("instrument") or "").lower()), None)
    bass = _json(f"{CDN}/{song_id}/{rev}/{image}/{bass_i}.json") if bass_i is not None else None
    try:
        sync = _json(f"https://www.songsterr.com/api/video-points/{song_id}/{rev}/list")
        points = next((s["points"] for s in sync if s.get("points")), None)
    except Exception:
        points = None
    times = _measure_times(lt, points)
    tuning = lt["tuning"]
    pcs = [[((t["tuning"][n["string"]] + n["fret"]) % 12, b["duration"][0] / b["duration"][1])
            for m in t["measures"] for v in m.get("voices", [])[:1] for b in v.get("beats", [])
            for n in b.get("notes", []) if "fret" in n and not n.get("rest")] for t in [lt] + harmony + ([bass] if bass else [])]
    out = {
        "song_id": song_id, "lead": lead, "rhythm": rhythm, "synced": bool(points),
        "lead_name": lt.get("name", ""), "rhythm_name": rt.get("name", ""), "tuning": tuning,
        "tracks": [{"i": i, "name": t.get("name", ""), "instrument": t.get("instrument", ""), "played": played.get(i), "active": active.get(i, "")}
                   for i, t in enumerate(tracks) if "guitar" in (t.get("instrument") or "").lower()],
        "bars": [{"t": round(s, 3), "end": round(e, 3), "section": (m.get("marker") or {}).get("text", ""), "chord": c}
                 for (s, e), m, c in zip(times, lt["measures"], _bar_chords(harmony, bass, len(lt["measures"])))],
        "events": _events(lt, times),
        "beats": _tab_beats(lt, times),
        "print": _fingerprint([lt] + harmony + ([bass] if bass else []), times),
        # the words can sit in any part (usually the singer's): singers first, then the rest
        "lyrics": _lyrics([get(i) for i in sorted(range(len(tracks)), key=lambda i: not re.search(
            r"vocal|voice|sing", (tracks[i].get("name") or "") + " " + (tracks[i].get("instrument") or ""), re.I))][:6], times),
        "print_step": STEP,
        "attacks": _attacks([(get(i), 2.0 if "drum" in (t.get("instrument") or "").lower() else 1.0)
                             for i, t in enumerate(tracks) if re.search(r"guitar|bass|drum|piano|organ|keys",
                                                                        (t.get("instrument") or "") + " " + (t.get("name") or ""), re.I)][:8], times),
        "tuning_name": tuning_name(tuning),
        "tempo": next((a["bpm"] for a in lt.get("automations", {}).get("tempo", [])), None),
        "key": None,
    }
    out["key"] = _key(pcs)  # notes only: worked-out chords (from riffs) aren't reliable enough to decide the key
    # a major chord that doesn't fit the key but whose minor does (B in B minor, missing its 3rd): use the minor
    k = out["key"]
    scale = {(k["root"] + i) % 12 for i in ((0, 2, 3, 5, 7, 8, 10) if k["minor"] else (0, 2, 4, 5, 7, 9, 11))}
    for b in out["bars"]:
        m = re.match(r"([A-G]#?)(m?)$", b["chord"] or "")
        if m and not m.group(2):
            r = NOTES.index(m.group(1))
            if (r + 4) % 12 not in scale and (r + 3) % 12 in scale:
                b["chord"] = m.group(1) + "m"
    out["_pcs"] = pcs
    # chord names written in the tab beat the ones worked out from the notes
    written = _written_chords([lt] + harmony, len(out["bars"]))
    if written:
        last = ""
        for b, c in zip(out["bars"], written):
            last = c or last
            b["chord"] = last or b["chord"]
        out["chords_written"] = True
        out["key"] = _key(pcs, out["bars"])
    pcs = out.pop("_pcs")
    cache.write_text(json.dumps(out))
    return out
