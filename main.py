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
import re
import threading
import warnings

warnings.filterwarnings("ignore")
import webview
from AppKit import NSApp, NSMakeRect, NSScreen, NSView, NSViewHeightSizable, NSViewWidthSizable
from Foundation import NSURL, NSURLRequest
from PyObjCTools import AppHelper
import objc
from Foundation import NSObject, NSUUID
from WebKit import WKWebView, WKWebViewConfiguration, WKWebsiteDataStore

def _safari_version():
    """The Safari version installed on this Mac (sites block old/fake versions, e.g. Songsterr refuses 18.0)."""
    import plistlib
    try:
        with open("/Applications/Safari.app/Contents/Info.plist", "rb") as f:
            return plistlib.load(f)["CFBundleShortVersionString"]
    except (OSError, KeyError, ValueError):
        return "26.0"


# look like the real Safari: some sign-ins (Google) refuse "embedded" browsers
SAFARI_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) "
             f"Version/{_safari_version()} Safari/605.1.15")
# one fixed, permanent website-data store for MasterPrac's browser: your Songsterr login (cookies) survives restarts
STORE_ID = "6F0C2B8E-5A1D-4C7B-9E3F-4D2A8B6C1E70"


class FlippedView(NSView):
    """Plain container whose y runs top-down like a web page."""

    def isFlipped(self):
        return True


class PopupDelegate(NSObject, protocols=[objc.protocolNamed("WKUIDelegate")]):
    """Sign-in buttons open a pop-up window (window.open): show it in the same browser instead of dropping it."""

    def webView_createWebViewWithConfiguration_forNavigationAction_windowFeatures_(self, view, cfg, action, features):
        if action.request() is not None:
            view.loadRequest_(action.request())
        return None

import helpers as h
from server import PORT, SESSION, app, log

DRY = "--no-switch" in sys.argv  # development: don't touch Spotify or Bluetooth


class Browser:
    """The built-in Songsterr browser (a native web view inside the app window). Main thread only."""

    def __init__(self, window):
        self.window, self.view, self.last_url = window, None, None

    def _ensure(self):
        if self.view is None:
            self.container = None
            cfg = WKWebViewConfiguration.alloc().init()
            try:  # macOS 14+: a named persistent store just for MasterPrac
                store = WKWebsiteDataStore.dataStoreForIdentifier_(NSUUID.alloc().initWithUUIDString_(STORE_ID))
            except Exception:
                store = WKWebsiteDataStore.defaultDataStore()
            cfg.setWebsiteDataStore_(store)
            cfg.preferences().setJavaScriptCanOpenWindowsAutomatically_(True)
            self.view = WKWebView.alloc().initWithFrame_configuration_(NSMakeRect(0, 0, 10, 10), cfg)
            self.view.setCustomUserAgent_(SAFARI_UA)
            self.popups = PopupDelegate.alloc().init()
            self.view.setUIDelegate_(self.popups)
            print("  browser store persistent:", bool(store.isPersistent()), flush=True)
            self.view.setHidden_(True)
            self._mount()
            self.go(SESSION.get("start_url") or h.SONGSTERR)
        return self.view

    def _mount(self):
        """The window's content is the app's own web view; things added INSIDE a web view can stay invisible on
        new macOS. So a plain container holds the app page and the Songsterr view side by side (Songsterr on top).
        Right after startup the window may put its page back as the content: then this simply mounts again."""
        win = self.window.native
        if self.container is not None and win.contentView() is self.container:
            return
        page = win.contentView()
        content = FlippedView.alloc().initWithFrame_(page.frame())
        content.setAutoresizingMask_(NSViewWidthSizable | NSViewHeightSizable)
        win.setContentView_(content)
        page.setFrame_(content.bounds())
        page.setAutoresizingMask_(NSViewWidthSizable | NSViewHeightSizable)
        content.addSubview_(page)
        self.view.removeFromSuperview()
        content.addSubview_(self.view)
        win.makeFirstResponder_(page)
        self.container, self.page = content, page

    def place(self, x, y, w, hgt):
        """Show the browser over the page's browser area (CSS pixels from the top-left)."""
        v = self._ensure()
        self._mount()
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

    def title(self):
        return str(self.view.title() or "") if self.view is not None else ""

    def checkup(self):
        """For fixing problems: where the browser is, what it shows, and a picture of it (data/checkup.png)."""
        v = self.view
        if v is None:
            print("  checkup: browser not created yet", flush=True)
            return
        f = v.frame()
        print(f"  checkup: hidden={bool(v.isHidden())} frame=({f.origin.x:.0f},{f.origin.y:.0f},{f.size.width:.0f}x{f.size.height:.0f}) "
              f"loading={bool(v.isLoading())} progress={v.estimatedProgress():.2f} url={self.url()} title={self.title()!r}", flush=True)

        content = self.window.native.contentView()
        cf = content.frame()
        print(f"  checkup window: content={cf.size.width:.0f}x{cf.size.height:.0f} flipped={bool(content.isFlipped())} "
              f"visible={bool(self.window.native.isVisible())} subviews(back->front)="
              f"{[type(x).__name__ + ('*' if x is v else '') for x in content.subviews()]}", flush=True)

        def text(result, error):
            print(f"  checkup text: {str(result)[:600]!r} {error or ''}", flush=True)
        v.evaluateJavaScript_completionHandler_(
            "document.readyState+' | links:'+document.links.length+' | '+(document.body?document.body.innerText.slice(0,500):'no body')", text)

        def snap(image, error):
            if image is None:
                print(f"  checkup snapshot failed: {error}", flush=True)
                return
            from AppKit import NSBitmapImageRep, NSBitmapImageFileTypePNG
            rep = NSBitmapImageRep.imageRepWithData_(image.TIFFRepresentation())
            rep.representationUsingType_properties_(NSBitmapImageFileTypePNG, {}).writeToFile_atomically_(str(h.DATA / "checkup.png"), True)
            print("  checkup picture saved", flush=True)
        v.takeSnapshotWithConfiguration_completionHandler_(None, snap)
        self._snap_page()

    def _snap_page(self):
        """The app's own page: run data/page.js in it first (if there), then save data/checkup-page.png."""
        self._mount()
        page = self.page
        js = h.DATA / "page.js"
        if js.exists() and hasattr(page, "evaluateJavaScript_completionHandler_"):
            page.evaluateJavaScript_completionHandler_(js.read_text(), None)

        def later():
            def snap(image, error):
                if image is not None:
                    from AppKit import NSBitmapImageRep, NSBitmapImageFileTypePNG
                    rep = NSBitmapImageRep.imageRepWithData_(image.TIFFRepresentation())
                    rep.representationUsingType_properties_(NSBitmapImageFileTypePNG, {}).writeToFile_atomically_(str(h.DATA / "checkup-page.png"), True)
                    print("  checkup page picture saved", flush=True)
            if hasattr(page, "takeSnapshotWithConfiguration_completionHandler_"):
                page.takeSnapshotWithConfiguration_completionHandler_(None, snap)
            else:
                print(f"  checkup: page is a {type(page).__name__}", flush=True)
        AppHelper.callLater(3.0, later)


