"""MasterPrac's local server: the panel page and its data (only this Mac, only MasterPrac's own pages)."""
import logging
import threading
import time
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


@app.get("/api/settings")
def settings_get():
    return jsonify({"mute_spotify": h.load("settings", {}).get("mute_spotify", False)})


@app.post("/api/settings")
def settings_set():
    """{mute_spotify: bool}: also acts now (mute / pause Spotify, or give it its volume back)."""
    b = request.get_json(force=True) or {}
    st = h.load("settings", {})
    msg = ""
    if "mute_spotify" in b:
        st["mute_spotify"] = bool(b["mute_spotify"])
        if st["mute_spotify"]:
            if h.spotify_now().get("state") == "playing":
                msg = h.spotify_mute() if h.plugged_in() else h.spotify_pause()
        else:
            msg = h.spotify_restore()
        log(f"Mute Spotify while practising: {'on' if st['mute_spotify'] else 'off'}. {msg}")
    h.save("settings", st)
    return jsonify({**st, "message": msg})


SHOW_WINDOW = {"fn": None}  # set by main.py: bring the window to the front


@app.post("/api/window/show")
def window_show():
    """MasterPrac.app opened again while already running: just show the window."""
    if SHOW_WINDOW["fn"]:
        SHOW_WINDOW["fn"]()
    return jsonify({"ok": True})


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


# ---------- NOW PLAYING: whatever plays on the Mac, in any app ----------
_matches = {}  # "title|artist" -> the best Songsterr version (or None), looked up once
_match_lock = threading.Lock()
_followed = {"key": None}


def best_version(title, artist, duration=0):
    """The tab version you picked for this song, else Songsterr's top one (or a more complete one if that's unfinished,
    or one as long as the recording if the top one is much shorter / longer: a half-song tab once ended at 2:16 of 4:26)."""
    import tabs
    pick = h.load("version_choice", {}).get(f"{title}|{artist}".lower())
    if pick:
        return pick
    found = h.songsterr_matches(title, artist)[:6]
    if len(found) <= 1:
        return found[0] if found else None

    def length(m):
        try:
            d = tabs.load(m["id"])
            return d["bars"][-1]["end"] if d["bars"] else 0
        except Exception:
            return 0
    if duration > 30:
        off = lambda m: abs(length(m) - duration) / duration
        if off(found[0]) > 0.15:
            near = [m for m in found if off(m) <= 0.1]
            if near:
                best = near[0]  # Songsterr's order among the ones that fit (best-made / most-viewed first)
                log(f"Using a Songsterr tab of \"{title}\" as long as the recording ({round(length(best))} s of {round(duration)} s).")
                return best

    def coverage(m):
        try:
            d = tabs.load(m["id"])
        except Exception:
            return 0
        return max((t.get("played") or 0 for t in d["tracks"]), default=0) / max(1, len(d["bars"]))
    # Songsterr's top result is usually the best-made, most-viewed tab: keep it unless it's unfinished
    if coverage(found[0]) >= 0.5:
        return found[0]

    def score(m):
        try:
            d = tabs.load(m["id"])
        except Exception:
            return -1
        most = max((t.get("played") or 0 for t in d["tracks"]), default=0)
        return most / max(1, len(d["bars"])) + (0.3 if d["synced"] else 0) + 0.05 * len(d["tracks"])
    best = max(found, key=score)
    if best is not found[0]:
        log(f"Using the most complete Songsterr tab of \"{title}\" (by {best['artist']} on Songsterr).")
    return best


PLAYING = {"playing": False, "since": 0.0, "pos": 0.0, "at": 0.0, "title": ""}


def note_playback(p):
    """Remember when playback (re)started or jumped, so syncing only uses sound from after that."""
    import time as _t
    now = _t.time()
    playing, title = bool(p.get("playing")), p.get("title", "")
    expected = PLAYING["pos"] + (now - PLAYING["at"] if PLAYING["playing"] else 0)
    jumped = playing and PLAYING["playing"] and abs((p.get("pos") or 0) + (now - (p.get("at") or now)) - expected) > 1.5
    if playing and (not PLAYING["playing"] or title != PLAYING["title"] or jumped):
        PLAYING["since"] = now
    PLAYING.update(playing=playing, title=title, pos=p.get("pos") or 0, at=p.get("at") or now)


