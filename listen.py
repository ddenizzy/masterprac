"""MasterPrac's ears: hears what the Mac is playing (any app) and turns it into the 12 note strengths (chroma),
for working out chords "by ear". Uses the `audiotap` helper inside MasterPrac.app (Core Audio process tap:
audio only, nothing recorded or saved; macOS asks once for "System Audio Recording").
It only listens while the page keeps asking (by-ear mode on the Play page) and stops ~8 s after it stops.
"""
import os
import subprocess
import threading
import time

import numpy as np

TAP = "/Applications/MasterPrac.app/Contents/MacOS/audiotap"
LONG = 16384  # ~0.34 s: fine enough frequency detail to tell notes apart
_state = {"proc": None, "ring": np.zeros(LONG, np.float32), "at": 0.0, "error": None, "until": 0.0}
_lock = threading.Lock()
_lw = np.hanning(LONG).astype(np.float32)


def set_rate(rate):
    """Frequency tables for the real sample rate (a wrong rate makes every note sound sharp or flat)."""
    global RATE, _lf, _band, _pc, _mid
    RATE = rate
    _lf = np.fft.rfftfreq(LONG, 1 / RATE)
    _band = (_lf >= 70) & (_lf <= 2000)  # bass E (~41 Hz) is too blurry here; low strings show via harmonics
    _pc = np.round(12 * np.log2(np.maximum(_lf[_band], 1) / 440.0) + 69).astype(int) % 12  # pitch class per bin
    _mid = (_lf[_band] >= 150) & (_lf[_band] <= 1500)  # "guitar range": no bass, no cymbals


set_rate(48000)


RECENT = 25  # seconds of sound kept for syncing (with the clock time of the newest sample)
_rec = {"buf": np.zeros(48000 * RECENT, np.float32), "n": 0, "t": 0.0}


def _feed(new):
    now = time.time()
    with _lock:
        ring = np.roll(_state["ring"], -len(new))
        ring[-min(len(new), LONG):] = new[-LONG:]
        _state["ring"], _state["at"] = ring, now
        buf, k = _rec["buf"], len(new)
        if k >= len(buf):
            buf[:] = new[-len(buf):]
        else:
            buf[:-k] = buf[k:]
            buf[-k:] = new
        _rec["n"] = min(len(buf), _rec["n"] + k)
        _rec["t"] = now


def recent(seconds):
    """The last `seconds` of sound (mono floats) + the clock time of its newest sample + the sample rate."""
    with _lock:
        n = min(_rec["n"], int(seconds * RATE), len(_rec["buf"]))
        return _rec["buf"][len(_rec["buf"]) - n:].copy(), _rec["t"], RATE


_start_lock = threading.Lock()


def start():
    with _start_lock:  # the page asks from several places at once: start only one listener
        _start()


def _start():
    if _state["proc"] is not None:
        return
    if not os.path.exists(TAP):
        _state["error"] = "MasterPrac.app isn't built yet (run build_app.sh), so it can't hear the music."
        return
    proc = subprocess.Popen([TAP], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    first = proc.stderr.readline().decode(errors="ignore").strip()  # "OK 44100 Hz 1 ch" or "ERR ..."
    if not first.startswith("OK"):
        proc.kill()
        _state["error"] = ("MasterPrac isn't allowed to hear the Mac's sound yet: System Settings > Privacy & Security > "
                           f"Screen & System Audio Recording > turn on MasterPrac. ({first or 'no answer'})")
        print(f"  ears: {first or 'no answer'}", flush=True)
        return
    _state["proc"], _state["error"] = proc, None
    try:
        set_rate(int(first.split()[1]))
    except (IndexError, ValueError):
        pass
    _rec.update(buf=np.zeros(int(RATE * RECENT), np.float32), n=0, t=0.0)

    def read():
        while True:
            chunk = proc.stdout.read(4096)
            if not chunk:
                break
            _feed(np.frombuffer(chunk[: len(chunk) // 4 * 4], dtype=np.float32))
    threading.Thread(target=read, daemon=True).start()
    print(f"  ears: listening (audio only, {first[3:]})", flush=True)


def stop():
    with _start_lock:
        proc, _state["proc"] = _state["proc"], None
    if proc is not None:
        proc.terminate()  # the helper removes its tap on SIGTERM
        print("  ears: stopped", flush=True)


_prev = {"e": 0.0, "avg": 1e-6}


def notes():
    """{'live', 'chroma': 12 values 0..1 (C, C#, ... B), 'chroma_mid', 'rms', 'onset'} - only while listening."""
    if _state["proc"] is None or time.time() - _state["at"] > 1.0:
        return {"live": False, "chroma": [0.0] * 12, "rms": 0.0, "onset": False, "error": _state["error"]}
    with _lock:
        ring = _state["ring"].copy()
    spec = np.abs(np.fft.rfft(ring * _lw))[_band]

    def fold(sel):
        c = np.bincount(_pc[sel], weights=spec[sel] ** 2, minlength=12)
        return c / c.max() if c.max() > 0 else c
    e = float(np.sqrt(np.mean(ring[-2400:] ** 2)))  # the last ~50 ms: a jump = a beat
    avg = _prev["avg"] * 0.9 + e * 0.1
    onset = e > avg * 1.6 and e - _prev["e"] > 0.01
    _prev.update(e=e, avg=avg)
    return {"live": True, "chroma": [round(float(c), 3) for c in fold(slice(None))],
            "chroma_mid": [round(float(c), 3) for c in fold(_mid)], "rms": round(e, 5), "onset": bool(onset)}


def listen():
    """Called by the page while by-ear is on: keep listening for 8 more seconds, return the notes now."""
    _state["until"] = time.time() + 8
    start()

    def stop_later():
        time.sleep(9)
        if time.time() > _state["until"]:
            stop()
    threading.Thread(target=stop_later, daemon=True).start()
    return notes()
