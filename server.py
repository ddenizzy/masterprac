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