class Api:
    """Called from the page (window.pywebview.api.*); UI work hops to the main thread."""

    def __init__(self):
        self._browser = None

    def browser_place(self, x, y, w, hgt):
        AppHelper.callAfter(self._browser.place, float(x), float(y), float(w), float(hgt))

    def browser_hide(self):
        AppHelper.callAfter(self._browser.hide)

    def browser_go(self, url):
        if url.startswith("https://www.songsterr.com"):
            AppHelper.callAfter(self._browser.go, url)

    def browser_search(self, text):
        import urllib.parse
        AppHelper.callAfter(self._browser.go, f"{h.SONGSTERR}/?pattern={urllib.parse.quote(text)}")

    def browser_nav(self, what):
        AppHelper.callAfter({"back": self._browser.back, "forward": self._browser.forward,
                             "reload": self._browser.reload}[what])

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
            AppHelper.callAfter(api._browser.go, song["url"])
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
    if browser.view is not None:
        browser._mount()  # self-repair if the window swapped its page back in
    title = browser.title()
    if title != getattr(browser, "last_title", None):
        browser.last_title = title
        if re.search(r"\b(403|404|forbidden|not found|access denied)\b", title, re.I):
            log(f"Songsterr showed an error page: \"{title}\". Try Reload, or search the song again.")
        else:
            print(f"  page: {title}", flush=True)
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
    api._browser = Browser(window)
    window.events.closing += end_session

    def show_window():
        def front():
            w = window.native
            if w.isMiniaturized():
                w.deminiaturize_(None)
            w.makeKeyAndOrderFront_(None)
            NSApp.activateIgnoringOtherApps_(True)
        AppHelper.callAfter(front)
    import server
    server.SHOW_WINDOW["fn"] = show_window

    def polite_quit(*_):  # macOS / logout / Terminal asking us to stop: tidy up like the close button would
        end_session()
        AppHelper.callAfter(window.destroy)
    import signal
    signal.signal(signal.SIGTERM, polite_quit)
    signal.signal(signal.SIGUSR1, lambda *_: AppHelper.callAfter(api._browser.checkup))
    # for fixing problems: open the address written in data/goto.txt
    signal.signal(signal.SIGUSR2, lambda *_: AppHelper.callAfter(api._browser.go, (h.DATA / "goto.txt").read_text().strip()))

    def on_start():
        AppHelper.callAfter(lambda: NSApp.activateIgnoringOtherApps_(True))  # open in front
        threading.Thread(target=start_session, args=(api,), daemon=True).start()
        AppHelper.callLater(2.0, watch_browser, api._browser)

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
        print("  MasterPrac closed.", flush=True)


if __name__ == "__main__":
    main()
