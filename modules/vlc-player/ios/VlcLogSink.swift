import Foundation
import MobileVLCKit

/// Keeps the last few hundred libVLC log lines in memory so a failing stream on a
/// device without a debugger can still be diagnosed from inside the app.
final class VlcLogSink: NSObject, VLCLogging {
  static let shared = VlcLogSink()
  private static let capacity = 400

  var level: VLCLogLevel = .debug

  private let lock = NSLock()
  private var lines: [String] = []
  private let clock: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm:ss.SSS"
    return formatter
  }()

  func handleMessage(_ message: String, logLevel level: VLCLogLevel, context: VLCLogContext?) {
    let tag: String
    switch level {
    case .error: tag = "E"
    case .warning: tag = "W"
    case .info: tag = "I"
    default: tag = "D"
    }
    append("\(tag) \(context?.module ?? "vlc"): \(Self.redact(message))")
  }

  /**
   * libVLC prints the stream URL, credentials included, in several of its own lines and in
   * three shapes — `rtsp://user:pass@`, `` path `user:pass@ `` and `location='user:pass@` —
   * and this log is meant to be shared. Any `user:password@` is masked on the way in,
   * whoever wrote the line, without depending on what precedes it.
   */
  static func redact(_ text: String) -> String {
    text.replacingOccurrences(of: "[^\\s'`\"/@:]+:[^\\s'`\"/@]+@", with: "***@", options: .regularExpression)
  }

  /// The player view's own lifecycle, in the same log as libVLC's lines.
  func note(_ message: String) {
    append("V view: \(message)")
  }

  private func append(_ text: String) {
    let line = "\(clock.string(from: Date())) \(text)"
    lock.lock()
    lines.append(line)
    if lines.count > Self.capacity {
      lines.removeFirst(lines.count - Self.capacity)
    }
    lock.unlock()
  }

  func snapshot() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    return lines
  }

  func clear() {
    lock.lock()
    lines.removeAll()
    lock.unlock()
  }
}
