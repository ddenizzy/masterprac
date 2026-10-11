"""MasterPrac: guitar practice, keys and improv, with your HeadRush.

Two windows side by side: Songsterr (left, the tab of the song) and the MasterPrac panel (right).
Opening the app:  finds the song Spotify is playing on Songsterr, mutes Spotify (plugged in) or pauses it
(battery), and moves the Mac's sound from the Kali speakers to the HeadRush over Bluetooth.
Closing the app:  sound goes back to the Kali speakers and Spotify's volume comes back.
The amp keeps whatever rig it had; MasterPrac never changes your saved rigs.
"""
import sys
import threading
import time
import warnings

warnings.filterwarnings("ignore")
import webview
from AppKit import NSScreen

import helpers as h
from server import PORT, SESSION, app, log

DRY = "--no-switch" in sys.argv  # development: don't touch Spotify or Bluetooth


def start_session(songsterr):
    log("MasterPrac opened. Your amp keeps the rig it already has; your saved rigs are never changed.")
    sp = h.spotify_now()
    SESSION["spotify"] = sp
    if sp["state"] in ("playing", "paused") and sp.get("title"):
        song = h.songsterr_find(sp["title"], sp["artist"])
        if song:
            songsterr.load_url(song["url"])
            log(f"Opened \"{song['title']}\" by {song['artist']} on Songsterr (what Spotify was playing).")
        else:
            log(f"Couldn't find \"{sp['title']}\" on Songsterr. Search for it in the left window.")
    else:
        log("Spotify isn't playing, so Songsterr opens on its home page. Search any song on the left.")
    if DRY:
        log("(Test mode: Spotify and Bluetooth were left alone.)")
        return
    if sp["state"] == "playing":
        log(h.spotify_mute() if h.plugged_in() else h.spotify_pause())
    ok, msg = h.bt_disconnect(h.SPEAKER_BT)
    log(msg)
    ok, msg = h.bt_connect(h.AMP_BT)
    log(msg + (" The Mac's sound now plays through your amp." if ok else ""))
    SESSION["bt"] = h.bt_status()


def end_session():
    if DRY or SESSION.get("ended"):
        return
    SESSION["ended"] = True
    print(" ", h.bt_disconnect(h.AMP_BT)[1], flush=True)
    print(" ", h.bt_connect(h.SPEAKER_BT)[1], flush=True)
    print(" ", h.spotify_restore(), flush=True)


def watch_songsterr(win):
    """Notice which song is open in the Songsterr window (from its address)."""
    last = None
    while True:
        time.sleep(1.5)
        try:
            url = win.get_current_url()
        except Exception:
            continue
        if url and url != last:
            last = url
            song = h.songsterr_song_from_url(url)
            if song and (not SESSION.get("song") or SESSION["song"]["id"] != song["id"]):
                SESSION["song"] = song
                log(f"Song detected in Songsterr: \"{song['title']}\" by {song['artist']}.")


def main():
    threading.Thread(target=lambda: app.run(host="127.0.0.1", port=PORT, threaded=True), daemon=True).start()
    scr = NSScreen.mainScreen().visibleFrame()
    W, H = int(scr.size.width), int(scr.size.height)
    left = int(W * 0.56)
    songsterr = webview.create_window("Songsterr · MasterPrac", h.SONGSTERR, x=0, y=0, width=left, height=H)
    panel = webview.create_window("MasterPrac", f"http://127.0.0.1:{PORT}/", x=left, y=0, width=W - left, height=H,
                                  min_size=(420, 500))
    for w in (songsterr, panel):
        w.events.closing += end_session  # closing either window ends the session cleanly

    def on_start():
        threading.Thread(target=start_session, args=(songsterr,), daemon=True).start()
        threading.Thread(target=watch_songsterr, args=(songsterr,), daemon=True).start()

    try:
        webview.start(on_start)
    finally:
        end_session()


if __name__ == "__main__":
    main()
