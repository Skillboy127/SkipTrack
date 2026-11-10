package expo.modules.workoutservice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import android.util.Log
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The pre-mixed "3, 2, 1, go" countdown clip (res/raw/countdown_321_go.wav, 3320ms),
 * played natively at an exact moment. The "go" is the phase-end beep, so the
 * clip is played whole and the phase end needs no separate beep.
 *
 * JavaScript decides *which* countdown should sound and from which beep (see
 * src/audio/countdownClip.ts) and arms it here with a start time on the
 * elapsed-realtime clock; this schedules the start on its own audio-priority
 * thread, so it doesn't depend on JavaScript timers and keeps working with the
 * screen off (the workout service keeps the process and CPU awake).
 *
 * A static AudioTrack holds the decoded clip in memory, so it can start at any
 * offset (a countdown resumed mid-way starts at the next beep) and stop at once.
 * It never requests audio focus, so it mixes over the user's music.
 *
 * Exactly once: each countdown has an `anchor` (the moment the clip's first sample
 * should play). Arming an anchor that is already scheduled or playing does nothing.
 * Arming a different one drops a start that hasn't happened yet but does NOT stop a
 * clip that is sounding: when a phase ends on its own, the next segment is armed at
 * the very moment the old clip plays its "go", which must be left to finish. Stopping
 * a clip is cancel()'s job, which the app calls whenever a countdown is abandoned.
 */
object CountdownClip {
  private const val TAG = "CountdownClip"

  private val thread = HandlerThread("flex-countdown", Process.THREAD_PRIORITY_URGENT_AUDIO).apply { start() }
  private val handler = Handler(thread.looper)

  private var track: AudioTrack? = null
  private var sampleRate = 0
  private var totalFrames = 0
  private var startRunnable: Runnable? = null
  private var finishRunnable: Runnable? = null
  /** Bumped on every start, so a stale finish timer can tell it no longer applies. */
  private var playGeneration = 0

  /** The countdown that is scheduled or playing, for exactly-once. Written on the handler thread. */
  @Volatile private var armedAnchor: Long = -1

  /** Decode the clip into a static AudioTrack (once; safe to call again). */
  fun prepare(context: Context) {
    handler.post {
      if (track != null) return@post
      try {
        val bytes = context.applicationContext.resources.openRawResource(R.raw.countdown_321_go).use { it.readBytes() }
        val wav = parseWav(bytes)
        sampleRate = wav.sampleRate
        val bytesPerFrame = wav.channels * 2
        // The whole file: "3", "2", "1" and the "go" that is the phase-end beep.
        totalFrames = wav.frames
        val pcm = ByteArray(wav.frames * bytesPerFrame)
        System.arraycopy(bytes, wav.dataOffset, pcm, 0, pcm.size)

        val attributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
        val format = AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(wav.sampleRate)
          .setChannelMask(if (wav.channels == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO)
          .build()
        val builder = AudioTrack.Builder()
          .setAudioAttributes(attributes)
          .setAudioFormat(format)
          .setTransferMode(AudioTrack.MODE_STATIC)
          .setBufferSizeInBytes(pcm.size)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
        }
        val t = builder.build()
        val written = t.write(pcm, 0, pcm.size)
        if (written != pcm.size) throw IllegalStateException("wrote $written of ${pcm.size} bytes")
        track = t
      } catch (e: Exception) {
        Log.w(TAG, "prepare: ${e.message}")
      }
    }
  }

  /**
   * Play the clip from `offsetMs` (a multiple of 1000: 0, 1000, 2000 or 3000, which
   * lands in the silence 100ms before a beep) at `startAt` on the elapsed-realtime clock.
   * Does nothing if this `anchor` is already scheduled or playing.
   */
  fun arm(anchor: Long, startAt: Long, offsetMs: Long) {
    handler.post {
      if (anchor == armedAnchor) return@post
      // Drop a start that hasn't happened yet; a clip that is sounding keeps going.
      startRunnable?.let { handler.removeCallbacks(it) }
      startRunnable = null
      armedAnchor = anchor
      val run = Runnable { start(anchor, offsetMs) }
      startRunnable = run
      handler.postDelayed(run, maxOf(0L, startAt - SystemClock.elapsedRealtime()))
    }
  }

  /** Stop any scheduled or playing clip (pause, skip, leaving the screen...). */
  fun cancel() {
    handler.post {
      if (armedAnchor < 0) return@post
      stopNow()
      armedAnchor = -1
    }
  }

  private fun start(anchor: Long, offsetMs: Long) {
    if (anchor != armedAnchor) return
    val t = track ?: run {
      Log.w(TAG, "start: the clip is not loaded")
      return
    }
    try {
      if (t.playState != AudioTrack.PLAYSTATE_STOPPED) {
        t.pause()
        t.stop()
      }
      t.reloadStaticData()
      val offsetFrames = (sampleRate * offsetMs / 1000).toInt().coerceIn(0, totalFrames - 1)
      t.setPlaybackHeadPosition(offsetFrames)
      t.play()
      // Let the track stop itself once the file has played out, and mark this
      // countdown as done. (A static AudioTrack otherwise stays "playing" at the end.)
      val generation = ++playGeneration
      finishRunnable?.let { handler.removeCallbacks(it) }
      val remainingMs = (totalFrames - offsetFrames) * 1000L / sampleRate
      val finish = Runnable { finish(generation, anchor) }
      finishRunnable = finish
      handler.postDelayed(finish, remainingMs + 150)
    } catch (e: Exception) {
      Log.w(TAG, "start: ${e.message}")
    }
  }

  private fun finish(generation: Int, anchor: Long) {
    if (generation != playGeneration) return // a newer clip started since
    finishRunnable = null
    try {
      track?.let { if (it.playState == AudioTrack.PLAYSTATE_PLAYING) it.stop() }
    } catch (e: Exception) {
      Log.w(TAG, "finish: ${e.message}")
    }
    if (armedAnchor == anchor) armedAnchor = -1
  }

  private fun stopNow() {
    startRunnable?.let { handler.removeCallbacks(it) }
    startRunnable = null
    finishRunnable?.let { handler.removeCallbacks(it) }
    finishRunnable = null
    val t = track ?: return
    try {
      if (t.playState == AudioTrack.PLAYSTATE_PLAYING) {
        t.pause() // immediate
        t.stop()
      }
    } catch (e: Exception) {
      Log.w(TAG, "stop: ${e.message}")
    }
  }

  private class Wav(val sampleRate: Int, val channels: Int, val frames: Int, val dataOffset: Int)

  /** A 16-bit PCM WAV: finds the fmt and data chunks. */
  private fun parseWav(bytes: ByteArray): Wav {
    val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    require(String(bytes, 0, 4) == "RIFF" && String(bytes, 8, 4) == "WAVE") { "not a WAV file" }
    var pos = 12
    var rate = 0
    var channels = 0
    var bits = 0
    while (pos + 8 <= bytes.size) {
      val id = String(bytes, pos, 4)
      val size = b.getInt(pos + 4)
      if (id == "fmt ") {
        require(b.getShort(pos + 8).toInt() == 1) { "not PCM" }
        channels = b.getShort(pos + 10).toInt()
        rate = b.getInt(pos + 12)
        bits = b.getShort(pos + 22).toInt()
      } else if (id == "data") {
        require(bits == 16) { "expected 16-bit, got $bits" }
        val dataSize = minOf(size, bytes.size - pos - 8)
        return Wav(rate, channels, dataSize / (channels * 2), pos + 8)
      }
      pos += 8 + size + (size and 1)
    }
    throw IllegalArgumentException("no data chunk")
  }
}
