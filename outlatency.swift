// outlatency: how long the current speakers/headphones take to actually play a sound (seconds), e.g. ~0.24 s for
// Bluetooth speakers, ~0.01 s for the Mac's own. MasterPrac hears the music before it reaches the speakers,
// so it shows the tab this much later to match what you hear.
import CoreAudio
import Foundation
func get<T>(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope, _ v: inout T) -> OSStatus {
    var a = AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<T>.size); return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v)
}
var dev = AudioDeviceID(0)
_ = get(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, &dev)
var rate: Float64 = 0; _ = get(dev, kAudioDevicePropertyNominalSampleRate, kAudioObjectPropertyScopeGlobal, &rate)
var lat: UInt32 = 0; _ = get(dev, kAudioDevicePropertyLatency, kAudioObjectPropertyScopeOutput, &lat)
var safety: UInt32 = 0; _ = get(dev, kAudioDevicePropertySafetyOffset, kAudioObjectPropertyScopeOutput, &safety)
var buf: UInt32 = 0; _ = get(dev, kAudioDevicePropertyBufferFrameSize, kAudioObjectPropertyScopeGlobal, &buf)
var a = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioObjectPropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
var size: UInt32 = 0; AudioObjectGetPropertyDataSize(dev, &a, 0, nil, &size)
var streams = [AudioStreamID](repeating: 0, count: Int(size) / MemoryLayout<AudioStreamID>.size)
AudioObjectGetPropertyData(dev, &a, 0, nil, &size, &streams)
var slat: UInt32 = 0; if let s = streams.first { _ = get(s, kAudioStreamPropertyLatency, kAudioObjectPropertyScopeGlobal, &slat) }
let total = Double(lat + safety + buf + slat) / rate
print(String(format: "%.3f", total))
