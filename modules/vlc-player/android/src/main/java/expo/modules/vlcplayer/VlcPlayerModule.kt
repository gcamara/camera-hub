package expo.modules.vlcplayer

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.InputStreamReader

class VlcPlayerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VlcPlayer")

    /**
     * libVLC on Android logs straight to logcat; this reads its recent lines back for the
     * in-app panel, together with the view's own lifecycle lines. Fontconfig complains
     * on every start and says nothing about the stream, and a decoder that cannot keep
     * up logs a late-picture warning per frame, so runs of those collapse into one line.
     */
    AsyncFunction("getLog") { ->
      val process = ProcessBuilder(
        "logcat", "-d", "-v", "time", "-t", "1000", "VLC:*", "VLC-std:*", "${VlcPlayerView.TAG}:*", "*:S",
      ).start()
      BufferedReader(InputStreamReader(process.inputStream)).useLines { lines ->
        collapseLateFrames(lines.filter { it.isNotBlank() && !it.startsWith("---") && !it.contains("Fontconfig") })
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

      OnViewDestroys { view: VlcPlayerView ->
        view.dispose()
      }
    }
  }

  private companion object {
    val LATE_FRAME = Regex("""^(\S+ \S+) .*picture is too late to be displayed \(missing (\d+) ms\)""")

    /** Replaces each run of "picture is too late" lines with one line carrying the count and the worst delay. */
    fun collapseLateFrames(lines: Sequence<String>): List<String> {
      val out = mutableListOf<String>()
      var runCount = 0
      var runStamp = ""
      var runWorst = 0
      fun flush() {
        if (runCount > 0) out += "$runStamp libvlc video output: $runCount pictures too late to be displayed (up to $runWorst ms behind)"
        runCount = 0
        runWorst = 0
      }
      for (line in lines) {
        val match = LATE_FRAME.find(line)
        if (match == null) {
          flush()
          out += line
          continue
        }
        if (runCount == 0) runStamp = match.groupValues[1]
        runCount += 1
        runWorst = maxOf(runWorst, match.groupValues[2].toInt())
      }
      flush()
      return out
    }
  }
}
