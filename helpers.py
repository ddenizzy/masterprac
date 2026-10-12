"""MasterPrac helpers: Spotify (read / mute / pause / restore), power (plugged in?), Bluetooth (switch
the Mac's audio between the Kali speakers and the HeadRush), Songsterr (find and recognise songs).

Everything here is gentle: it never forces, retries instead, and reports what happened in plain words.
"""
import json
import re
import subprocess
import time
from pathlib import Path

import requests

DATA = Path(__file__).parent / "data"
DATA.mkdir(exist_ok=True)


def load(name, default):
    p = DATA / f"{name}.json"
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return default


def save(name, value):
    p = DATA / f"{name}.json"
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, indent=2))
    tmp.replace(p)


# ---------- Spotify ----------
def _osa(script):
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=6)
    return r.stdout.strip() if r.returncode == 0 else None


def spotify_now():
    """{'running', 'state', 'title', 'artist', 'volume'} (state: playing / paused / stopped / off)."""
    out = _osa('if application "Spotify" is running then\n tell application "Spotify"\n'
               '  if player state is stopped then return "stopped" & tab & "" & tab & "" & tab & (sound volume as string)\n'
               '  return (player state as string) & tab & (name of current track) & tab & (artist of current track) & tab & (sound volume as string)\n'
               ' end tell\nelse\n return "off"\nend if')
    if not out or out == "off":
        return {"running": False, "state": "off"}
    state, title, artist, vol = (out.split("\t") + ["", "", "", "0"])[:4]
    return {"running": True, "state": state, "title": title, "artist": artist, "volume": int(float(vol or 0))}


def spotify_position():
    """{'pos': seconds, 'state', 'title', 'artist'} - quick, for syncing the tab to the recording."""
    out = _osa('if application "Spotify" is running then\n tell application "Spotify" to return (player position as string) & tab & '
               '(player state as string) & tab & (name of current track) & tab & (artist of current track)\nelse\n return ""\nend if')
    if not out:
        return {"state": "off"}
    pos, state, title, artist = (out.split("\t") + ["", "", "", ""])[:4]
    return {"pos": float(pos.replace(",", ".") or 0), "state": state, "title": title, "artist": artist}


def spotify_mute():
    """Volume 0 but keep playing (listening minutes keep counting). Remembers the old volume."""
    now = spotify_now()
    if not now["running"]:
        return "Spotify isn't open."
    if now["volume"] > 0:
        save("spotify_restore", {"volume": now["volume"], "how": "mute"})
    _osa('tell application "Spotify" to set sound volume to 0')
    return f"Spotify muted (was {now['volume']}%), still playing so your minutes keep counting."


def spotify_pause():
    now = spotify_now()
    if not now["running"] or now["state"] != "playing":
        return "Spotify wasn't playing."
    save("spotify_restore", {"how": "pause", "volume": now["volume"]})
    _osa('tell application "Spotify" to pause')
    return "Spotify paused (on battery: pausing saves power)."


def spotify_restore():
    r = load("spotify_restore", None)
    if not r or not spotify_now()["running"]:
        return "Nothing to restore in Spotify."
    if r.get("how") == "mute":
        _osa(f'tell application "Spotify" to set sound volume to {int(r.get("volume", 60))}')
        msg = f"Spotify volume back to {r.get('volume')}%."
    else:
        msg = "Spotify stays paused (press play when you want it)."
    (DATA / "spotify_restore.json").unlink(missing_ok=True)
    return msg


# ---------- power ----------
def plugged_in():
    out = subprocess.run(["pmset", "-g", "batt"], capture_output=True, text=True).stdout
    return "AC Power" in out


# ---------- Bluetooth ----------
AMP_BT, SPEAKER_BT = "HeadRush Flex Prime", "LP-UNF"


def _device(name):
    import IOBluetooth
    for d in IOBluetooth.IOBluetoothDevice.pairedDevices() or []:
        if str(d.name()) == name:
            return d
    return None


def bt_status():
    out = {}
    for n in (AMP_BT, SPEAKER_BT):
        d = _device(n)
        out[n] = None if d is None else bool(d.isConnected())
    return out


def bt_connect(name, tries=3):
    """Connect a paired device, retrying gently. Returns (ok, message)."""
    d = _device(name)
    if d is None:
        return False, f"{name} isn't paired with this Mac."
    if d.isConnected():
        return True, f"{name} was already connected."
    for i in range(tries):
        d.openConnection()
        for _ in range(10):
            if d.isConnected():
                return True, f"Connected to {name}."
            time.sleep(0.5)
    return False, f"Couldn't reach {name} (is it on and nearby?). Nothing was forced."


def bt_disconnect(name):
    d = _device(name)
    if d is None or not d.isConnected():
        return True, f"{name} wasn't connected."
    d.closeConnection()
    for _ in range(10):
        if not d.isConnected():
            return True, f"Disconnected {name}."
        time.sleep(0.3)
    return False, f"{name} didn't let go; left it as it was."


