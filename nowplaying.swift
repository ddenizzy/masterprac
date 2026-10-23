// What's playing on this Mac in ANY app (Spotify, Music, YouTube in a browser...): macOS's "Now Playing".
// macOS only lets Apple-signed programs read it, so this is a tiny library that Apple's own /usr/bin/perl
// loads (see nowplaying.pl). Prints one line of JSON.
import AppKit
import Foundation

typealias InfoFn = @convention(c) (DispatchQueue, @escaping ([String: Any]) -> Void) -> Void
typealias PidFn = @convention(c) (DispatchQueue, @escaping (Int32) -> Void) -> Void

@_cdecl("np_get")
public func np_get() {
  guard let h = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW),
        let fi = dlsym(h, "MRMediaRemoteGetNowPlayingInfo"), let fp = dlsym(h, "MRMediaRemoteGetNowPlayingApplicationPID")
  else { print("{\"error\":\"MediaRemote unavailable\"}"); return }
  var out: [String: Any] = [:]
  let sem = DispatchSemaphore(value: 0)
  unsafeBitCast(fi, to: InfoFn.self)(DispatchQueue.global()) { info in
    let k = "kMRMediaRemoteNowPlayingInfo"
    out["title"] = info[k + "Title"] as? String ?? ""
    out["artist"] = info[k + "Artist"] as? String ?? ""
    out["album"] = info[k + "Album"] as? String ?? ""
    out["elapsed"] = info[k + "ElapsedTime"] as? Double ?? 0
    out["duration"] = info[k + "Duration"] as? Double ?? 0
    out["rate"] = info[k + "PlaybackRate"] as? Double ?? 0
    out["timestamp"] = (info[k + "Timestamp"] as? Date)?.timeIntervalSince1970 ?? Date().timeIntervalSince1970
    sem.signal()
  }
  _ = sem.wait(timeout: .now() + 2)
  unsafeBitCast(fp, to: PidFn.self)(DispatchQueue.global()) { pid in
    out["app"] = NSRunningApplication(processIdentifier: pid)?.localizedName ?? ""
    sem.signal()
  }
  _ = sem.wait(timeout: .now() + 2)
  out["now"] = Date().timeIntervalSince1970
  if let d = try? JSONSerialization.data(withJSONObject: out), let s = String(data: d, encoding: .utf8) { print(s) }
}
