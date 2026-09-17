import ExpoModulesCore
import MobileVLCKit

/// One libVLC player per mounted view. libVLC draws straight into a child UIView
/// (`drawable`), so there is nothing to bridge for the video itself; only the
/// player state comes back to JS as events.
class VlcPlayerView: ExpoView, VLCMediaPlayerDelegate {
  private let player: VLCMediaPlayer
  private let videoView = UIView()
  private var currentUri: String?
  private var paused = false
  private var muted = true
  private var cover = false
  /// True once the current media reached buffering/playing. libVLC reports the
  /// `stopped` of the previous media asynchronously, so a stop that arrives before
  /// this flips is stale and must not be surfaced as the stream ending.
  private var hasStarted = false

  let onPlaying = EventDispatcher()
  let onBuffering = EventDispatcher()
  let onError = EventDispatcher()
  let onStopped = EventDispatcher()
  let onPaused = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    // TCP interleaving survives Wi-Fi packet loss far better than RTP over UDP,
    // and a one second cache keeps the grid responsive without stuttering.
    player = VLCMediaPlayer(options: [
      "--rtsp-tcp",
      "--network-caching=1000",
      "--live-caching=1000",
      "--drop-late-frames",
      "--skip-frames",
    ])
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true
    videoView.backgroundColor = .black
    videoView.frame = bounds
    videoView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(videoView)
    player.drawable = videoView
    player.delegate = self
  }

  deinit {
    player.delegate = nil
    if player.media != nil {
      player.stop()
    }
    player.drawable = nil
  }

  // MARK: - Props

  func setUri(_ uri: String?) {
    guard uri != currentUri else { return }
    currentUri = uri
    hasStarted = false
    if player.media != nil {
      player.stop()
    }
    guard let uri, let url = URL(string: uri) else {
      onError(["message": "Invalid stream URL", "state": "invalid"])
      return
    }
    player.media = VLCMedia(url: url)
    player.audio?.isMuted = muted
    if !paused {
      player.play()
    }
  }

  func setMuted(_ value: Bool) {
    muted = value
    player.audio?.isMuted = value
  }

  func setPaused(_ value: Bool) {
    paused = value
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
