package expo.modules.vlcplayer

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.InputStreamReader

class VlcPlayerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VlcPlayer")

    /** libVLC on Android logs straight to logcat; this reads its recent lines back for the in-app panel. */
    AsyncFunction("getLog") { ->
      val process = ProcessBuilder("logcat", "-d", "-v", "time", "-t", "400", "VLC:*", "VLC-std:*", "*:S").start()
      BufferedReader(InputStreamReader(process.inputStream)).useLines { lines ->
        lines.filter { it.isNotBlank() && !it.startsWith("---") }.toList()
      }
    }

    Function("clearLog") {
      ProcessBuilder("logcat", "-c").start().waitFor()
    }

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
