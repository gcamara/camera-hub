import ExpoModulesCore

public class VlcPlayerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VlcPlayer")

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
