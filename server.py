"""MasterPrac's local server: the panel page and its data (only this Mac, only MasterPrac's own pages)."""
import logging
import threading
from datetime import datetime

from flask import Flask, jsonify, request, send_from_directory

import helpers as h

PORT = 5070
app = Flask(__name__, static_folder="static")
logging.getLogger("werkzeug").setLevel(logging.WARNING)

SESSION = {"log": [], "song": None, "spotify": None, "bt": None}
_lock = threading.Lock()


def log(text):
    """A plain-language line for the panel's 'What MasterPrac did' list."""
    with _lock:
        SESSION["log"].append({"at": datetime.now().strftime("%H:%M:%S"), "text": text})
        SESSION["log"] = SESSION["log"][-60:]
    print(" ", text, flush=True)


@app.before_request
def _same_origin_only():
    origin = request.headers.get("Origin")
    if request.method != "GET" and origin and origin not in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"):
        return jsonify({"error": "Not allowed from another website."}), 403


@app.post("/api/jslog")
def jslog():
    b = request.get_json(force=True) or {}
    print(f"  PAGE ERROR: {str(b.get('msg'))[:200]} @ {str(b.get('at'))[-60:]}", flush=True)
    return jsonify({"ok": True})


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/api/session")
def session():
    return jsonify({**SESSION, "plugged": h.plugged_in(), "spotify": h.spotify_now(), "bt": h.bt_status()})


@app.get("/api/guide")
def guide_now():
    """The tone guide for the open song: {'status': 'none' | 'writing' | 'ready' | 'error: ...', 'guide': {...}}."""
    import guide
    song = SESSION.get("song")
    if not song:
        return jsonify({"status": "none"})
    g = guide.get(song)
    return jsonify({"status": "ready" if g else guide.status(song), "guide": g, "song_id": song["id"]})


_amp = {"at": 0, "data": None}


@app.get("/api/amp")
def amp_now():
    """What's on the HeadRush right now (read-only; refreshed at most every 3 s)."""
    import time
    import ampview
    if time.time() - _amp["at"] > 3:
        _amp["data"], _amp["at"] = ampview.snapshot(), time.time()
    return jsonify(_amp["data"])


TEACHER = """You are a patient guitar teacher inside MasterPrac, a practice app. The student plays a Fender
Stratocaster through a HeadRush amp, is intermediate, and is learning keys, scales and improvisation.
Answer in plain, friendly words, short (max ~8 sentences or a few bullet points), no markdown headings.
Use the song context (key, chords, current bar, section) to make examples concrete: name actual frets and strings
when helpful (e.g. "the root B is on the 7th fret of the low E string"). If they ask something unrelated to music, answer briefly."""


@app.post("/api/ask")
def ask():
    """The Learn tab's question box: Claude answers about keys, scales, improv and the song that's open."""
    import json, subprocess, tempfile
    import guide
    b = request.get_json(force=True) or {}
    q = (b.get("question") or "").strip()[:800]
    if not q:
        return jsonify({"error": "Type a question first."}), 400
    cli = guide._claude()
    if not cli:
        return jsonify({"error": "Claude Code isn't installed."}), 500
    ctx = b.get("context") or {}
    song = SESSION.get("song")
    g = h.load("guides", {}).get(str(song["id"])) if song else None
    context = {"song": song and {"title": song["title"], "artist": song["artist"]}, "now": ctx,
               "guide": g and {k: g[k] for k in ("key", "tempo_bpm", "tuning", "chords", "improv", "strat") if k in g}}
    history = "\n".join(f"{'Student' if m.get('role') == 'user' else 'You'}: {m.get('text', '')[:600]}" for m in (b.get("history") or [])[-6:])
    prompt = f"Context: {json.dumps(context)}\n" + (f"Earlier:\n{history}\n" if history else "") + f"Student: {q}"
    cmd = [cli, "-p", "--output-format", "json", "--tools", "", "--no-session-persistence", "--strict-mcp-config",
           "--setting-sources", "", "--system-prompt", TEACHER]
    try:
        with tempfile.TemporaryDirectory() as tmp:
            r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=180, cwd=tmp)
        out = json.loads(r.stdout)
        if out.get("is_error"):
            raise RuntimeError(out.get("result"))
        return jsonify({"answer": out.get("result", "").strip()})
    except Exception as e:
        return jsonify({"error": f"Claude couldn't answer: {str(e)[:150]}"}), 502


