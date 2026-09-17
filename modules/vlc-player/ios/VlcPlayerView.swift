import ExpoModulesCore
import MobileVLCKit

/// One libVLC player per stream. libVLC draws straight into a child UIView
/// (`drawable`), so there is nothing to bridge for the video itself; only the
/// player state comes back to JS as events.
///
/// `VLCMediaPlayer.stop()` is synchronous and waits for the network input to wind
/// down, which can take seconds for a stream that never connected. Every teardown
/// therefore happens on a background queue, and a new URI gets a new player
/// instead of reusing one whose stop would block the main thread.
class VlcPlayerView: ExpoView, VLCMediaPlayerDelegate {
  private static let teardownQueue = DispatchQueue(label: "dev.gcamara.camerahub.vlc-teardown", qos: .utility)

  private var player: VLCMediaPlayer?
  private let videoView = UIView()
  private var currentUri: String?
  private var paused = false
  private var muted = true
  private var cover = false
  /// True once the current media reached buffering/playing. libVLC reports the
  /// `stopped` of a previous media asynchronously, so a stop that arrives before
  /// this flips is stale and must not be surfaced as the stream ending.
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

  private func makePlayer() -> VLCMediaPlayer {
    // TCP interleaving survives Wi-Fi packet loss far better than RTP over UDP,
    // and a one second cache keeps the grid responsive without stuttering.
    let player = VLCMediaPlayer(options: [
      "--rtsp-tcp",
      "--network-caching=1000",
      "--live-caching=1000",
      "--drop-late-frames",
      "--skip-frames",
    ])
    player.drawable = videoView
    player.delegate = self
    return player
  }

  /// Detaches on the main thread, then lets the blocking stop run elsewhere while
  /// the closure keeps the player alive until libVLC is done with it.
  private func tearDown(_ player: VLCMediaPlayer?) {
    guard let player else { return }
    player.delegate = nil
    player.drawable = nil
    Self.teardownQueue.async {
      player.stop()
    }
  }

  // MARK: - Props

  func setUri(_ uri: String?) {
    guard uri != currentUri else { return }
    currentUri = uri
    hasStarted = false
    tearDown(player)
    player = nil
    guard let uri, let url = URL(string: uri) else {
      onError(["message": "Invalid stream URL", "state": "invalid"])
      return
    }
    let next = makePlayer()
    player = next
    next.media = VLCMedia(url: url)
    next.audio?.isMuted = muted
    applyCrop()
    if !paused {
      next.play()
    }
  }

  func setMuted(_ value: Bool) {
    muted = value
    player?.audio?.isMuted = value
  }

  func setPaused(_ value: Bool) {
    paused = value
    guard let player else { return }
    if value {
      if player.isPlaying {
        player.pause()
      }
    } else if player.media != nil && !player.isPlaying {
      player.play()
    }
  }

  func setContentFit(_ value: String) {
    cover = value == "cover"
    applyCrop()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    videoView.frame = bounds
    applyCrop()
  }

  /// "cover" is expressed as a crop to the view's own aspect ratio; libVLC then
  /// scales the cropped picture to fill the drawable. "contain" clears the crop.
  private func applyCrop() {
    guard let player else { return }
    let width = Int(bounds.width.rounded())
    let height = Int(bounds.height.rounded())
    guard cover, width > 0, height > 0 else {
      player.videoCropGeometry = nil
      return
    }
    player.videoCropGeometry = strdup("\(width):\(height)")
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