# ---------- Songsterr ----------
SONGSTERR = "https://www.songsterr.com"


def songsterr_find(title, artist):
    """Best Songsterr match for a song, or None: {'id', 'title', 'artist', 'url'}."""
    title = re.sub(r"\s*[-(\[].*?(remaster|live|version|edit|mono|stereo).*$", "", title, flags=re.I).strip()
    try:
        hits = requests.get(f"{SONGSTERR}/api/songs", params={"pattern": f"{artist} {title}", "size": 5}, timeout=10).json()
    except (requests.RequestException, ValueError):
        return None
    if not hits:
        return None
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    best = next((h for h in hits if norm(h["title"]) == norm(title)), hits[0])
    return {"id": best["songId"], "title": best["title"], "artist": best["artist"], "url": songsterr_url(best)}


def songsterr_url(song):
    slug = re.sub(r"[^a-z0-9]+", "-", f"{song['artist']} {song['title']}".lower()).strip("-")
    return f"{SONGSTERR}/a/wsa/{slug}-tab-s{song['songId']}"


def songsterr_song_from_url(url):
    """The song open in the Songsterr window (from its address), or None."""
    m = re.search(r"-tab-s(\d+)", url or "")
    if not m:
        return None
    try:
        meta = requests.get(f"{SONGSTERR}/api/song/{m.group(1)}", timeout=10).json()
    except (requests.RequestException, ValueError):
        return None
    return {"id": meta["songId"], "title": meta["title"], "artist": meta["artist"], "url": url,
            "tracks": [{"name": t.get("name", ""), "instrument": t.get("instrument", ""), "tuning": t.get("tuning")}
                       for t in meta.get("tracks", [])]}


# ---------- what's playing in ANY app (macOS Now Playing) ----------
TOOLS = Path(__file__).parent / "tools"


def _np_lib():
    """The Now Playing library, built from tools/nowplaying.swift the first time (or after it changes)."""
    lib, src = TOOLS / "libnowplaying.dylib", TOOLS / "nowplaying.swift"
    if not lib.exists() or lib.stat().st_mtime < src.stat().st_mtime:
        subprocess.run(["swiftc", "-O", "-emit-library", str(src), "-o", str(lib)], capture_output=True, timeout=300)
    return lib


_latency = {"at": 0.0, "value": 0.0}


def output_latency():
    """Seconds between the Mac sending sound and the speakers playing it (Bluetooth ~0.2 s). Checked every 10 s."""
    if time.time() - _latency["at"] < 10:
        return _latency["value"]
    tool, src = TOOLS / "outlatency", TOOLS / "outlatency.swift"
    try:
        if not tool.exists() or tool.stat().st_mtime < src.stat().st_mtime:
            subprocess.run(["swiftc", "-O", str(src), "-o", str(tool)], capture_output=True, timeout=300)
        v = float(subprocess.run([str(tool)], capture_output=True, text=True, timeout=3).stdout.strip())
        _latency["value"] = v if 0 <= v < 1 else 0.0
    except (OSError, ValueError, subprocess.TimeoutExpired):
        pass
    _latency["at"] = time.time()
    return _latency["value"]


def _clean_app(name):
    """'Safari Graphics and Media' / 'Google Chrome Helper' -> 'Safari' / 'Google Chrome'."""
    return re.sub(r"\s+(Graphics and Media|Web Content|Networking|Helper.*)$", "", name or "").strip()


