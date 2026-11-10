package expo.modules.workoutservice

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** What the notification shows. Times are on the elapsed-realtime clock (see elapsedRealtime()). */
class NotificationContent : Record {
  @Field val title: String = "Workout"
  @Field val text: String = ""
  @Field val paused: Boolean = false
  /** Countdown target; null for no live countdown (a rep set waiting for "Done", or paused). */
  @Field val deadlineElapsedMs: Double? = null
  /** When the next audio cue is due, so the service can wake JS exactly then. */
  @Field val nextCueElapsedMs: Double? = null
  @Field val showPause: Boolean = true
  @Field val showBack: Boolean = true
  @Field val showNext: Boolean = true
  /** Only read by start(): the service stops itself after this long, capped at 3 hours. */
  @Field val maxDurationMs: Double? = null
}

class WorkoutServiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is gone")

  override fun definition() = ModuleDefinition {
    Name("WorkoutService")

    Events(
      WorkoutServiceBridge.EVENT_TICK,
      WorkoutServiceBridge.EVENT_ACTION,
      WorkoutServiceBridge.EVENT_STOPPED,
    )

    OnCreate {
      WorkoutServiceBridge.attach { name, payload -> this@WorkoutServiceModule.sendEvent(name, payload) }
    }

    OnDestroy {
      WorkoutServiceBridge.detach()
    }

    /** Milliseconds since boot, including deep sleep: the clock the workout timer should run on. */
    Function("elapsedRealtime") { SystemClock.elapsedRealtime().toDouble() }

    Function("isRunning") { WorkoutServiceBridge.running }

    // ── Cue sounds (SoundPool; see CueSounds.kt) ───────────────────────────

    Function("prepareCues") {
      CueSounds.prepare(context)
      CountdownClip.prepare(context)
    }

    /** Schedule the 3-2-1 clip to start at `startAt` (elapsedRealtime) from `offsetMs`; no-op if `anchor` is already armed. */
    Function("armCountdown") { anchor: Double, startAt: Double, offsetMs: Double ->
      CountdownClip.arm(anchor.toLong(), startAt.toLong(), offsetMs.toLong())
    }

    Function("cancelCountdown") { CountdownClip.cancel() }


    /** Play "beep" or "go" now; returns elapsedRealtime when it started, or -1 if it couldn't. */
    Function("playCue") { name: String -> CueSounds.play(name) }


    Function("areNotificationsEnabled") { NotificationManagerCompat.from(context).areNotificationsEnabled() }

    /**
     * Start the service (the app must be visible). Resolves true if the start was
     * accepted; Android may still refuse to promote it, which arrives as an
     * onWorkoutServiceStopped event with reason "notAllowed".
     */
    AsyncFunction("start") { content: NotificationContent ->
      val intent = fill(Intent(context, WorkoutForegroundService::class.java), content)
        .setAction(WorkoutForegroundService.ACTION_START)
      content.maxDurationMs?.let { intent.putExtra(WorkoutForegroundService.EXTRA_MAX_DURATION_MS, it.toLong()) }
      try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (e: Exception) {
        // Android 12+: ForegroundServiceStartNotAllowedException when the app isn't visible.
        false
      }
    }

    AsyncFunction("update") { content: NotificationContent ->
      if (!WorkoutServiceBridge.running) return@AsyncFunction false
      val intent = fill(Intent(context, WorkoutForegroundService::class.java), content)
        .setAction(WorkoutForegroundService.ACTION_UPDATE)
      try {
        context.startService(intent)
        true
      } catch (e: Exception) {
        false
      }
    }

    AsyncFunction("stop") {
      val intent = Intent(context, WorkoutForegroundService::class.java)
        .setAction(WorkoutForegroundService.ACTION_STOP)
      try {
        if (WorkoutServiceBridge.running) context.startService(intent) else context.stopService(intent)
      } catch (e: Exception) {
        // Already gone.
      }
    }
  }

  private fun fill(intent: Intent, content: NotificationContent): Intent {
    intent.putExtra(WorkoutForegroundService.EXTRA_TITLE, content.title)
    intent.putExtra(WorkoutForegroundService.EXTRA_TEXT, content.text)
    intent.putExtra(WorkoutForegroundService.EXTRA_PAUSED, content.paused)
    intent.putExtra(WorkoutForegroundService.EXTRA_SHOW_PAUSE, content.showPause)
    intent.putExtra(WorkoutForegroundService.EXTRA_SHOW_BACK, content.showBack)
    intent.putExtra(WorkoutForegroundService.EXTRA_SHOW_NEXT, content.showNext)
    intent.putExtra(WorkoutForegroundService.EXTRA_DEADLINE_ELAPSED_MS, content.deadlineElapsedMs?.toLong() ?: -1L)
    intent.putExtra(WorkoutForegroundService.EXTRA_NEXT_CUE_ELAPSED_MS, content.nextCueElapsedMs?.toLong() ?: -1L)
    return intent
  }
}
