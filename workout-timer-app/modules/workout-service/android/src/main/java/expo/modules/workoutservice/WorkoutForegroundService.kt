package expo.modules.workoutservice

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.os.bundleOf
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Keeps a workout alive while the app is in the background or the screen is off.
 *
 * - A foreground service (type mediaPlayback) with an ongoing notification: the
 *   current exercise, a live countdown (the notification's own chronometer, so it
 *   keeps counting without any help from us) and Back / Pause-Resume / Next buttons.
 * - A Headless JS task for the whole workout. React Native stops JavaScript timers
 *   when the activity pauses unless a headless task is running; with one running,
 *   the app's timer code and audio cues keep working. HeadlessJsTaskService also
 *   holds a partial wake lock for the life of the service.
 * - A 250ms tick sent to JavaScript from a native Handler, plus an exact alarm for
 *   the next cue, so cues don't depend on the display's frame clock.
 *
 * It always stops: when JavaScript says so, when the app is swiped away
 * (stopWithTask), when its hard maximum duration passes, when the system times it
 * out, or when the JS task ends for any reason. Every stop path goes through
 * [finish], which cancels timers and tells JavaScript why.
 */
class WorkoutForegroundService : HeadlessJsTaskService() {

  private val handler = Handler(Looper.getMainLooper())
  private var started = false
  private var finished = false
  private var taskStarted = false
  private var startedAtElapsed = 0L
  private var maxDurationMs = HARD_MAX_DURATION_MS
  private var cueAlarm: AlarmManager.OnAlarmListener? = null
  private var hardStopAlarm: AlarmManager.OnAlarmListener? = null

  private val alarmManager: AlarmManager
    get() = getSystemService(Context.ALARM_SERVICE) as AlarmManager

  private val tickRunnable = object : Runnable {
    override fun run() {
      if (finished) return
      emitTick()
      handler.postDelayed(this, TICK_MS)
    }
  }

