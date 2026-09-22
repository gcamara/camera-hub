import ExpoModulesCore
import MobileVLCKit

/**
 * VLCKit's shared library, the one every player here uses, reads its start-up options from
 * the `VLCParams` user default the first time it is touched, and falls back to the list
 * below when there is none. Setting it replaces that list, so VLCKit 3's own defaults are
 * repeated verbatim and ours appended.
 *
 * `--rtsp-tcp` has to live here: as a per-media `:rtsp-tcp` option it is silently ignored
 * on iOS, so live555 asks for RTP over UDP first. A camera then answers after its UDP
 * timeout (the 15 s waits against the Tapo), and go2rtc refuses UDP outright with 461,
 * after which live555's fallback sets up the audio track but loses the video one — a
 * connected stream with no picture. Android passes the same flag to its libVLC instance.
 */
private let sharedLibraryOptions = [
  "--no-color", "--no-osd", "--no-video-title-show", "--no-snapshot-preview", "--http-reconnect",
  "--text-renderer=freetype", "--avi-index=3", "--audio-resampler=soxr",
  "--rtsp-tcp", "--network-caching=1000", "--live-caching=1000",
]

public class VlcPlayerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VlcPlayer")

    OnCreate {
      // Must run before the first `VLCLibrary.shared()`, which is the next line.
      UserDefaults.standard.set(sharedLibraryOptions, forKey: "VLCParams")
      VLCLibrary.shared().loggers = [VlcLogSink.shared]
    }

    AsyncFunction("getLog") { () -> [String] in
      VlcLogSink.shared.snapshot()
    }

    Function("clearLog") {
      VlcLogSink.shared.clear()
    }

    View(VlcPlayerView.self) {
      Events("onPlaying", "onBuffering", "onError", "onStopped", "onPaused")

      Prop("uri") { (view: VlcPlayerView, uri: String?) in
        view.setUri(uri)
      }

      Prop("muted") { (view: VlcPlayerView, muted: Bool) in
        view.setMuted(muted)
      }

      Prop("paused") { (view: VlcPlayerView, paused: Bool) in
        view.setPaused(paused)
      }

      Prop("contentFit") { (view: VlcPlayerView, contentFit: String) in
        view.setContentFit(contentFit)
      }
    }
  }
}
