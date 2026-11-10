package expo.modules.workoutservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** A notification button was tapped: hand it to the (already running) service. */
class WorkoutActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.getStringExtra(WorkoutForegroundService.EXTRA_BUTTON) ?: return
    val forward = Intent(context, WorkoutForegroundService::class.java)
      .setAction(WorkoutForegroundService.ACTION_BUTTON)
      .putExtra(WorkoutForegroundService.EXTRA_BUTTON, action)
    try {
      // The service is running (its notification is what was tapped), so a plain
      // startService() is allowed even though this receiver runs in the background.
      context.startService(forward)
    } catch (e: Exception) {
      Log.w(WorkoutForegroundService.TAG, "Could not deliver button '$action': ${e.message}")
    }
  }
}
