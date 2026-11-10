import { AppRegistry, PermissionsAndroid, Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';
import { BACKGROUND_WORKOUT_SERVICE_ENABLED, BACKGROUND_SERVICE_MAX_HOURS } from './config';

// JavaScript side of modules/workout-service: the Android foreground service that
// shows the running workout as a notification and keeps the timer and cues going
// while the app is in the background or the screen is off.
//
// Everything here degrades to "no service" when the kill switch is off, on a
// platform without the module, or on a binary built before the module existed
// (an OTA update can't add native code), so callers never need to special-case.

export type WorkoutAction = 'pause' | 'resume' | 'next' | 'back';

export type WorkoutServiceStopReason =
  | 'stopped' // the app asked
  | 'maxDuration' // the hard time limit passed
  | 'timeout' // Android timed the service out
  | 'notAllowed' // Android refused to start it (app wasn't visible)
  | 'taskFailed'
  | 'taskEnded'
  | 'destroyed'; // the system or the user (swipe in Recents) ended it

/** What the notification shows. Times are on the elapsed-realtime clock. */
export type NotificationContent = {
  title: string;
  text: string;
  paused: boolean;
  deadlineElapsedMs: number | null;
  nextCueElapsedMs: number | null;
  showPause: boolean;
  showBack: boolean;
  showNext: boolean;
  maxDurationMs?: number;
};

type NativeEvents = {
  onWorkoutTick: (event: { elapsedRealtime: number }) => void;
  onWorkoutAction: (event: { action: string }) => void;
  onWorkoutServiceStopped: (event: { reason: string }) => void;
};

type NativeWorkoutService = {
  elapsedRealtime(): number;
  isRunning(): boolean;
  areNotificationsEnabled(): boolean;
  start(content: NotificationContent): Promise<boolean>;
  update(content: NotificationContent): Promise<boolean>;
  stop(): Promise<void>;
  addListener<K extends keyof NativeEvents>(name: K, listener: NativeEvents[K]): EventSubscription;
};

const native: NativeWorkoutService | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeWorkoutService>('WorkoutService') : null;

/** The service can be used in this build, on this platform, with the kill switch on. */
export function isBackgroundServiceAvailable(): boolean {
  return BACKGROUND_WORKOUT_SERVICE_ENABLED && native !== null;
}

/**
 * A clock for the workout timer that keeps counting while the phone sleeps.
 * performance.now() (CLOCK_MONOTONIC) stops during deep sleep on Android, so a
 * deadline measured with it would slip by the time asleep; elapsedRealtime doesn't.
 * Falls back to Date.now() where the module is missing.
 */
export function elapsedRealtimeNow(): number {
  return native ? native.elapsedRealtime() : Date.now();
}

export function isWorkoutServiceRunning(): boolean {
  return native !== null && native.isRunning();
}

/** Start the service. Call only while the app is on screen. Resolves false if it couldn't start. */
export async function startWorkoutService(content: NotificationContent): Promise<boolean> {
  if (!isBackgroundServiceAvailable() || !native) return false;
  try {
    return await native.start({ ...content, maxDurationMs: BACKGROUND_SERVICE_MAX_HOURS * 3_600_000 });
  } catch {
    return false;
  }
}

export function updateWorkoutNotification(content: NotificationContent): void {
  if (!native || !native.isRunning()) return;
  native.update(content).catch(() => {});
}

export function stopWorkoutService(): void {
  if (!native) return;
  native.stop().catch(() => {});
}

export type WorkoutServiceHandlers = {
  onTick?: (elapsedRealtime: number) => void;
  onAction?: (action: WorkoutAction) => void;
  onStopped?: (reason: WorkoutServiceStopReason) => void;
};

const ACTIONS: readonly WorkoutAction[] = ['pause', 'resume', 'next', 'back'];

/** Listen to the service. Returns the function that stops listening. */
export function addWorkoutServiceListener(handlers: WorkoutServiceHandlers): () => void {
  if (!native) return () => {};
  const subs: EventSubscription[] = [];
  if (handlers.onTick) {
    const onTick = handlers.onTick;
    subs.push(native.addListener('onWorkoutTick', e => onTick(e.elapsedRealtime)));
  }
  if (handlers.onAction) {
    const onAction = handlers.onAction;
    subs.push(
      native.addListener('onWorkoutAction', e => {
        if ((ACTIONS as readonly string[]).includes(e.action)) onAction(e.action as WorkoutAction);
      }),
    );
  }
  if (handlers.onStopped) {
    const onStopped = handlers.onStopped;
    subs.push(native.addListener('onWorkoutServiceStopped', e => onStopped(e.reason as WorkoutServiceStopReason)));
  }
  return () => subs.forEach(s => s.remove());
}

export type NotificationPermission = 'granted' | 'denied' | 'not_needed';

/** Whether the notification can be shown. Android 13+ needs the runtime permission. */
export function getNotificationPermission(): NotificationPermission {
  if (!native) return 'not_needed';
  if (Platform.OS !== 'android' || Platform.Version < 33) return 'not_needed';
  return native.areNotificationsEnabled() ? 'granted' : 'denied';
}

/** Show the system prompt (Android 13+). Resolves with the outcome. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (Platform.OS !== 'android' || Platform.Version < 33) return 'not_needed';
  try {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

// ─── Headless task ──────────────────────────────────────────────────────────
// The service runs one Headless JS task for the whole workout. React Native only
// keeps JavaScript timers running in the background while a headless task is
// active, so this task does nothing but stay alive until the service stops.

const TASK_NAME = 'FlexWorkoutSession';
let endTask: (() => void) | null = null;

/** Register the task with React Native. Call once, at app start, before the root component. */
export function registerWorkoutHeadlessTask(): void {
  if (Platform.OS !== 'android') return;
  AppRegistry.registerHeadlessTask(TASK_NAME, () => async () => {
    endTask?.(); // a previous task still pending (shouldn't happen): let it go
    await new Promise<void>(resolve => {
      endTask = () => {
        endTask = null;
        resolve();
      };
      if (native && !native.isRunning()) endTask(); // the service already stopped
    });
  });
  if (native) {
    native.addListener('onWorkoutServiceStopped', () => endTask?.());
    // JavaScript is starting fresh (cold start or an OTA reload), so no workout is
    // on screen: a service still running belongs to a workout that no longer
    // exists and must not linger until its time limit.
    if (native.isRunning()) native.stop().catch(() => {});
  }
}