  private val hardStopRunnable = Runnable { finish(REASON_MAX_DURATION) }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> handleStart(intent)
      ACTION_UPDATE -> if (started && !finished) {
        if (!postNotification(intent)) finish(REASON_NOT_ALLOWED)
      }
      ACTION_BUTTON -> {
        val button = intent.getStringExtra(EXTRA_BUTTON)
        if (started && !finished && button != null) {
          WorkoutServiceBridge.emit(WorkoutServiceBridge.EVENT_ACTION, bundleOf("action" to button))
          emitTick() // let JS act on the press straight away, even between ticks
        } else if (!started) {
          stopSelf(startId) // a stale button from a workout that's already over
        }
      }
      ACTION_STOP -> finish(REASON_STOPPED)
      // Android restarted us without an intent (or with an unknown one): nothing to resume.
      else -> if (!started) stopSelf(startId)
    }
    return START_NOT_STICKY
  }

  private fun handleStart(intent: Intent) {
    if (started) {
      if (!postNotification(intent)) finish(REASON_NOT_ALLOWED)
      return
    }
    started = true
    startedAtElapsed = SystemClock.elapsedRealtime()
    val requested = intent.getLongExtra(EXTRA_MAX_DURATION_MS, HARD_MAX_DURATION_MS)
    maxDurationMs = requested.coerceIn(MIN_MAX_DURATION_MS, HARD_MAX_DURATION_MS)

    createChannel()
    if (!postNotification(intent)) {
      finish(REASON_NOT_ALLOWED)
      return
    }
    WorkoutServiceBridge.running = true

    // The hard limit, twice: a Handler under the service's wake lock, and an alarm
    // in case the handler is ever held up.
    handler.postDelayed(hardStopRunnable, maxDurationMs)
    hardStopAlarm = scheduleAlarm(startedAtElapsed + maxDurationMs, "flex-max") { finish(REASON_MAX_DURATION) }

    if (!taskStarted) {
      taskStarted = true
      try {
        // timeout 0 = runs until the JS promise resolves; allowed while the app is visible.
        startTask(HeadlessJsTaskConfig(TASK_NAME, Arguments.createMap(), 0, true))
      } catch (e: Exception) {
        Log.e(TAG, "Could not start the headless task: ${e.message}")
        finish(REASON_TASK_FAILED)
        return
      }
    }
    handler.post(tickRunnable)
  }

  /** Build and show (or refresh) the notification. False if Android refused to promote us. */
  private fun postNotification(intent: Intent): Boolean {
    val notification = buildNotification(intent)
    scheduleCueAlarm(intent)
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ServiceCompat.startForeground(
          this,
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      true
    } catch (e: Exception) {
      // Android 12+: ForegroundServiceStartNotAllowedException when started from the background.
      Log.w(TAG, "startForeground refused: ${e.javaClass.simpleName} ${e.message}")
      false
    }
  }

  private fun buildNotification(intent: Intent): Notification {
    val title = intent.getStringExtra(EXTRA_TITLE) ?: "Workout"
    val text = intent.getStringExtra(EXTRA_TEXT) ?: ""
    val paused = intent.getBooleanExtra(EXTRA_PAUSED, false)
    val deadlineElapsed = intent.getLongExtra(EXTRA_DEADLINE_ELAPSED_MS, -1L)
    val showPause = intent.getBooleanExtra(EXTRA_SHOW_PAUSE, true)
    val showBack = intent.getBooleanExtra(EXTRA_SHOW_BACK, true)
    val showNext = intent.getBooleanExtra(EXTRA_SHOW_NEXT, true)

    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_workout)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openAppIntent())

    if (deadlineElapsed > 0 && !paused) {
      // The chronometer counts down on its own, so the display is right between updates.
      val remaining = deadlineElapsed - SystemClock.elapsedRealtime()
      builder
        .setWhen(System.currentTimeMillis() + remaining)
        .setShowWhen(true)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
    } else {
      builder.setShowWhen(false).setUsesChronometer(false)
    }

    if (showBack) builder.addAction(0, "Back", buttonIntent(BUTTON_BACK, 1))
    if (showPause) {
      if (paused) builder.addAction(0, "Resume", buttonIntent(BUTTON_RESUME, 2))
      else builder.addAction(0, "Pause", buttonIntent(BUTTON_PAUSE, 2))
    }
    if (showNext) builder.addAction(0, "Next", buttonIntent(BUTTON_NEXT, 3))
    return builder.build()
  }

  private fun buttonIntent(button: String, requestCode: Int): PendingIntent {
    val intent = Intent(this, WorkoutActionReceiver::class.java)
      .setAction("$ACTION_BUTTON.$button")
      .putExtra(EXTRA_BUTTON, button)
    return PendingIntent.getBroadcast(
      this,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun openAppIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(
      this,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /** Wake exactly when the next cue is due, so it isn't late even if the tick handler is held up. */
  private fun scheduleCueAlarm(intent: Intent) {
    cueAlarm?.let { alarmManager.cancel(it) }
    cueAlarm = null
    val at = intent.getLongExtra(EXTRA_NEXT_CUE_ELAPSED_MS, -1L)
    if (at <= 0) return
    cueAlarm = scheduleAlarm(at, "flex-cue") { emitTick() }
  }

  /**
   * An exact, listener-based alarm on the elapsed-realtime clock. Listener alarms
   * need no SCHEDULE_EXACT_ALARM permission (they only fire while the process is
   * alive, which a foreground service guarantees). Deep Doze can still defer it.
   */
  private fun scheduleAlarm(atElapsed: Long, tag: String, onFire: () -> Unit): AlarmManager.OnAlarmListener? {
    val listener = AlarmManager.OnAlarmListener { if (!finished) onFire() }
    return try {
      alarmManager.setExact(
        AlarmManager.ELAPSED_REALTIME_WAKEUP,
        maxOf(atElapsed, SystemClock.elapsedRealtime() + 1),
        tag,
        listener,
        handler,
      )
      listener
    } catch (e: Exception) {
      Log.w(TAG, "Exact alarm '$tag' not available: ${e.message}")
      null
    }
  }

  private fun emitTick() {
    WorkoutServiceBridge.emit(
      WorkoutServiceBridge.EVENT_TICK,
      bundleOf("elapsedRealtime" to SystemClock.elapsedRealtime().toDouble()),
    )
  }

  /** The single exit: cancel everything, drop the notification, tell JS, stop. Safe to call twice. */
  private fun finish(reason: String) {
    if (finished) return
    finished = true
    WorkoutServiceBridge.running = false
    handler.removeCallbacksAndMessages(null)
    cueAlarm?.let { alarmManager.cancel(it) }
    hardStopAlarm?.let { alarmManager.cancel(it) }
    cueAlarm = null
    hardStopAlarm = null
    WorkoutServiceBridge.emit(WorkoutServiceBridge.EVENT_STOPPED, bundleOf("reason" to reason))
    try {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    } catch (e: Exception) {
      Log.w(TAG, "stopForeground: ${e.message}")
    }
    stopSelf()
  }

  /** Android 15+: the system can time a foreground service out; stop cleanly rather than ANR. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    finish(REASON_TIMEOUT)
  }

  override fun onTimeout(startId: Int) {
    finish(REASON_TIMEOUT)
  }

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    // The JS task ended (normally because JS asked us to stop, which already ran
    // finish(); otherwise JS failed). Either way the service must not outlive it.
    finish(REASON_TASK_ENDED)
    super.onHeadlessJsTaskFinish(taskId)
  }

  override fun onDestroy() {
    finish(REASON_DESTROYED) // no-op if a normal stop already ran
    super.onDestroy() // releases the wake lock and the task listener
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Running workout", NotificationManager.IMPORTANCE_LOW).apply {
      description = "The current exercise and countdown while a workout is running."
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannel(channel)
  }

  companion object {
    const val TAG = "WorkoutService"
    const val TASK_NAME = "FlexWorkoutSession"
    const val CHANNEL_ID = "workout_session"
    const val NOTIFICATION_ID = 4271

    const val ACTION_START = "expo.modules.workoutservice.START"
    const val ACTION_UPDATE = "expo.modules.workoutservice.UPDATE"
    const val ACTION_STOP = "expo.modules.workoutservice.STOP"
    const val ACTION_BUTTON = "expo.modules.workoutservice.BUTTON"

    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_PAUSED = "paused"
    const val EXTRA_DEADLINE_ELAPSED_MS = "deadlineElapsedMs"
    const val EXTRA_NEXT_CUE_ELAPSED_MS = "nextCueElapsedMs"
    const val EXTRA_SHOW_PAUSE = "showPause"
    const val EXTRA_SHOW_BACK = "showBack"
    const val EXTRA_SHOW_NEXT = "showNext"
    const val EXTRA_MAX_DURATION_MS = "maxDurationMs"
    const val EXTRA_BUTTON = "button"

    const val BUTTON_BACK = "back"
    const val BUTTON_PAUSE = "pause"
    const val BUTTON_RESUME = "resume"
    const val BUTTON_NEXT = "next"

    const val REASON_STOPPED = "stopped"
    const val REASON_MAX_DURATION = "maxDuration"
    const val REASON_TIMEOUT = "timeout"
    const val REASON_NOT_ALLOWED = "notAllowed"
    const val REASON_TASK_FAILED = "taskFailed"
    const val REASON_TASK_ENDED = "taskEnded"
    const val REASON_DESTROYED = "destroyed"

    /** No workout session may keep the service alive longer than this, whatever JS asks for. */
    const val HARD_MAX_DURATION_MS = 3L * 60 * 60 * 1000
    const val MIN_MAX_DURATION_MS = 60L * 1000
    private const val TICK_MS = 250L
  }
}
