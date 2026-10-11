"""Read-only look at the HeadRush right now: loaded rig, its blocks (on/off + main knobs), switches,
rig volume. Never changes anything on the amp."""
import json
from pathlib import Path

import requests

B = "http://headrushflexprime.local/api/v1"
MT = json.loads((Path(__file__).parent / "moduletypes.json").read_text())
_s = requests.Session()


def _get(path):
    return _s.get(f"{B}/object-properties{path}", timeout=4).json()


def _path(block):
    return "/Evil/Engine/Patch/" + block.replace(" ", "_")


def snapshot():
    """{'reachable', 'rig', 'volume_db', 'blocks': [{slot, name, preset, on, knobs: [[label, value 0-10]]}], 'switches'}."""
    try:
        r = _get("/Evil/API/Rigs")
    except (requests.RequestException, ValueError):
        return {"reachable": False}
    chain = _get("/Evil/Engine/Patch/Chain")
    blocks = []
    for i in range(1, 15):
        name = MT[chain.get(f"ModuleType{i}", 0)]
        if name == "Empty Slot":
            continue
        try:
            v = _get(_path(name))
        except (requests.RequestException, ValueError):
            continue
        knobs = [[l, round(v[k] * 10, 1)] for k, l in zip(v.get("order", []), v.get("labels", []))
                 if l and not k.endswith("2") and isinstance(v.get(k), float) and k not in v.get("disabled", [])][:6]
        blocks.append({"slot": i, "name": name, "preset": v.get("PresetName", ""), "on": bool(v.get("On", True)), "knobs": knobs})
    fs = _get("/Evil/Engine/FootSwitch")
    switches = [{"n": n, "label": fs.get(f"FootSwitchText{n}") or fs.get(f"Module{n}", ""),
                 "mode": ["Toggle", "Hold", "Scene"][fs.get(f"ModeNew{n}", 0)]} for n in range(1, 7)]
    out = _get("/Evil/Engine/Patch/Output")
    return {"reachable": True, "rig": r.get("loadedName"), "volume_db": round(-60 + out.get("RigVolume", .625) * 96, 1),
            "blocks": blocks, "switches": switches}
