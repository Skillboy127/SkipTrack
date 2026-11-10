package expo.modules.workoutservice

import android.os.Bundle
import java.util.ArrayDeque

/**
 * The one place the service and the Expo module meet. The service publishes
 * events here; the module (when its JS side exists) forwards them to JavaScript.
 * Button presses that arrive before JS is listening are kept until it is, so a
 * tap on the lock screen is never lost.
 */
object WorkoutServiceBridge {
  const val EVENT_TICK = "onWorkoutTick"
  const val EVENT_ACTION = "onWorkoutAction"
  const val EVENT_STOPPED = "onWorkoutServiceStopped"

  private val lock = Any()
  private var sink: ((String, Bundle) -> Unit)? = null
  private val pendingActions = ArrayDeque<Bundle>()

  /** True between startForeground() succeeding and the service stopping. */
  @Volatile
  var running: Boolean = false

  fun attach(newSink: (String, Bundle) -> Unit) {
    val toFlush: List<Bundle>
    synchronized(lock) {
      sink = newSink
      toFlush = pendingActions.toList()
      pendingActions.clear()
    }
    toFlush.forEach { newSink(EVENT_ACTION, it) }
  }

  fun detach() {
    synchronized(lock) { sink = null }
  }

  fun emit(name: String, payload: Bundle) {
    val target: ((String, Bundle) -> Unit)?
    synchronized(lock) {
      target = sink
      if (target == null && name == EVENT_ACTION) {
        pendingActions.addLast(payload)
        while (pendingActions.size > 8) pendingActions.removeFirst()
      }
    }
    target?.invoke(name, payload)
  }
}
