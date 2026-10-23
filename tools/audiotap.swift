// audiotap: streams what the Mac is playing as mono 32-bit float samples on stdout, using a Core Audio
// process tap (macOS 14.4+). Audio only: no screen capture, so macOS shows no "screen sharing" notice.
// MasterPrac's listen.py runs it while "Chords by ear" is on and turns the samples into the 12 note strengths.
// Needs the "System Audio Recording" permission (asked for on behalf of MasterPrac).
// Errors go to stderr as "ERR <what> <code>" and the exit code is non-zero.
import AudioToolbox
import CoreAudio
import Foundation

func fail(_ what: String, _ code: OSStatus) -> Never {
    FileHandle.standardError.write("ERR \(what) \(code)\n".data(using: .utf8)!)
    exit(1)
}

func prop<T>(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector, _ value: inout T) -> OSStatus {
    var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
                                          mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<T>.size)
    return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &value)
}

// 1. a private tap on everything the Mac plays, mixed down to mono, never muting it
let tapDesc = CATapDescription(monoGlobalTapButExcludeProcesses: [])
tapDesc.uuid = UUID()
tapDesc.isPrivate = true
tapDesc.muteBehavior = .unmuted
var tapID = AudioObjectID(kAudioObjectUnknown)
var err = AudioHardwareCreateProcessTap(tapDesc, &tapID)
if err != noErr { fail("tap", err) }

// 2. a private aggregate device around the default output, with the tap as its input
var outputID = AudioDeviceID(kAudioObjectUnknown)
err = prop(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice, &outputID)
if err != noErr { fail("output", err) }
var outputUID: CFString = "" as CFString
err = prop(outputID, kAudioDevicePropertyDeviceUID, &outputUID)
if err != noErr { fail("output-uid", err) }

let aggDesc: [String: Any] = [
    kAudioAggregateDeviceNameKey: "MasterPrac ears",
    kAudioAggregateDeviceUIDKey: "masterprac-ears-\(UUID().uuidString)",
    kAudioAggregateDeviceMainSubDeviceKey: outputUID as String,
    kAudioAggregateDeviceIsPrivateKey: true,
    kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID as String]],
    kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true,
                                       kAudioSubTapUIDKey: tapDesc.uuid.uuidString]],
]
var aggID = AudioObjectID(kAudioObjectUnknown)
err = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggID)
if err != noErr { fail("aggregate", err) }

func cleanup() {
    AudioHardwareDestroyAggregateDevice(aggID)
    AudioHardwareDestroyProcessTap(tapID)
}
signal(SIGTERM) { _ in cleanup(); exit(0) }
signal(SIGINT) { _ in cleanup(); exit(0) }
signal(SIGPIPE) { _ in cleanup(); exit(0) }  // MasterPrac stopped reading

// the tap's sample format (float32; mono for a mono tap, but average channels just in case)
var format = AudioStreamBasicDescription()
_ = prop(tapID, kAudioTapPropertyFormat, &format)
let channels = max(1, Int(format.mChannelsPerFrame))
// the samples arrive at the aggregate device's rate (the output's, e.g. 44100), not always the tap's 48000
var deviceRate: Float64 = 0
_ = prop(aggID, kAudioDevicePropertyNominalSampleRate, &deviceRate)
let rate = deviceRate > 0 ? deviceRate : format.mSampleRate
FileHandle.standardError.write("OK \(Int(rate)) Hz \(channels) ch\n".data(using: .utf8)!)

// 3. every buffer: mono floats to stdout
let out = FileHandle.standardOutput
let queue = DispatchQueue(label: "audiotap")
var procID: AudioDeviceIOProcID?
err = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, queue) { _, input, _, _, _ in
    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
    guard let first = buffers.first, let data = first.mData else { return }
    let count = Int(first.mDataByteSize) / MemoryLayout<Float>.size
    let samples = data.assumingMemoryBound(to: Float.self)
    var mono = [Float](repeating: 0, count: count / channels)
    for i in 0..<mono.count {
        var sum: Float = 0
        for c in 0..<channels { sum += samples[i * channels + c] }
        mono[i] = sum / Float(channels)
    }
    mono.withUnsafeBufferPointer { out.write(Data(buffer: $0)) }
}
if err != noErr { cleanup(); fail("ioproc", err) }
err = AudioDeviceStart(aggID, procID)
if err != noErr { cleanup(); fail("start", err) }

dispatchMain()
