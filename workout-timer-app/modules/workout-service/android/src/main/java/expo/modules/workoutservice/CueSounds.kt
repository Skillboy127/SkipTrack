package expo.modules.workoutservice

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.os.SystemClock
import android.util.Log

/**
 * The countdown and phase-change beeps, played with SoundPool.
 *
 * SoundPool keeps each sound decoded in memory and starts it with a single call
 * from any thread, so a beep starts with the same short delay every time: no
 * per-play player setup, no hop to the UI thread, no seeking. It never asks for
 * audio focus, so it mixes over the user's music without pausing or ducking it.
 * Sounds play while the screen is off as long as the process is alive, which the
 * workout service guarantees during a workout.
 *
 * Which cue plays, and when, is still decided by the app's timer (TimerCore in
 * JavaScript, exactly once per cue); this only makes the sound.
 */
object CueSounds {
  private const val TAG = "CueSounds"

  private val lock = Any()
  private var pool: SoundPool? = null
  private val ids = mutableMapOf<String, Int>()
  private val loaded = mutableSetOf<Int>()
  private val warmed = mutableSetOf<Int>()

  /** Load both sounds once (safe to call again). */
  fun prepare(context: Context) {
    synchronized(lock) {
      if (pool != null) return
      val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA) // the media volume, like the app's other sounds
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      val soundPool = SoundPool.Builder()
        .setMaxStreams(4)
        .setAudioAttributes(attributes)
        .build()
      soundPool.setOnLoadCompleteListener { sp, sampleId, status ->
        synchronized(lock) {
          if (status != 0) {
            Log.w(TAG, "load failed (status $status)")
            return@setOnLoadCompleteListener
          }
          loaded.add(sampleId)
          // Play once at zero volume so the first real cue doesn't pay the cost of
          // setting up the audio output path.
          if (warmed.add(sampleId)) sp.play(sampleId, 0f, 0f, 0, 0, 1f)
        }
      }
      val app = context.applicationContext
      ids["beep"] = soundPool.load(app, R.raw.cue_beep, 1)
      ids["go"] = soundPool.load(app, R.raw.cue_go, 1)
      pool = soundPool
    }
  }

  /**
   * Play a cue now. Returns the elapsed-realtime clock at the moment it was handed
   * to the audio system, or -1 if it couldn't be played (not loaded yet, unknown name).
   */
  fun play(name: String): Double {
    synchronized(lock) {
      val soundPool = pool ?: run {
        Log.w(TAG, "play '$name': not prepared")
        return -1.0
      }
      val id = ids[name] ?: run {
        Log.w(TAG, "play: unknown cue '$name'")
        return -1.0
      }
      if (id !in loaded) {
        Log.w(TAG, "play '$name': not loaded yet")
        return -1.0
      }
      if (soundPool.play(id, 1f, 1f, 1, 0, 1f) == 0) {
        Log.w(TAG, "play '$name': no stream")
        return -1.0
      }
      return SystemClock.elapsedRealtime().toDouble()
    }
  }
}
