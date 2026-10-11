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


@app.post("/api/sound/<where>")
def sound(where):
    """Move the Mac's sound: 'amp' (HeadRush over Bluetooth) or 'speakers' (Kali)."""
    off, on = (h.SPEAKER_BT, h.AMP_BT) if where == "amp" else (h.AMP_BT, h.SPEAKER_BT)
    log(h.bt_disconnect(off)[1])
    ok, msg = h.bt_connect(on)
    log(msg)
    return jsonify({"ok": ok, "bt": h.bt_status()})
