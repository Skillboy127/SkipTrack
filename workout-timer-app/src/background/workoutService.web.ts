// Web version of workoutService.ts. There is no background service in a browser:
// the workout runs only while the page is open and visible. What this file does
// provide:
// - the timer's clock: the wall clock (Date.now), which keeps counting while the
//   phone sleeps or the tab is hidden (performance.now() can pause on iOS), so the
//   deadline-based timer is correct the moment the page comes back;
// - a tick the moment the page becomes visible again, so the screen catches up at once.

export type WorkoutAction = 'pause' | 'resume' | 'next' | 'back';
// Same types as workoutService.ts (kept identical so shared code type-checks either way).
export type WorkoutServiceStopReason =
  | 'stopped'
  | 'maxDuration'
  | 'timeout'
  | 'notAllowed'
  | 'taskFailed'
  | 'taskEnded'
  | 'destroyed';
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
export type NotificationPermission = 'granted' | 'denied' | 'not_needed';

export function isBackgroundServiceAvailable(): boolean {
  return false;
}

export function elapsedRealtimeNow(): number {
  return Date.now();
}

/** True so useTimerEngine runs the timer on elapsedRealtimeNow (the wall clock). */
export function hasNativeClock(): boolean {
  return true;
}

export function isWorkoutServiceRunning(): boolean {
  return false;
}

export async function startWorkoutService(_content: NotificationContent): Promise<boolean> {
  return false;
}

export function updateWorkoutNotification(_content: NotificationContent): void {}

export function stopWorkoutService(): void {}

export type WorkoutServiceHandlers = {
  onTick?: (elapsedRealtime: number) => void;
  onAction?: (action: WorkoutAction) => void;
  onStopped?: (reason: WorkoutServiceStopReason) => void;
};

export function addWorkoutServiceListener(handlers: WorkoutServiceHandlers): () => void {
  const onTick = handlers.onTick;
  if (!onTick || typeof document === 'undefined') return () => {};
  const wake = () => {
    if (document.visibilityState === 'visible') onTick(Date.now());
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pageshow', wake);
  window.addEventListener('focus', wake);
  return () => {
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('pageshow', wake);
    window.removeEventListener('focus', wake);
  };
}

export function getNotificationPermission(): NotificationPermission {
  return 'not_needed';
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return 'not_needed';
}

export function registerWorkoutHeadlessTask(): void {}
