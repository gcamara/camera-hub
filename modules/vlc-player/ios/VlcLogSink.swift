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
    let module = context?.module ?? "vlc"
    let line = "\(clock.string(from: Date())) \(tag) \(module): \(message)"
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