def clean_song(title, artist):
    """Song + artist from player text, e.g. YouTube's 'Radiohead - Creep (Official Video)' by 'RadioheadVEVO'."""
    t, a = title or "", artist or ""
    t = re.sub(r"\s*[\(\[][^)\]]*(official|video|audio|lyric|visuali[sz]er|hd|4k|remaster|live at|mv)[^)\]]*[\)\]]", "", t, flags=re.I)
    t = re.sub(r"\s*\|.*$|\s+-\s+YouTube$", "", t).strip()
    # Spotify's " - Remastered 2009", " - 2011 Remaster", " - Live", " - Single Version", " - Mono"...
    t = re.sub(r"\s+-\s+[^-]*\b(remaster(ed)?|live|version|mono|stereo|edit|mix|demo|acoustic)\b[^-]*$", "", t, flags=re.I).strip()
    t = re.sub(r"\s+-\s+(19|20)\d\d$", "", t).strip()  # " - 2011"
    a = re.sub(r"\s*-\s*Topic$|VEVO$|\s*Official$", "", a, flags=re.I).strip()
    m = re.match(r"^(.+?)\s+[-–—]\s+(.+)$", t)
    if m and (not a or _norm(m.group(1)) in _norm(a) or _norm(a) in _norm(m.group(1))):
        a, t = m.group(1).strip(), m.group(2).strip()
    t = re.sub(r"\s*[\(\[]?(ft\.?|feat\.?)\s.*$", "", t, flags=re.I).strip()
    return t, a


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def now_playing():
    """{'title', 'artist', 'app', 'playing', 'pos', 'duration', 'at'} for whatever plays on the Mac, or {'playing': False}."""
    fake = DATA / "fake_now.json"  # for testing without playing music: {"title", "artist", "app", "start": epoch seconds}
    if fake.exists():
        f = json.loads(fake.read_text())
        return {"title": f["title"], "artist": f["artist"], "raw_title": f["title"], "app": f.get("app", "Test"), "playing": True,
                "pos": time.time() - f["start"], "duration": f.get("duration", 240), "at": time.time()}
    try:
        out = subprocess.run(["/usr/bin/perl", str(TOOLS / "nowplaying.pl"), str(_np_lib())],
                             capture_output=True, text=True, timeout=6).stdout
        d = json.loads(out.strip().splitlines()[-1])
    except (OSError, ValueError, IndexError, subprocess.TimeoutExpired):
        return {"playing": False, "title": ""}
    if not d.get("title"):
        return {"playing": False, "title": ""}
    title, artist = clean_song(d["title"], d.get("artist", ""))
    pos = d.get("elapsed", 0) + (d.get("now", 0) - d.get("timestamp", 0)) * d.get("rate", 0)
    at = d.get("now") or time.time()
    app = _clean_app(d.get("app"))
    if app == "Spotify":  # macOS's Now Playing drifts (0.8 s behind after 3 min); Spotify's own clock doesn't
        sp = spotify_position()
        if sp.get("pos") is not None and sp.get("title") == d["title"]:
            pos, at = sp["pos"], time.time()
    return {"title": title, "artist": artist, "raw_title": d["title"], "app": app,
            "playing": d.get("rate", 0) > 0, "pos": round(pos, 3), "duration": d.get("duration", 0), "at": at,
            "latency": output_latency()}


def songsterr_match(title, artist):
    """Songsterr's version of a song only if it really is that song (titles must match; artists too if known)."""
    found = songsterr_matches(title, artist)
    return found[0] if found else None


def _same_artist(a, b):
    """'Jackson Browne' vs 'Jackson Brownie' (typos in uploads), 'The Beatles' vs 'Beatles'."""
    import difflib
    a, b = a.replace("the", ""), b.replace("the", "")
    return a in b or b in a or difflib.SequenceMatcher(None, a, b).ratio() >= 0.85


def songsterr_matches(title, artist):
    """Every Songsterr version of this exact song (there are often several, some unfinished), best match first."""
    if not title:
        return []
    try:
        hits = requests.get(f"{SONGSTERR}/api/songs", params={"pattern": f"{artist} {title}".strip(), "size": 20}, timeout=10).json()
    except (requests.RequestException, ValueError):
        return []
    t, a = _norm(re.sub(r"\(.*?\)", "", title)), _norm(artist)
    out = []
    for hit in hits or []:
        ht, ha = _norm(re.sub(r"\(.*?\)", "", hit["title"])), _norm(hit["artist"])
        if not a:  # no artist known (a video, a show...): only the exact same title counts
            close = _norm(hit["title"]) == _norm(title)
        else:
            close = ht == t or (len(t) > 4 and (ht.startswith(t) or t.startswith(ht)))
        if ht and close and (not a or _same_artist(a, ha)) and hit.get("hasPlayer", True):
            out.append({"id": hit["songId"], "title": hit["title"], "artist": hit["artist"], "url": songsterr_url(hit)})
    return out


# ---------- timed lyrics from LRCLIB (free, open: lrclib.net) when the tab has none ----------
def lrclib_lyrics(title, artist, duration=0):
    """Lines with their time in the RECORDING: [[seconds, "line"], ...] or []. Cached in data/lyrics.json."""
    key = f"{title}|{artist}|{round(duration or 0)}".lower()
    cache = load("lyrics", {})
    if key in cache:
        return cache[key]
    ua = {"User-Agent": "MasterPrac (personal guitar practice app)"}
    found = None
    try:
        r = requests.get("https://lrclib.net/api/get", params={"artist_name": artist, "track_name": title}, headers=ua, timeout=10)
        if r.ok and r.json().get("syncedLyrics") and (not duration or abs((r.json().get("duration") or 0) - duration) <= 6):
            found = r.json()
        if not found:  # same song, other versions: the one whose length matches the recording
            hits = requests.get("https://lrclib.net/api/search", params={"artist_name": artist, "track_name": title},
                                headers=ua, timeout=10).json()
            hits = [x for x in hits if x.get("syncedLyrics")]
            if duration:
                hits = [x for x in hits if abs((x.get("duration") or 0) - duration) <= 6]
            found = hits[0] if hits else None
    except (requests.RequestException, ValueError):
        return []  # offline: try again next time
    lines = []
    for raw in (found or {}).get("syncedLyrics", "").splitlines():
        m = re.match(r"\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)", raw)
        if m and m.group(3).strip():
            lines.append([round(int(m.group(1)) * 60 + float(m.group(2)), 2), m.group(3).strip()])
    cache[key] = lines
    save("lyrics", cache)
    return lines
