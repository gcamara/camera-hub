import ExpoModulesCore
import MobileVLCKit

/// One libVLC player per stream, all on the shared VLCLibrary: VLCKit does not
/// support several library instances, and a media created on the shared library
/// must not be played by a player on a private one. Stream options travel as
/// media options. libVLC draws straight into a child UIView; only the player
/// state comes back to JS as events.
///
/// Three libVLC facts shape this class.
///
/// Once `play()` has been called, every control call goes through `input_Control`,
/// which blocks until the input thread gets to it (seconds while a stream is still
/// connecting), so nothing is sent to libVLC from the main thread after `play()`;
/// later changes go through a serial control queue.
///
/// libVLC's iOS video output creates and removes its GL view on the main thread,
/// with the video-output thread waiting for it. Deallocating a `VLCMediaPlayer`
/// joins that thread (`libvlc_media_player_destroy`), so a player that dies on the
/// main thread deadlocks the app: the main thread waits for the video output, the
/// video output waits for the main thread (build 10's watchdog crash log has exactly
/// this stack). VLCKit itself holds players on the main thread for a moment after
/// every event it delivers there, so this view keeps its own reference alive until
/// the stop has completed and those moments have passed, and drops it off-main.
///
/// `stop()` is asynchronous in VLCKit 3 (`libvlc_media_player_stop_async`), so
/// "completed" means the player reports stopped, not that `stop()` returned.
class VlcPlayerView: ExpoView, VLCMediaPlayerDelegate {
  private static let controlQueue = DispatchQueue(label: "dev.gcamara.camerahub.vlc-control", qos: .userInitiated)
  /// Concurrent: each teardown waits for its own player, without holding the others up.
  private static let teardownQueue = DispatchQueue(label: "dev.gcamara.camerahub.vlc-teardown", qos: .utility, attributes: .concurrent)
  /// Non-empty while a player still holds an RTSP session the camera has not taken back.
  private static let sessionGate = DispatchGroup()

  private var player: VLCMediaPlayer?
  private let videoView = UIView()
  private var currentUri: String?
  private var paused = false
  private var muted = true
  private var cover = false
  private var started = false
  private var startedMuted = true
  private var appliedCrop: String?
  /// True once the current media reached buffering/playing; a `stopped` before
  /// that is the previous media's and must not be surfaced.
  private var hasStarted = false

