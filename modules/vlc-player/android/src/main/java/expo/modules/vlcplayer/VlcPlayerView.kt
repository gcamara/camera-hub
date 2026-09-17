package expo.modules.vlcplayer

import android.content.Context
import android.graphics.Color
import android.net.Uri
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.ReactPointerEventsView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.util.VLCVideoLayout
import java.util.concurrent.Executors

/**
 * Android twin of the iOS view: one libVLC player per stream drawing into a
 * TextureView (so the grid's rounded corners and the cover crop apply), the same
 * props and events. Once play() has been called, libVLC control calls (volume,
 * scale, stop) wait for the input thread and can block for seconds while a stream
 * is connecting, so scale is applied before play(), audio is dropped at the source
 * for muted views, and every later change or teardown runs on a background executor.
 *
 * Touches resolve to this view rather than libVLC's untagged TextureView
 * (`BOX_ONLY`), otherwise React Native finds no target and the Pressable above
 * never fires.
 */
class VlcPlayerView(context: Context, appContext: AppContext) : ExpoView(context, appContext), ReactPointerEventsView {
  private val onPlaying by EventDispatcher()
  private val onBuffering by EventDispatcher()
  private val onError by EventDispatcher()
  private val onStopped by EventDispatcher()
  private val onPaused by EventDispatcher()

  private val videoLayout = VLCVideoLayout(context)
  private var libVlc: LibVLC? = null
  private var player: MediaPlayer? = null
  private var currentUri: String? = null
  private var paused = false
  private var muted = true
  private var cover = false
  private var started = false
  private var startedMuted = true
  private var hasStarted = false
  private var lastState: String? = null

  override val shouldUseAndroidLayout = true

  init {
    setBackgroundColor(Color.BLACK)
    addView(videoLayout, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  override val pointerEvents: PointerEvents = PointerEvents.BOX_ONLY

  // Props

  fun setUri(uri: String?) {
    if (uri == currentUri) return
    currentUri = uri
    restart()
  }

  fun setMuted(value: Boolean) {
    if (value == muted) return
    muted = value
    val current = player ?: return
    if (!started) return
    if (value) {
      controlExecutor.execute { current.setVolume(0) }
    } else if (startedMuted) {
      restart()
    } else {
      controlExecutor.execute { current.setVolume(100) }
    }
  }

  fun setPaused(value: Boolean) {
    paused = value
    val current = player ?: return
    if (!started) {
      startIfReady()
      return
    }
    controlExecutor.execute {
      if (value) {
        if (current.isPlaying) current.pause()
      } else if (!current.isPlaying) {
        current.play()
      }
    }
  }

  fun setContentFit(value: String) {
    cover = value == "cover"
    val current = player ?: return
    val scale = scaleType()
    if (started) controlExecutor.execute { current.videoScale = scale } else current.videoScale = scale
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    startIfReady()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    currentUri = null
    tearDown()
  }

  // Playback

  private fun restart() {
    tearDown()
    started = false
    hasStarted = false
    lastState = null
    val uri = currentUri ?: return
    if (!uri.startsWith("rtsp", ignoreCase = true)) {
      onError(mapOf("message" to "Invalid stream URL", "state" to "invalid"))
      return
    }
    val lib = LibVLC(context, arrayListOf("--rtsp-tcp", "--network-caching=1000", "--live-caching=1000"))
    val next = MediaPlayer(lib)
    val media = Media(lib, Uri.parse(uri))
    media.setHWDecoderEnabled(true, false)
    if (muted) media.addOption(":no-audio")
    next.media = media
    media.release()
    next.setEventListener { event -> handleEvent(next, event) }
    startedMuted = muted
    libVlc = lib
    player = next
    startIfReady()
  }

  private fun startIfReady() {
    val current = player ?: return
    if (started || paused || width == 0 || height == 0) return
    started = true
    current.attachViews(videoLayout, null, false, true)
    current.videoScale = scaleType()
    current.play()
  }

  private fun scaleType() = if (cover) MediaPlayer.ScaleType.SURFACE_FILL else MediaPlayer.ScaleType.SURFACE_BEST_FIT

  private fun tearDown() {
    val oldPlayer = player ?: return
    val oldLib = libVlc
    player = null
    libVlc = null
    oldPlayer.setEventListener(null)
    if (started) oldPlayer.detachViews()
    controlExecutor.execute {
      oldPlayer.stop()
      oldPlayer.release()
      oldLib?.release()
    }
  }

  // libVLC events (delivered on the main thread)

  private fun handleEvent(source: MediaPlayer, event: MediaPlayer.Event) {
    if (source !== player) return
    when (event.type) {
      MediaPlayer.Event.Opening -> buffering(true, "opening")
      MediaPlayer.Event.Buffering -> {
        hasStarted = true
        if (event.buffering < 100f) buffering(true, "buffering")
      }
      MediaPlayer.Event.Playing -> {
        hasStarted = true
        buffering(false, "playing")
        onPlaying(emptyMap())
      }
      MediaPlayer.Event.Paused -> onPaused(emptyMap())
      MediaPlayer.Event.Stopped, MediaPlayer.Event.EndReached -> {
        if (hasStarted) {
          onStopped(mapOf("state" to if (event.type == MediaPlayer.Event.EndReached) "ended" else "stopped"))
        }
      }
      MediaPlayer.Event.EncounteredError -> onError(mapOf("message" to "libVLC could not open the stream", "state" to "error"))
    }
  }

  /** libVLC repeats Buffering with every percentage; JS only needs transitions. */
  private fun buffering(isBuffering: Boolean, state: String) {
    if (lastState == state) return
    lastState = state
    onBuffering(mapOf("isBuffering" to isBuffering, "state" to state))
  }

  companion object {
    private val controlExecutor = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "vlc-control").apply { isDaemon = true }
    }
  }
}
