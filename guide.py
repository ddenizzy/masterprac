"""Per-song tone guide: which Strat pickup, guitar knobs, key/scale for improv, amp settings, tips.

Claude writes it once per song (Claude Code CLI on the user's subscription), cached in data/guides.json.
"""
import json
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

import helpers as h

GEAR = ("Guitar: Fender American Stratocaster (3 single coils, 5-way switch: 1 = bridge, 2 = bridge+middle, "
        "3 = middle, 4 = middle+neck, 5 = neck; one volume, tone 1 = neck, tone 2 = middle). Amp: HeadRush Flex Prime "
        "modeler into Kali studio monitors. Player: intermediate, learning keys and improvisation.")

SCHEMA = {
    "type": "object",
    "properties": {
        "key": {"type": "string"}, "tempo_bpm": {"type": "integer"}, "tuning": {"type": "string"},
        "summary": {"type": "string"},
        "strat": {"type": "object", "properties": {
            "switch": {"type": "integer"}, "switch_name": {"type": "string"},
            "volume": {"type": "number"}, "tone_neck": {"type": "number"}, "tone_middle": {"type": "number"},
            "why": {"type": "string"},
            "lead_switch": {"type": "integer"}, "lead_why": {"type": "string"}},
            "required": ["switch", "switch_name", "volume", "tone_neck", "tone_middle", "why", "lead_switch", "lead_why"],
            "additionalProperties": False},
        "amp": {"type": "object", "properties": {
            "type": {"type": "string"}, "gain": {"type": "number"}, "bass": {"type": "number"}, "mid": {"type": "number"},
            "treble": {"type": "number"}, "presence": {"type": "number"},
            "effects": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string"}, "setting": {"type": "string"}},
                "required": ["name", "setting"], "additionalProperties": False}}},
            "required": ["type", "gain", "bass", "mid", "treble", "presence", "effects"], "additionalProperties": False},
        "improv": {"type": "object", "properties": {
            "scale": {"type": "string"}, "also_try": {"type": "string"}, "target_notes": {"type": "string"},
            "tip": {"type": "string"}},
            "required": ["scale", "also_try", "target_notes", "tip"], "additionalProperties": False},
        "chords": {"type": "string"},
        "tips": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["key", "tempo_bpm", "tuning", "summary", "strat", "amp", "improv", "chords", "tips"],
    "additionalProperties": False,
}

SYSTEM = f"""You are a friendly guitar teacher. For the given song write a practical tone and practice guide for
this player. {GEAR}
Rules: knob values 0-10. strat.switch / lead_switch are 1-5 as above (lead_switch = for solos, can equal switch).
key: the song's key (e.g. "C# minor"); tempo_bpm: approximate; tuning: e.g. "Standard (E)" or "Eb standard".
summary: one sentence about the guitar sound. chords: the main progression(s) in short form (e.g. "Verse: C#m - A - E - B").
improv.scale: the best scale to improvise over it (e.g. "C# minor pentatonic"), also_try: a second option,
target_notes: chord tones worth landing on, tip: one sentence. tips: 3-5 short playing tips.
Plain words, short sentences, no markdown. If you're unsure about a fact, say "about" rather than inventing."""


def _claude():
    return shutil.which("claude") or next((str(p) for p in [Path.home() / ".local/bin/claude",
                                                             Path("/opt/homebrew/bin/claude")] if p.exists()), None)


def _ask(song):
    cli = _claude()
    if not cli:
        raise RuntimeError("Claude Code isn't installed, so no guide can be written.")
    user = f"Song: \"{song['title']}\" by {song['artist']}. Guitar tracks in the tab: " + \
        ", ".join(t["name"] for t in song.get("tracks", []) if "guitar" in (t.get("instrument") or "").lower())[:500]
    cmd = [cli, "-p", "--output-format", "json", "--tools", "", "--no-session-persistence", "--strict-mcp-config",
           "--setting-sources", "", "--system-prompt", SYSTEM, "--json-schema", json.dumps(SCHEMA)]
    with tempfile.TemporaryDirectory() as tmp:
        p = subprocess.run(cmd, input=user, capture_output=True, text=True, timeout=240, cwd=tmp)
    out = json.loads(p.stdout)
    if out.get("is_error"):
        raise RuntimeError(str(out.get("result"))[:200])
    return out.get("structured_output") or json.loads(out["result"])


_busy = set()


def get(song, on_ready=None):
    """The cached guide, or None while it's being written (then on_ready(song_id) fires)."""
    cache = h.load("guides", {})
    sid = str(song["id"])
    if sid in cache:
        return cache[sid]
    if sid not in _busy:
        _busy.add(sid)

        def work():
            try:
                g = _ask(song)
                c = h.load("guides", {})
                c[sid] = {**g, "song": {"title": song["title"], "artist": song["artist"]}}
                h.save("guides", c)
            except Exception as e:
                c = h.load("guides_errors", {})
                c[sid] = str(e)[:200]
                h.save("guides_errors", c)
            finally:
                _busy.discard(sid)
                if on_ready:
                    on_ready(song["id"])
        threading.Thread(target=work, daemon=True).start()
    return None


def status(song):
    sid = str(song["id"])
    if sid in h.load("guides", {}):
        return "ready"
    return "writing" if sid in _busy else ("error: " + h.load("guides_errors", {}).get(sid, "")) if sid in h.load("guides_errors", {}) else "writing"
