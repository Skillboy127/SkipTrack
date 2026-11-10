// The workout timer, without React: phases, the clock, and every audible cue.
//
// Kept framework-free so it can be driven by a fake clock in tests
// (timerCore.test.mjs) and so its state changes take effect immediately. The
// previous hook kept its timing in refs that only caught up after React
// re-rendered; when a render took longer than a tick, the next tick still saw the
// old phase as finished and fired its end cue again, which is what made the
// end-of-phase beep stutter.
//
// Rules:
// - Every countdown runs from an absolute deadline on a monotonic clock. Ticks
//   only decide which cues are now due; they are never counted.
// - Each countdown cue (3, 2, 1) of a segment fires exactly once, even if a tick
//   arrives late (a late cue still fires, in order, instead of being skipped).
// - A segment's end cue (`phaseStart` of the next phase) fires exactly once,
//   whether the segment ended by its timer, by "Done" on a rep set, or by an
//   auto-advancing rep set. Manual skips stay silent, as before.

export type TimerState = 'idle' | 'running' | 'paused' | 'completed';

export type TimerPhase = {
  type: 'work' | 'rest';
  exerciseName: string;
  duration: number;
  mode?: 'timed' | 'reps';
  reps?: number;
};

export type TimerHandlers = {
  /** A countdown cue is due: 3, 2 or 1 seconds left in the current segment. */
  onCountdown?: (secondsLeft: number, phaseIndex: number) => void;
  /** A new phase began because the previous one ended (the end cue). Not called by start() or manual skips. */
  onPhaseStart?: (phase: TimerPhase, phaseIndex: number) => void;
  /** An auto-advancing rep set ran out of time (the host logs the set, then calls completeRep()). */
  onAutoRepEnd?: (phaseIndex: number) => void;
  /** Seconds a rep set may run before it advances by itself, or null to wait for "Done". Read when the set starts. */
  getAutoRepSeconds?: (phase: TimerPhase) => number | null;
};

export type TimerSnapshot = {
  state: TimerState;
  index: number;
  /** Length of the current segment in seconds (for a rep set: its auto-advance time, or 0). */
  segmentSeconds: number;
  /** Seconds left in the current segment, updated once per whole second. */
  remainingSeconds: number;
  /** Seconds the workout has actually been running (pauses excluded), updated once per whole second. */
  elapsedSeconds: number;
  /** The current segment is a rep set that will advance by itself. */
  autoRep: boolean;
};

export const COUNTDOWN_CUES = [3, 2, 1] as const;

/**
 * The countdown cues (3, 2, 1) due at `remaining` seconds left that haven't fired,
 * in the order they should play. A cue only belongs to a segment longer than it.
 */
export function dueCountdownCues(remaining: number, segmentSeconds: number, fired: ReadonlySet<number>): number[] {
  return COUNTDOWN_CUES.filter(n => n < segmentSeconds && remaining <= n && !fired.has(n));
}

/**
 * After time was added to or taken from a segment: cues whose moment is now in the
 * future again are re-armed, and cues whose whole second is now in the past are
 * dropped (they belong to time that no longer exists), so neither repeats nor bunches.
 */
export function reconcileCountdownCues(fired: Set<number>, remaining: number): void {
  for (const n of COUNTDOWN_CUES) {
    if (n < remaining) fired.delete(n);
    else if (n > Math.ceil(remaining)) fired.add(n);
  }
}

