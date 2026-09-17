import ExpoModulesCore
import MobileVLCKit

/// One libVLC player per mounted view. libVLC draws straight into this UIView
/// (`drawable`), so there is nothing to bridge for the video itself; only the
/// player state comes back to JS as events.
class VlcPlayerView: ExpoView, VLCMediaPlayerDelegate {
  private let player: VLCMediaPlayer
  private var currentUri: String?
  private var paused = false
  private var muted = true
  private var cover = false

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
    player.drawable = self
    player.delegate = self
  }

  deinit {
    player.delegate = nil
    player.stop()
    player.drawable = nil
  }

  // MARK: - Props

  func setUri(_ uri: String?) {
    guard uri != currentUri else { return }
    currentUri = uri
    player.stop()
    guard let uri, let url = URL(string: uri) else {
      onError(["message": "Invalid stream URL"])
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
    case .playing:
      onBuffering(["isBuffering": false])
      onPlaying([:])
    case .buffering:
      onBuffering(["isBuffering": true])
    case .paused:
      onPaused([:])
    case .stopped, .ended:
      onStopped([:])
    case .error:
      onError(["message": "libVLC could not open the stream"])
    default:
      break
    }
  }
}
