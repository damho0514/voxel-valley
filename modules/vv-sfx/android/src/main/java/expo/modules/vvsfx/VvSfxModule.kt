package expo.modules.vvsfx

import android.media.AudioAttributes
import android.media.SoundPool
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap

/**
 * Game sound effects through SoundPool.
 *
 * expo-audio's play() waits for the UI thread (runBlocking on the main queue), which stalled the
 * game's JS thread 30–80 ms per sound while breaking blocks. SoundPool is made for this: sounds are
 * decoded once up front, play() is thread-safe and returns at once, and up to MAX_STREAMS overlap.
 */
class VvSfxModule : Module() {
  private var pool: SoundPool? = null
  private val lock = Any()
  /** Sound id → its load promise, resolved when SoundPool has decoded it. */
  private val pending = HashMap<Int, Promise>()
  /** Sound id → load status, for loads that finished before their promise was registered. */
  private val finished = HashMap<Int, Int>()
  private val ready = ConcurrentHashMap.newKeySet<Int>()

  private fun soundPool(): SoundPool {
    pool?.let { return it }
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_GAME)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val made = SoundPool.Builder().setMaxStreams(MAX_STREAMS).setAudioAttributes(attrs).build()
    made.setOnLoadCompleteListener { _, id, status ->
      synchronized(lock) {
        if (status == 0) ready.add(id)
        val promise = pending.remove(id)
        if (promise != null) promise.resolve(if (status == 0) id else 0) else finished[id] = status
      }
    }
    pool = made
    return made
  }

  override fun definition() = ModuleDefinition {
    Name("VvSfx")

    OnDestroy {
      pool?.release()
      pool = null
      ready.clear()
    }

    /** Decodes a local file (file:// URI or path); resolves with an id for play(), or 0 on failure. */
    AsyncFunction("load") { uri: String, promise: Promise ->
      val path = if (uri.startsWith("file://")) Uri.parse(uri).path ?: uri else uri
      synchronized(lock) {
        val id = soundPool().load(path, 1)
        val status = finished.remove(id)
        when {
          id == 0 -> promise.resolve(0)
          status != null -> promise.resolve(if (status == 0) id else 0)
          else -> pending[id] = promise
        }
      }
    }

    /** Starts a sound; never blocks. Returns false if it isn't loaded (yet). */
    Function("play") { id: Int, volume: Double ->
      val p = pool ?: return@Function false
      if (!ready.contains(id)) return@Function false
      val v = volume.toFloat().coerceIn(0f, 1f)
      p.play(id, v, v, 1, 0, 1f) != 0
    }
  }

  companion object {
    private const val MAX_STREAMS = 12
  }
}