/** A monotonic millisecond clock: unaffected by changes to the device's wall-clock time. */
export function monotonicNow(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

export class TimerCore {
  private phases: TimerPhase[];
  private clock: () => number;
  private handlers: TimerHandlers = {};
  private listeners = new Set<() => void>();
  private disposed = false;

  private state: TimerState = 'idle';
  private index = 0;
  /** Clock time the current segment started (moved forward by pauses). */
  private segmentStart = 0;
  private segmentSeconds = 0;
  private pausedAt: number | null = null;
  private fired = new Set<number>();
  private autoRep = false;
  private autoRepEnded = false;
  private activeMs = 0;
  private lastTickAt: number | null = null;
  private snapshot: TimerSnapshot;

  constructor(phases: TimerPhase[], clock: () => number = monotonicNow) {
    this.phases = phases;
    this.clock = clock;
    this.snapshot = this.buildSnapshot();
  }

  setHandlers(handlers: TimerHandlers): void {
    this.handlers = handlers;
  }

  setPhases(phases: TimerPhase[]): void {
    this.phases = phases;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): TimerSnapshot {
    return this.snapshot;
  }

  /** Stop firing cues and publishing (the screen went away). */
  dispose(): void {
    this.disposed = true;
  }

  /** Undo dispose() (the same screen came back, e.g. a re-run effect). */
  revive(): void {
    this.disposed = false;
  }

  // ── Controls ────────────────────────────────────────────────────────────

  start(): void {
    if (this.disposed || this.phases.length === 0) return;
    const now = this.clock();
    this.state = 'running';
    this.activeMs = 0;
    this.lastTickAt = now;
    this.enterSegment(0, now, false);
  }

  pause(): void {
    if (this.state !== 'running') return;
    const now = this.clock();
    this.accrue(now);
    this.state = 'paused';
    this.pausedAt = now;
    this.publish(true);
  }

  resume(): void {
    if (this.state !== 'paused' || this.pausedAt === null) return;
    const now = this.clock();
    // Shift the deadline by exactly the time spent paused.
    this.segmentStart += now - this.pausedAt;
    this.pausedAt = null;
    this.lastTickAt = now;
    this.state = 'running';
    this.publish(true);
  }

  skipNext(): void {
    if (this.state === 'idle' || this.state === 'completed') return;
    if (this.index >= this.phases.length - 1) {
      this.complete();
      return;
    }
    this.enterSegment(this.index + 1, this.clock(), false);
  }

  skipPrevious(): void {
    if (this.state === 'idle' || this.state === 'completed') return;
    this.enterSegment(Math.max(0, this.index - 1), this.clock(), false);
  }

  /** "Done" on a rep set (or the end of an auto-advancing one): the same end cue as a timed phase. */
  completeRep(): void {
    const phase = this.phases[this.index];
    if (!phase || phase.mode !== 'reps' || this.state === 'idle' || this.state === 'completed') return;
    if (this.index >= this.phases.length - 1) {
      this.complete();
      return;
    }
    this.enterSegment(this.index + 1, this.clock(), true);
  }

  /** Add or remove rest time (rest phases only). */
  adjustRest(deltaSeconds: number): void {
    if (this.phases[this.index]?.type !== 'rest') return;
    this.changeSegmentLength(deltaSeconds);
  }

  /** Give an auto-advancing rep set more time ("+10s"). */
  extendRep(seconds: number): void {
    if (!this.autoRep) return;
    this.changeSegmentLength(seconds);
  }

  /** Advance the clock: called every ~50ms by the host. */
  tick(): void {
    if (this.disposed || this.state !== 'running') return;
    const now = this.clock();
    this.accrue(now);

    if (!this.isTimedSegment()) {
      this.publish(false);
      return;
    }

    const remaining = this.remainingAt(now);
    for (const n of dueCountdownCues(remaining, this.segmentSeconds, this.fired)) {
      this.fired.add(n);
      this.handlers.onCountdown?.(n, this.index);
      if (this.disposed || this.state !== 'running') return;
    }

    if (remaining > 0) {
      this.publish(false);
      return;
    }

    if (this.autoRep) {
      if (!this.autoRepEnded) {
        this.autoRepEnded = true;
        this.publish(true);
        this.handlers.onAutoRepEnd?.(this.index);
      }
      return;
    }

    // A timed segment is over. The next one starts exactly where this one ended
    // (not "now"), and if several timed phases have fully elapsed since the last
    // tick (e.g. the app was in the background), land on the one current now.
    let landedIndex = this.index;
    let landedStart = this.segmentStart + this.segmentSeconds * 1000;
    for (;;) {
      const nextIndex = landedIndex + 1;
      if (nextIndex >= this.phases.length) {
        this.complete();
        return;
      }
      landedIndex = nextIndex;
      const next = this.phases[nextIndex];
      if (next.mode === 'reps') break;
      const endsAt = landedStart + next.duration * 1000;
      if (endsAt > now) break;
      landedStart = endsAt;
    }
    this.enterSegment(landedIndex, landedStart, true);
  }

  // ── For the notification ────────────────────────────────────────────────

  /** The clock this core runs on, read now. */
  now(): number {
    return this.clock();
  }

  /** Exact milliseconds left in the current segment (0 for a rep set waiting for "Done"). */
  remainingMs(): number {
    if (this.state === 'idle' || this.state === 'completed' || !this.isTimedSegment()) return 0;
    return Math.max(0, this.remainingAt(this.clock()) * 1000);
  }

  /**
   * Clock time of the next audible cue (a countdown number or the segment's end),
   * or null when nothing is pending (not running, or a rep set waiting for "Done").
   */
  nextCueAt(): number | null {
    if (this.state !== 'running' || !this.isTimedSegment()) return null;
    const end = this.segmentStart + this.segmentSeconds * 1000;
    for (const n of COUNTDOWN_CUES) {
      if (n < this.segmentSeconds && !this.fired.has(n)) return end - n * 1000;
    }
    if (this.autoRep && this.autoRepEnded) return null;
    return end;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private enterSegment(index: number, startAt: number, announce: boolean): void {
    const phase = this.phases[index];
    this.index = index;
    this.segmentStart = startAt;
    this.pausedAt = this.state === 'paused' ? this.clock() : null;
    this.fired = new Set();
    this.autoRepEnded = false;
    if (phase.mode === 'reps') {
      const auto = this.handlers.getAutoRepSeconds?.(phase) ?? null;
      this.autoRep = auto !== null && auto > 0;
      this.segmentSeconds = this.autoRep ? (auto as number) : 0;
    } else {
      this.autoRep = false;
      this.segmentSeconds = phase.duration;
    }
    this.publish(true);
    if (announce) this.handlers.onPhaseStart?.(phase, index);
  }

  private changeSegmentLength(deltaSeconds: number): void {
    const now = this.clock();
    const elapsed = this.segmentSeconds - this.remainingAt(now);
    this.segmentSeconds = Math.max(elapsed, this.segmentSeconds + deltaSeconds);
    reconcileCountdownCues(this.fired, this.remainingAt(now));
    this.publish(true);
  }

  private complete(): void {
    const now = this.clock();
    this.accrue(now);
    this.state = 'completed';
    this.pausedAt = null;
    this.publish(true);
  }

  private isTimedSegment(): boolean {
    return this.phases[this.index]?.mode !== 'reps' || this.autoRep;
  }

  private remainingAt(now: number): number {
    const at = this.pausedAt ?? now;
    return this.segmentSeconds - (at - this.segmentStart) / 1000;
  }

  private accrue(now: number): void {
    if (this.state === 'running' && this.lastTickAt !== null) this.activeMs += now - this.lastTickAt;
    this.lastTickAt = now;
  }

  private buildSnapshot(): TimerSnapshot {
    const timed = this.isTimedSegment();
    const remaining = timed ? Math.max(0, this.remainingAt(this.clock())) : this.segmentSeconds;
    return {
      state: this.state,
      index: this.index,
      segmentSeconds: this.segmentSeconds,
      remainingSeconds: remaining,
      elapsedSeconds: this.activeMs / 1000,
      autoRep: this.autoRep,
    };
  }

  /** Publish a new snapshot; routine ticks only when a displayed whole second changes. */
  private publish(force: boolean): void {
    if (this.disposed) return;
    const next = this.buildSnapshot();
    const prev = this.snapshot;
    const changed =
      force ||
      next.state !== prev.state ||
      next.index !== prev.index ||
      Math.ceil(next.remainingSeconds) !== Math.ceil(prev.remainingSeconds) ||
      Math.floor(next.elapsedSeconds) !== Math.floor(prev.elapsedSeconds);
    if (!changed) return;
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  }
}
