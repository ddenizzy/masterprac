"""MasterPrac: guitar practice, keys and improv, with your HeadRush. ONE window with tabs:
SONGSTERR (a real browser built into the window), LIVE NOTES (fretboard following the song) and
AMP & TONE (pickup / knobs / amp for the song, and your amp's current setup).

Songsterr refuses to be shown inside a web page (X-Frame-Options), so the SONGSTERR tab is a native
WKWebView placed over the page's browser area; the page tells Python where that area is.

Opening the app:  opens the song Spotify is playing in Songsterr, mutes Spotify (plugged in) or pauses it
(battery), and moves the Mac's sound from the Kali speakers to the HeadRush over Bluetooth.
Closing the app:  sound goes back to the Kali speakers and Spotify's volume comes back.
The amp keeps whatever rig it had; MasterPrac never changes your saved rigs.
"""
import sys
import threading
import warnings

warnings.filterwarnings("ignore")
import webview
from AppKit import NSApp, NSMakeRect, NSScreen
from Foundation import NSURL, NSURLRequest
from PyObjCTools import AppHelper
from WebKit import WKWebView, WKWebViewConfiguration

import helpers as h
from server import PORT, SESSION, app, log

DRY = "--no-switch" in sys.argv  # development: don't touch Spotify or Bluetooth


class Browser:
    """The built-in Songsterr browser (a native web view inside the app window). Main thread only."""

    def __init__(self, window):
        self.window, self.view, self.last_url = window, None, None

    def _ensure(self):
        if self.view is None:
            content = self.window.native.contentView()
            cfg = WKWebViewConfiguration.alloc().init()
            self.view = WKWebView.alloc().initWithFrame_configuration_(NSMakeRect(0, 0, 10, 10), cfg)
            self.view.setHidden_(True)
            content.addSubview_(self.view)
            self.go(SESSION.get("start_url") or h.SONGSTERR)
        return self.view

    def place(self, x, y, w, hgt):
        """Show the browser over the page's browser area (CSS pixels from the top-left)."""
        v = self._ensure()
        content_h = self.window.native.contentView().frame().size.height
        flipped = self.window.native.contentView().isFlipped()
        v.setFrame_(NSMakeRect(x, y if flipped else content_h - y - hgt, w, hgt))
        v.setHidden_(False)

    def hide(self):
        if self.view is not None:
            self.view.setHidden_(True)

    def go(self, url):
        v = self._ensure()
        v.loadRequest_(NSURLRequest.requestWithURL_(NSURL.URLWithString_(url)))

    def back(self):
        if self.view is not None and self.view.canGoBack():
            self.view.goBack()

    def forward(self):
        if self.view is not None and self.view.canGoForward():
            self.view.goForward()

    def reload(self):
        if self.view is not None:
            self.view.reload()

    def url(self):
        return str(self.view.URL().absoluteString()) if self.view is not None and self.view.URL() else None


class Api:
    """Called from the page (window.pywebview.api.*); UI work hops to the main thread."""

    def __init__(self):
        self.browser = None

    def browser_place(self, x, y, w, hgt):
        AppHelper.callAfter(self.browser.place, float(x), float(y), float(w), float(hgt))

    def browser_hide(self):
        AppHelper.callAfter(self.browser.hide)

    def browser_go(self, url):
        if url.startswith("https://www.songsterr.com"):
            AppHelper.callAfter(self.browser.go, url)

    def browser_search(self, text):
        import urllib.parse
        AppHelper.callAfter(self.browser.go, f"{h.SONGSTERR}/?pattern={urllib.parse.quote(text)}")

    def browser_nav(self, what):
        AppHelper.callAfter({"back": self.browser.back, "forward": self.browser.forward,
                             "reload": self.browser.reload}[what])

    def open_spotify_song(self):
        sp = h.spotify_now()
        song = h.songsterr_find(sp.get("title", ""), sp.get("artist", "")) if sp.get("title") else None
        if song:
            self.browser_go(song["url"])
            log(f"Opened \"{song['title']}\" by {song['artist']} (Spotify's song).")
            return {"ok": True}
        log("Couldn't find Spotify's current song on Songsterr.")
        return {"ok": False}