@app.get("/api/now")
def now():
    """What's playing in any app + its Songsterr version (the most complete one, if Songsterr has that song).
    ?listen=1 (the Play page, auto-sync on): keep MasterPrac's ears on, so sound is already saved up for syncing."""
    p = h.now_playing()
    note_playback(p)
    if request.args.get("listen") and p.get("playing"):
        import listen
        if listen._state["proc"] is None:
            print(f"  now?listen {time.strftime('%H:%M:%S')}: starting ears", flush=True)
        listen.listen()
    if p.get("title"):
        k = f"{p['title']}|{p['artist']}".lower()
        with _match_lock:  # the page asks every second: look it up once
            if k not in _matches:
                _matches[k] = best_version(p["title"], p["artist"], p.get("duration") or 0)
            if _matches[k] and _followed.get("key") != k:  # the playing song changed: follow it
                _followed["key"] = k
                follow_song(_matches[k])
        p["match"] = _matches[k]
    return jsonify(p)


@app.get("/api/sync/<int:song_id>")
def sync_now(song_id):
    """Listen to the last ~20 s and work out where the tab is vs the recording (see sync.py)."""
    import listen
    import sync
    import tabs
    import time
    listen.listen()  # keep MasterPrac's ears on while the page asks
    try:
        tab = tabs.load(song_id, request.args.get("lead", type=int))
    except Exception as e:
        return jsonify({"error": str(e)}), 502
    p = h.now_playing()
    note_playback(p)
    if not p.get("title"):
        return jsonify({"result": None, "why": "nothing playing"})
    if not p["playing"]:
        return jsonify({"result": None, "why": "paused"})
    pos_at = lambda c: p["pos"] + (c - p["at"])
    # only sound heard since playback last (re)started: older sound belongs to other positions
    seconds = min(request.args.get("seconds", default=20, type=float), time.time() - PLAYING["since"] - 0.3)
    t0 = time.time()
    r = sync.solve(tab, pos_at, seconds=seconds, near=request.args.get("near", type=float)) if seconds >= 3 else None
    print(f"  sync {time.strftime('%H:%M:%S')} heard={listen.recent(20)[0].size / max(1, listen.RATE):.1f}s -> "
          f"{'offset %+.2f conf %.2f' % (r['offset'], r['note_conf']) if r else 'no answer yet'}", flush=True)
    return jsonify({"result": r, "took": round(time.time() - t0, 2), "error": listen.notes().get("error")})


@app.get("/api/search")
def search():
    """Songsterr search for practice mode: [{id, title, artist}]."""
    import requests
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])
    try:
        hits = requests.get(f"{h.SONGSTERR}/api/songs", params={"pattern": q, "size": 12}, timeout=10).json()
    except Exception:
        return jsonify([])
    return jsonify([{"id": x["songId"], "title": x["title"], "artist": x["artist"]} for x in hits if x.get("hasPlayer", True)])


@app.get("/api/lyrics")
def lyrics_now():
    """Timed lyric lines for the playing recording (LRCLIB), for songs whose tab has no lyrics."""
    if request.args.get("title"):
        return jsonify(h.with_syllables(h.lrclib_lyrics(request.args["title"], request.args.get("artist", ""), 0)))
    p = h.now_playing()
    if not p.get("title"):
        return jsonify({"lines": [], "syl": []})
    return jsonify(dict(h.with_syllables(h.lrclib_lyrics(p["title"], p["artist"], p.get("duration") or 0)), title=p["title"]))


@app.post("/api/player/<what>")
def player(what):
    """MasterPrac's play / pause button: tells Spotify, so the music and the tab start at the same moment."""
    if what not in ("play", "pause", "toggle"):
        return jsonify({"error": "play, pause or toggle"}), 400
    cmd = {"play": "play", "pause": "pause", "toggle": "playpause"}[what]
    h._osa(f'tell application "Spotify" to {cmd}')
    return jsonify(h.now_playing())