  let onPlaying = EventDispatcher()
  let onBuffering = EventDispatcher()
  let onError = EventDispatcher()
  let onStopped = EventDispatcher()
  let onPaused = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true
    videoView.backgroundColor = .black
    videoView.frame = bounds
    videoView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(videoView)
  }

  deinit {
    tearDown(player)
  }

  // MARK: - Props

  func setUri(_ uri: String?) {
    guard uri != currentUri else { return }
    currentUri = uri
    restart()
  }

  func setMuted(_ value: Bool) {
    guard value != muted else { return }
    muted = value
    guard let player, started else { return }
    if value {
      Self.controlQueue.async { player.audio?.isMuted = true }
    } else if startedMuted {
      // Audio was left out of the stream entirely; bring it back with a fresh start.
      restart()
    } else {
      Self.controlQueue.async { player.audio?.isMuted = false }
    }
  }

  func setPaused(_ value: Bool) {
    paused = value
    guard let player else { return }
    if !started {
      startIfReady()
      return
    }
    Self.controlQueue.async {
      if value {
        if player.isPlaying { player.pause() }
      } else if !player.isPlaying {
        player.play()
      }
    }
  }

  func setContentFit(_ value: String) {
    cover = value == "cover"
    applyCrop()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    videoView.frame = bounds
    if started {
      applyCrop()
    } else {
      startIfReady()
    }
  }

  // MARK: - Playback

  private func restart() {
    tearDown(player)
    player = nil
    started = false
    hasStarted = false
    appliedCrop = nil
    guard let uri = currentUri, let url = URL(string: uri) else {
      if currentUri != nil {
        onError(["message": "Invalid stream URL", "state": "invalid"])
      }
      return
    }
    note("restart \(Self.describe(uri)) muted=\(muted) paused=\(paused) \(Int(bounds.width))x\(Int(bounds.height))")
    let media = VLCMedia(url: url)
    // RTSP over TCP and the one second cache are set on the shared library itself (see
    // VlcPlayerModule): as media options VLCKit ignores `:rtsp-tcp`. Only what differs
    // per view belongs here. Muted views drop audio at the source: mute/volume calls
    // before play() are no-ops in libVLC because the audio output does not exist yet.
    var options: [String] = []
    if muted {
      options.append(":no-audio")
    }
    for option in options {
      media.addOption(option)
    }
    startedMuted = muted
    let next = VLCMediaPlayer()
    next.media = media
    next.drawable = videoView
    next.delegate = self
    player = next
    startIfReady()
  }

  /// Plays once the view has a size: the cover crop needs it, and applying it
  /// before `play()` keeps it off the blocking control path.
  ///
  /// Waits first for every player that is still giving a session back. Cameras
  /// allow very few concurrent RTSP sessions — a Tapo C200 starts refusing SETUP
  /// and PLAY outright — and React Native builds the next screen's view before it
  /// destroys the previous screen's, so the grid tile and the viewer would
  /// otherwise ask for a session at the same time on every tap.
  private func startIfReady() {
    guard let player, !started, !paused, bounds.width > 0, bounds.height > 0 else { return }
    started = true
    let crop = cropGeometry()
    appliedCrop = crop
    player.videoCropGeometry = crop.flatMap { strdup($0) }
    Self.sessionGate.notify(queue: .main) { [weak self] in
      guard let self, self.player === player else { return }
      self.note("play \(Self.describe(self.currentUri)) crop=\(crop ?? "none") \(Int(self.bounds.width))x\(Int(self.bounds.height))")
      player.play()
    }
  }

  private func cropGeometry() -> String? {
    let width = Int(bounds.width.rounded())
    let height = Int(bounds.height.rounded())
    guard cover, width > 0, height > 0 else { return nil }
    return "\(width):\(height)"
  }

  /// "cover" is a crop to the view's own aspect ratio, which libVLC then scales to
  /// fill the drawable; "contain" is no crop. Only real changes reach libVLC.
  private func applyCrop() {
    guard let player, started else { return }
    let crop = cropGeometry()
    guard crop != appliedCrop else { return }
    appliedCrop = crop
    Self.controlQueue.async { player.videoCropGeometry = crop.flatMap { strdup($0) } }
  }

  /// Detaches the delegate on the main thread; everything else happens off it.
  /// `drawable = nil` is a `dispatch_sync` onto the player's private queue in
  /// VLCKit, which may be busy with `play()`, so even that stays off the main
  /// thread. The closure is the reference that outlives VLCKit's, and it is
  /// released where it ran: on the teardown queue.
  private func tearDown(_ player: VLCMediaPlayer?) {
    guard let player else { return }
    note("tearDown started=\(started) state=\(Self.name(of: player.state))")
    player.delegate = nil
    let held = started
    if held { Self.sessionGate.enter() }
    Self.teardownQueue.async {
      let startedAt = Date()
      player.drawable = nil
      player.stop()
      while Date().timeIntervalSince(startedAt) < 8 && !Self.isStopped(player.state) {
        Thread.sleep(forTimeInterval: 0.05)
      }
      let stopped = Self.isStopped(player.state)
      // The camera has the session back now; the next stream may start.
      if held {
        let seconds = String(format: "%.1f", Date().timeIntervalSince(startedAt))
        VlcLogSink.shared.note("session freed after \(seconds)s\(stopped ? "" : " (stop timed out)")")
        Self.sessionGate.leave()
      }
      // The stopped event was just delivered on the main thread inside blocks and an
      // autoreleased notification that both hold the player; let that run loop
      // iteration end before this reference becomes the last one.
      Thread.sleep(forTimeInterval: 1)
      withExtendedLifetime(player) {}
    }
  }

  private static func isStopped(_ state: VLCMediaPlayerState) -> Bool {
    switch state {
    case .stopped, .ended, .error:
      return true
    default:
      return false
    }
  }

  // MARK: - Diagnostics

  private func note(_ message: String) {
    let id = String(UInt(bitPattern: ObjectIdentifier(self).hashValue) & 0xffff, radix: 16)
    VlcLogSink.shared.note("[\(id)] \(message)")
  }

  private static func name(of state: VLCMediaPlayerState) -> String {
    switch state {
    case .stopped: return "stopped"
    case .opening: return "opening"
    case .buffering: return "buffering"
    case .ended: return "ended"
    case .error: return "error"
    case .playing: return "playing"
    case .paused: return "paused"
    case .esAdded: return "esAdded"
    @unknown default: return "state \(state.rawValue)"
    }
  }

  /// The URL without its credentials, so the log can be shared.
  private static func describe(_ uri: String?) -> String {
    guard let uri else { return "nil" }
    return uri.replacingOccurrences(of: "//[^@/]+@", with: "//***@", options: .regularExpression)
  }

  // MARK: - VLCMediaPlayerDelegate

  func mediaPlayerStateChanged(_ aNotification: Notification) {
    guard let player else { return }
    note("state \(Self.name(of: player.state))")
    switch player.state {
    case .opening:
      onBuffering(["isBuffering": true, "state": "opening"])
    case .buffering:
      hasStarted = true
      onBuffering(["isBuffering": true, "state": "buffering"])
    case .playing:
      hasStarted = true
      onBuffering(["isBuffering": false, "state": "playing"])
      onPlaying([:])
    case .esAdded:
      // Not a state to show, but proof the handshake is still moving: a camera that
      // is out of RTSP sessions answers each request only as an old one expires.
      onBuffering(["isBuffering": true, "state": "esAdded"])
    case .paused:
      onPaused([:])
    case .stopped, .ended:
      if hasStarted {
        onStopped(["state": player.state == .ended ? "ended" : "stopped"])
      }
    case .error:
      onError(["message": "libVLC could not open the stream", "state": "error"])
    default:
      break
    }
  }
}
