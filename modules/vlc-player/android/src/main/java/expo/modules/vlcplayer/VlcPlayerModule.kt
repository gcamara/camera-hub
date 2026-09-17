package expo.modules.vlcplayer

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VlcPlayerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VlcPlayer")

    View(VlcPlayerView::class) {
      Events("onPlaying", "onBuffering", "onError", "onStopped", "onPaused")

      Prop("uri") { view: VlcPlayerView, uri: String? ->
        view.setUri(uri)
      }

      Prop("muted") { view: VlcPlayerView, muted: Boolean ->
        view.setMuted(muted)
      }

      Prop("paused") { view: VlcPlayerView, paused: Boolean ->
        view.setPaused(paused)
      }

      Prop("contentFit") { view: VlcPlayerView, contentFit: String ->
        view.setContentFit(contentFit)
      }
    }
  }
}
