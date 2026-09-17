import ExpoModulesCore
import MobileVLCKit

/// One libVLC player per stream. libVLC draws straight into a child UIView
/// (`drawable`), so there is nothing to bridge for the video itself; only the
/// player state comes back to JS as events.
///
/// Two libVLC facts shape this class. `stop()` is synchronous and waits for the
/// network input to wind down, so teardown runs on a background queue. And once
/// `play()` has been called, every control call (crop, mute, volume) goes through
/// `input_Control`, which blocks the caller until the input thread gets to it —
/// while a stream is still connecting that can be seconds, and libVLC's iOS video
/// output needs the main thread to create its view, so a control call from the main
/// thread during connection deadlocks the picture. Before `play()` the same calls
/// are cheap, so crop and mute are applied then, and every later change is sent
/// from the background queue.
class VlcPlayerView: ExpoView, VLCMediaPlayerDelegate {
  private static let controlQueue = DispatchQueue(label: "dev.gcamara.camerahub.vlc-control", qos: .userInitiated)

  private var player: VLCMediaPlayer?
  private let videoView = UIView()
  private var currentUri: String?
  private var paused = false
  private var muted = true
  private var cover = false
  private var started = false
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
    tearDown(player)
    player = nil
    started = false
    hasStarted = false
    appliedCrop = nil
    guard let uri, let url = URL(string: uri) else {
      if uri != nil {
        onError(["message": "Invalid stream URL", "state": "invalid"])
      }
      return
    }
    // TCP interleaving survives Wi-Fi packet loss far better than RTP over UDP,
    // and a one second cache keeps the grid responsive without stuttering.
    let next = VLCMediaPlayer(options: [
      "--rtsp-tcp",
      "--network-caching=1000",
      "--live-caching=1000",
    ])
    next.media = VLCMedia(url: url)
    next.drawable = videoView
    next.delegate = self
    player = next
    startIfReady()
  }

  func setMuted(_ value: Bool) {
    muted = value
    guard let player else { return }
    if started {
      Self.controlQueue.async { player.audio?.isMuted = value }
    } else {
      player.audio?.isMuted = value
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

  /// Plays once the view has a size: the cover crop needs it, and applying crop and
  /// mute before `play()` keeps them off the blocking control path.
  private func startIfReady() {
    guard let player, !started, !paused, bounds.width > 0, bounds.height > 0 else { return }
    started = true
    player.audio?.isMuted = muted
    let crop = cropGeometry()
    appliedCrop = crop
    player.videoCropGeometry = crop.flatMap { strdup($0) }
    player.play()
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

  /// Detaches on the main thread, then lets the blocking stop run elsewhere while
  /// the closure keeps the player alive until libVLC is done with it.
  private func tearDown(_ player: VLCMediaPlayer?) {
    guard let player else { return }
    player.delegate = nil
    player.drawable = nil
    Self.controlQueue.async {
      player.stop()
    }
  }

  // MARK: - VLCMediaPlayerDelegate

  func mediaPlayerStateChanged(_ aNotification: Notification) {
    guard let player else { return }
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
