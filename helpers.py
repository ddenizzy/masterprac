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