@app.get("/api/tab")
def tab():
    """The open song's lead guitar notes + bar timing + chords + key (from Songsterr), for the fretboard."""
    import tabs
    song = SESSION.get("song")
    if not song:
        return jsonify({"error": "Open a song in the Songsterr tab first."}), 404
    lead = request.args.get("lead", type=int)
    try:
        return jsonify(tabs.load(song["id"], lead))
    except Exception as e:
        return jsonify({"error": f"Couldn't load this song's tab: {e}"}), 502


# ---------- NOW PLAYING: whatever plays on the Mac, in any app ----------
_matches = {}  # "title|artist" -> Songsterr match (or None), looked up once


@app.get("/api/now")
def now():
    """What's playing in any app + its Songsterr version (if Songsterr has that exact song)."""
    p = h.now_playing()
    if p.get("title"):
        k = f"{p['title']}|{p['artist']}".lower()
        if k not in _matches:
            _matches[k] = h.songsterr_match(p["title"], p["artist"])
        p["match"] = _matches[k]
    return jsonify(p)


@app.get("/api/now/tab/<int:song_id>")
def now_tab(song_id):
    """Chords per bar, bar times, key (and the lead notes) of a Songsterr song, for the Now playing page."""
    import tabs
    try:
        return jsonify(tabs.load(song_id))
    except Exception as e:
        return jsonify({"error": f"Couldn't load this song's tab: {e}"}), 502


@app.get("/api/pos")
def pos():
    """Where Spotify is in the song right now (it keeps playing muted), for following the tab."""
    import time
    p = h.spotify_position()
    p["at"] = time.time()
    return jsonify(p)


@app.get("/api/live")
def live():
    """12 note strengths + beat, from Custamo's listener (it already has the Mac's audio permission)."""
    import requests
    try:
        return jsonify(requests.get("http://127.0.0.1:5050/api/listen", timeout=1.5).json())
    except Exception:
        return jsonify({"live": False, "error": "Custamo isn't running, so MasterPrac can't hear the music."})


# ---------- my songs: practice time per song + favourites ----------
def practice_tick(seconds):
    """Add time to the song that's open (called every 15 s)."""
    song = SESSION.get("song")
    if not song:
        return
    p = h.load("practice", {})
    e = p.setdefault(str(song["id"]), {"id": song["id"], "title": song["title"], "artist": song["artist"],
                                       "url": song["url"], "seconds": 0, "sessions": 0})
    e["seconds"] += seconds
    e["last"] = datetime.now().strftime("%Y-%m-%d")
    h.save("practice", p)


def song_opened(song):
    p = h.load("practice", {})
    e = p.setdefault(str(song["id"]), {"id": song["id"], "title": song["title"], "artist": song["artist"],
                                       "url": song["url"], "seconds": 0, "sessions": 0})
    e["sessions"] += 1
    e["last"] = datetime.now().strftime("%Y-%m-%d")
    h.save("practice", p)


@app.get("/api/songs")
def songs():
    p = h.load("practice", {})
    fav = h.load("favorites", [])
    practised = sorted(p.values(), key=lambda e: -e["seconds"])[:20]
    return jsonify({"favorites": [p[str(i)] for i in fav if str(i) in p], "practised": practised,
                    "current": SESSION.get("song", {}) and SESSION["song"]["id"], "fav_ids": fav})


@app.post("/api/songs/fav")
def toggle_fav():
    song = SESSION.get("song")
    sid = (request.get_json(force=True) or {}).get("id") or (song and song["id"])
    if not sid:
        return jsonify({"error": "Open a song first."}), 400
    if song and song["id"] == sid:
        song_opened(song) if str(sid) not in h.load("practice", {}) else None
    fav = h.load("favorites", [])
    fav = [i for i in fav if i != sid] if sid in fav else fav + [sid]
    h.save("favorites", fav)
    log(("Saved" if sid in fav else "Removed") + " a favourite song.")
    return songs()


@app.post("/api/sound/<where>")
def sound(where):
    """Move the Mac's sound: 'amp' (HeadRush over Bluetooth) or 'speakers' (Kali)."""
    off, on = (h.SPEAKER_BT, h.AMP_BT) if where == "amp" else (h.AMP_BT, h.SPEAKER_BT)
    log(h.bt_disconnect(off)[1])
    ok, msg = h.bt_connect(on)
    log(msg)
    return jsonify({"ok": ok, "bt": h.bt_status()})