def start_session(api):
    log("MasterPrac opened. Your amp keeps the rig it already has; your saved rigs are never changed.")
    sp = h.spotify_now()
    SESSION["spotify"] = sp
    if sp["state"] in ("playing", "paused") and sp.get("title"):
        song = h.songsterr_find(sp["title"], sp["artist"])
        if song:
            SESSION["start_url"] = song["url"]
            AppHelper.callAfter(api.browser.go, song["url"])
            log(f"Opened \"{song['title']}\" by {song['artist']} in the SONGSTERR tab (what Spotify was playing).")
        else:
            log(f"Couldn't find \"{sp['title']}\" on Songsterr. Search for it in the SONGSTERR tab.")
    else:
        log("Spotify isn't playing, so Songsterr opens on its home page.")
    if DRY:
        log("(Test mode: Spotify and Bluetooth were left alone.)")
        return
    if sp["state"] == "playing":
        log(h.spotify_mute() if h.plugged_in() else h.spotify_pause())
    log(h.bt_disconnect(h.SPEAKER_BT)[1])
    ok, msg = h.bt_connect(h.AMP_BT)
    log(msg + (" The Mac's sound now plays through your amp." if ok else ""))


def end_session():
    if DRY or SESSION.get("ended"):
        return
    SESSION["ended"] = True
    print(" ", h.bt_disconnect(h.AMP_BT)[1], flush=True)
    print(" ", h.bt_connect(h.SPEAKER_BT)[1], flush=True)
    print(" ", h.spotify_restore(), flush=True)


def watch_browser(browser):
    """Every 1.5 s (main thread): which song is open? The lookup itself runs off the main thread."""
    url = browser.url()
    if url and url != browser.last_url:
        browser.last_url = url

        def lookup():
            song = h.songsterr_song_from_url(url)
            if song and (not SESSION.get("song") or SESSION["song"]["id"] != song["id"]):
                SESSION["song"] = song
                log(f"Song detected: \"{song['title']}\" by {song['artist']}.")
                from server import song_opened
                song_opened(song)
                import guide
                if not guide.get(song, on_ready=lambda sid: log(f"Tone guide ready for \"{song['title']}\" (Amp & tone tab).")):
                    log(f"Writing the tone guide for \"{song['title']}\" (about 20 seconds)...")
        threading.Thread(target=lookup, daemon=True).start()
    AppHelper.callLater(1.5, watch_browser, browser)


def _port_free():
    import socket
    with socket.socket() as so:
        return so.connect_ex(("127.0.0.1", PORT)) != 0


def main():
    import time
    for _ in range(20):  # a previous MasterPrac may still be closing: wait a moment instead of colliding
        if _port_free():
            break
        time.sleep(0.5)
    else:
        print("  MasterPrac is already open (or something else uses port 5070).", flush=True)
        return
    threading.Thread(target=lambda: app.run(host="127.0.0.1", port=PORT, threaded=True), daemon=True).start()
    scr = NSScreen.mainScreen().visibleFrame()
    W, H = int(scr.size.width), int(scr.size.height)
    api = Api()
    window = webview.create_window("MasterPrac", f"http://127.0.0.1:{PORT}/", js_api=api,
                                   width=min(1400, W), height=min(900, H), min_size=(900, 600))
    api.browser = Browser(window)
    window.events.closing += end_session

    def on_start():
        AppHelper.callAfter(lambda: NSApp.activateIgnoringOtherApps_(True))  # open in front
        threading.Thread(target=start_session, args=(api,), daemon=True).start()
        AppHelper.callLater(2.0, watch_browser, api.browser)

        def count_practice():  # time with a song open counts as practice
            import time
            from server import practice_tick
            while True:
                time.sleep(15)
                practice_tick(15)
        threading.Thread(target=count_practice, daemon=True).start()

    try:
        webview.start(on_start)
    finally:
        end_session()


if __name__ == "__main__":
    main()