@app.get("/api/now/versions")
def now_versions():
    """Every Songsterr version of the playing song, with what's in it, to choose from."""
    import tabs
    from concurrent.futures import ThreadPoolExecutor
    p = h.now_playing()
    if not p.get("title"):
        return jsonify({"versions": []})
    k = f"{p['title']}|{p['artist']}".lower()
    found = h.songsterr_matches(p["title"], p["artist"])[:8]
    cur = (_matches.get(k) or {}).get("id")

    def info(m):
        try:
            d = tabs.load(m["id"])
        except Exception:
            return None
        parts = [{"i": t["i"], "name": t["name"], "instrument": t["instrument"], "played": t.get("played") or 0} for t in d["tracks"]]
        return {**m, "synced": d["synced"], "length": round(d["bars"][-1]["end"]) if d["bars"] else 0, "bars": len(d["bars"]),
                "parts": parts, "lyrics": bool(d.get("lyrics")), "chosen": m["id"] == cur}
    with ThreadPoolExecutor(4) as ex:
        out = [v for v in ex.map(info, found) if v]
    return jsonify({"versions": out, "duration": round(p.get("duration") or 0)})


@app.post("/api/now/version")
def now_version():
    """Use this tab version for the playing song from now on: {id} from the list, or {url} of any Songsterr tab."""
    p = h.now_playing()
    if not p.get("title"):
        return jsonify({"error": "Nothing is playing."}), 400
    b = request.get_json(force=True) or {}
    sid = b.get("id")
    if b.get("url"):
        m = h.re.search(r"-tab-s(\d+)", b["url"])
        if not m:
            return jsonify({"error": "That isn't a Songsterr tab link (it should end like ...-tab-s12345)."}), 400
        sid = int(m.group(1))
    found = h.songsterr_song_from_url(f"{h.SONGSTERR}/a/wsa/x-tab-s{int(sid)}")
    if not found:
        return jsonify({"error": "Couldn't open that tab on Songsterr."}), 400
    m = {"id": found["id"], "title": found["title"], "artist": found["artist"],
         "url": h.songsterr_url({"songId": found["id"], "title": found["title"], "artist": found["artist"]})}
    k = f"{p['title']}|{p['artist']}".lower()
    picks = h.load("version_choice", {})
    picks[k] = m
    h.save("version_choice", picks)
    with _match_lock:
        _matches[k] = m
        _followed["key"] = k
    follow_song(m)
    log(f"Using the tab you picked for \"{p['title']}\" ({m['artist']} on Songsterr).")
    return jsonify({"ok": True, "match": m})


def watch_now_playing():
    """Background: every 3 s, follow whatever plays on the Mac, whichever page is open (Amp & tone, My songs...)."""
    import time as _t
    while True:
        _t.sleep(3)
        try:
            p = h.now_playing()
            note_playback(p)
            if not p.get("title"):
                continue
            k = f"{p['title']}|{p['artist']}".lower()
            with _match_lock:
                if k not in _matches:
                    _matches[k] = best_version(p["title"], p["artist"], p.get("duration") or 0)
                if _matches[k] and _followed.get("key") != k:
                    _followed["key"] = k
                    follow_song(_matches[k])
        except Exception as e:
            print(f"  now-playing watch: {e}", flush=True)


def follow_song(m):
    """A new song started in Spotify/YouTube/...: it becomes THE song (Amp & tone, My songs) - the latest one wins,
    whether it was started in a player or opened in the Songsterr tab."""
    import guide
    cur = SESSION.get("song")
    if cur and cur.get("id") == m["id"]:
        return
    song = {"id": m["id"], "title": m["title"], "artist": m["artist"], "url": m["url"], "tracks": []}
    SESSION["song"] = song
    log(f"Now playing: \"{song['title']}\" by {song['artist']}.")
    song_opened(song)
    if not guide.get(song, on_ready=lambda sid: log(f"Tone guide ready for \"{song['title']}\" (Amp & tone tab).")):
        log(f"Writing the tone guide for \"{song['title']}\" (about 20 seconds)...")


@app.get("/api/now/tab/<int:song_id>")
def now_tab(song_id):
    """Chords per bar, bar times, key (and the lead notes) of a Songsterr song, for the Now playing page."""
    import tabs
    try:
        return jsonify(tabs.load(song_id, request.args.get("lead", type=int)))  # lead = the guitar part to follow
    except Exception as e:
        return jsonify({"error": f"Couldn't load this song's tab: {e}"}), 502


@app.get("/api/live")
def live():
    """12 note strengths + beat from MasterPrac's own ears (only while the page keeps asking)."""
    import listen
    return jsonify(listen.listen())


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
