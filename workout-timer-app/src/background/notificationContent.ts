import type { TimerPhase, TimerState } from '../timer/timerCore';

// What the running-workout notification should show for a given timer state.
// Pure, so it is tested with plain inputs (notificationContent.test.mjs).

export type NotificationInput = {
  phase: TimerPhase | undefined;
  nextPhase: TimerPhase | undefined;
  state: TimerState;
  /** Exact milliseconds left in the current segment (0 for a rep set waiting for "Done"). */
  remainingMs: number;
  /** The timer's clock now (elapsed realtime). */
  nowMs: number;
  /** When the next audio cue is due on the timer's clock, or null. */
  nextCueAtMs: number | null;
  /** The current rep set advances by itself. */
  autoRep: boolean;
};

export type NotificationView = {
  title: string;
  text: string;
  paused: boolean;
  deadlineElapsedMs: number | null;
  nextCueElapsedMs: number | null;
  showPause: boolean;
  showBack: boolean;
  showNext: boolean;
};

/** m:ss for a number of milliseconds, rounded up to the next whole second. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function nextLine(next: TimerPhase | undefined): string {
  if (!next) return 'Last one';
  if (next.type === 'rest') return `Next: rest ${Math.ceil(next.duration)}s`;
  return next.mode === 'reps' ? `Next: ${next.exerciseName} ×${next.reps ?? 0}` : `Next: ${next.exerciseName}`;
}

/** The notification for this state, or null when there is nothing to show (not started, finished). */
export function buildNotificationView(input: NotificationInput): NotificationView | null {
  const { phase, nextPhase, state, remainingMs, nowMs, nextCueAtMs, autoRep } = input;
  if (!phase || state === 'idle' || state === 'completed') return null;

  const paused = state === 'paused';
  const isRest = phase.type === 'rest';
  const isRepSet = !isRest && phase.mode === 'reps';
  const timed = !isRepSet || autoRep;

  const title = isRest ? 'Rest' : phase.exerciseName;
  let text: string;
  if (isRest) text = nextLine(nextPhase);
  else if (isRepSet && !autoRep) text = `${phase.reps ?? 0} reps · tap Done in the app`;
  else if (isRepSet) text = `${phase.reps ?? 0} reps · ${nextLine(nextPhase)}`;
  else text = nextLine(nextPhase);
  if (paused && timed) text = `Paused · ${formatClock(remainingMs)} left`;

  return {
    title,
    text,
    paused,
    deadlineElapsedMs: timed && !paused ? nowMs + Math.max(0, remainingMs) : null,
    nextCueElapsedMs: timed && !paused ? nextCueAtMs : null,
    showPause: timed,
    showBack: true,
    showNext: true,
  };
}
