import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, TextInput, BackHandler, PanResponder, StatusBar, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useInterstitialAd } from 'react-native-google-mobile-ads';
import { INTERSTITIAL_AD_UNIT_ID } from '../adConfig';
import { RootStackParamList, RepSetLog, CountdownSoundMode, WeightUnit } from '../types';
import { useTimerEngine } from '../useTimerEngine';
import { useAudio } from '../useAudio';
import { useSpeech } from '../useSpeech';
import { expandWorkout } from '../workoutLogic';
import { addHistoryEntry, loadCountdownSoundMode, saveCountdownSoundMode, loadWeightUnit, loadAdFreeStatus } from '../storage';
import { SkipIcon, PlayIcon, PauseIcon, SpeakerIcon, ChevronIcon, CloseIcon } from '../components/WorkoutIcons';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { UpNextDrawer } from '../components/UpNextDrawer';
import { Display, Label, Body } from '../components/PosterText';
import { band, colors, display, font, label, leading, rule, space, tracking } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ActiveSession'>;
type QuitStep = 'closed' | 'confirmQuit' | 'confirmSaveHistory';

const generateId = () => Math.random().toString(36).substring(2, 9);

// The get-ready countdown runs for this many seconds, but only cues (spoken or
// beeped) the last 3 — the first couple of seconds count down silently.
const PRE_START_SECONDS = 5;
const PRE_START_CUE_WORDS: Record<number, string> = { 3: 'three', 2: 'two', 1: 'one' };

const SOUND_MODE_ORDER: CountdownSoundMode[] = ['speech', 'beep', 'silent'];
const SOUND_MODE_LABELS: Record<CountdownSoundMode, string> = {
  speech: 'Spoken countdown',
  beep: 'Beep countdown',
  silent: 'Silent countdown',
};

export function ActiveSessionScreen({ route, navigation }: Props) {
  const { workout } = route.params;
  const phases = useMemo(() => expandWorkout(workout), [workout]);

  // Display sizes scale with the screen so the countdown stays readable across
  // the room; adjustsFontSizeToFit then guarantees they never clip.
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const timerSize = Math.round(Math.min(width * 0.92, 400));
  const countSize = Math.round(Math.min(width * 0.74, 320));
  const nameSize = Math.round(Math.min(width * 0.26, display.exercise));
  // Rep screens carry more controls (set label, weight, DONE), so the name is
  // kept to one smaller line there to leave the rep count the room it needs.
  const repNameSize = Math.round(Math.min(width * 0.15, 64));
  // Size of the area the rep count lives in, measured once laid out. The count
  // is sized from this directly instead of relying on auto-shrink, which left
  // it tiny whenever the area was short.
  const [repArea, setRepArea] = useState<{ w: number; h: number } | null>(null);

  const { playBeep, playGoBeep } = useAudio();
  const [soundMode, setSoundMode] = useState<CountdownSoundMode>('speech');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('lb');
  const { speak, speakCountdown } = useSpeech(soundMode === 'speech');
  // Some cue callbacks below live inside effects that only run once (`[]`
  // deps — the get-ready ticker in particular) and so capture whatever
  // `soundMode` was at mount time forever. Reading through a ref instead of
  // the state variable directly means those callbacks always see the current
  // setting even though the closure they live in was created long ago —
  // this is what caused "beep" mode to silently do nothing during get-ready
  // (the stale closure still thought the mode was the default "speech").
  const soundModeRef = useRef(soundMode);
  useEffect(() => {
    soundModeRef.current = soundMode;
  }, [soundMode]);

  // Free users only, and only once that's known. Preloaded for the whole session
  // so it's ready the moment the workout ends; nothing is shown mid-session.
  const [adFree, setAdFree] = useState<boolean | null>(null);
  useEffect(() => {
    loadAdFreeStatus().then(setAdFree);
  }, []);
  const completionAd = useInterstitialAd({
    adUnitId: adFree === false ? INTERSTITIAL_AD_UNIT_ID : null,
    requestOptions: { requestNonPersonalizedAdsOnly: true },
  });
  const completionStartedRef = useRef(false);
  const showingCompletionAdRef = useRef(false);
  const completionNavigatedRef = useRef(false);
  useEffect(() => {
    if (completionAd.status === 'loaded') {
      console.log('[AdMob interstitial] loaded', INTERSTITIAL_AD_UNIT_ID);
    } else if (completionAd.status === 'error' || completionAd.status === 'no-fill') {
      console.log('[AdMob interstitial] failed to load', completionAd.status, completionAd.error?.code, completionAd.error?.message);
    }
  }, [completionAd.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCountdownTick = (secondsRemaining: number) => {
    if (soundModeRef.current === 'speech') speakCountdown(secondsRemaining);
    else if (soundModeRef.current === 'beep') playBeep();
  };
  const playTransitionBeep = () => {
    if (soundModeRef.current !== 'silent') playBeep();
  };
  // A distinct higher-pitched cue the moment a new phase begins, following the
  // "3, 2, 1" countdown — a clear "go" signal separate from the countdown
  // beeps/speech. It marks the start of a rest as well as of an exercise, so
  // the change of phase is audible either way.
  const handlePhaseStart = (_phase: { type: 'work' | 'rest' }) => {
    if (soundModeRef.current !== 'silent') playGoBeep();
  };
  const engine = useTimerEngine(phases, playTransitionBeep, handleCountdownTick, handlePhaseStart);

  const [repLogs, setRepLogs] = useState<RepSetLog[]>([]);
  const [pendingWeight, setPendingWeight] = useState<number | null>(null);
  const [weightInputVisible, setWeightInputVisible] = useState(false);
  const [weightInputValue, setWeightInputValue] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [quitStep, setQuitStep] = useState<QuitStep>('closed');
  const [upNextVisible, setUpNextVisible] = useState(false);
  // Seconds left in the "get ready" countdown shown before the workout timer
  // actually starts; null once it's finished and the real session has begun.
  const [preStartSeconds, setPreStartSeconds] = useState<number | null>(PRE_START_SECONDS);

  // Load the user's countdown sound preference (defaults to spoken)
  useEffect(() => {
    loadCountdownSoundMode().then(setSoundMode);
    loadWeightUnit().then(setWeightUnit);
  }, []);

  const cycleSoundMode = () => {
    const next = SOUND_MODE_ORDER[(SOUND_MODE_ORDER.indexOf(soundMode) + 1) % SOUND_MODE_ORDER.length];
    setSoundMode(next);
    saveCountdownSoundMode(next);
    setToastMessage(SOUND_MODE_LABELS[next]);
    setTimeout(() => setToastMessage(null), 1500);
  };

  const cuePreStartTick = (secondsRemaining: number) => {
    const word = PRE_START_CUE_WORDS[secondsRemaining];
    if (!word) return; // stay silent for the leading seconds before the last 3
    if (soundModeRef.current === 'speech') speak(word);
    else if (soundModeRef.current === 'beep') playBeep();
  };

  // Give the user a "get ready" countdown before the first phase's timer
  // actually starts, so there's time to get into position. Only the last 3
  // seconds get a spoken/beeped cue; the rest count down silently.
  //
  // Driven off wall-clock elapsed time (like useTimerEngine's main loop)
  // rather than counting naive setInterval ticks — a plain 1s-interval
  // countdown starts however late the effect happened to get scheduled and
  // never catches up, which is what made the "3, 2, 1" cues feel late.
  // Recomputing from Date.now() every 100ms self-corrects for that.
  useEffect(() => {
    const startTime = Date.now();
    let lastCued = -1;
    let intervalId: ReturnType<typeof setInterval>;

    const tick = () => {
      const remaining = PRE_START_SECONDS - (Date.now() - startTime) / 1000;
      const ceilRemaining = Math.max(0, Math.ceil(remaining));

      if (ceilRemaining !== lastCued) {
        lastCued = ceilRemaining;
        if (ceilRemaining > 0) cuePreStartTick(ceilRemaining);
        setPreStartSeconds(ceilRemaining > 0 ? ceilRemaining : null);
      }

      if (remaining <= 0) clearInterval(intervalId);
    };

    tick();
    intervalId = setInterval(tick, 100);
    return () => clearInterval(intervalId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Start the actual workout timer once the "get ready" countdown finishes
  useEffect(() => {
    if (preStartSeconds === null) {
      engine.start();
      if (soundModeRef.current !== 'silent') playGoBeep();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [preStartSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Announce the next exercise (and how long/many it is) as soon as a rest
  // phase begins, giving the full rest duration to hear it — not just the
  // last second of the countdown. Only meaningful in spoken mode.
  useEffect(() => {
    if (soundMode !== 'speech') return;
    if (!engine.currentPhase || engine.currentPhase.type !== 'rest') return;
    const upcoming = phases[engine.currentPhaseIndex + 1];
    if (!upcoming?.exerciseName) return;

    const amount = upcoming.mode === 'reps'
      ? `${upcoming.reps} rep${upcoming.reps === 1 ? '' : 's'}`
      : `${Math.round(upcoming.duration)} second${Math.round(upcoming.duration) === 1 ? '' : 's'}`;
    speak(`Up next, ${upcoming.exerciseName} for ${amount}`);
  }, [engine.currentPhaseIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // A light haptic tap on every real phase transition (skipping the initial
  // mount, which isn't a transition).
  const isFirstPhaseEffectRun = useRef(true);
  useEffect(() => {
    if (isFirstPhaseEffectRun.current) {
      isFirstPhaseEffectRun.current = false;
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, [engine.currentPhaseIndex]);

  const wasRunningRef = useRef(false);

  const resumeIfNeeded = () => {
    if (wasRunningRef.current) engine.resume();
  };

  const cancelQuit = () => {
    setQuitStep('closed');
    resumeIfNeeded();
  };

  const proceedWithLeave = () => {
    setQuitStep('closed');
    navigation.goBack();
  };

  const confirmSaveToHistory = () => {
    addHistoryEntry({
      id: generateId(),
      workout,
      completedAt: Date.now(),
      totalElapsedSeconds: engine.totalElapsed,
      repLogs,
    });
    proceedWithLeave();
  };

  const promptQuit = () => {
    // Still in the get-ready countdown: nothing has started, so there's nothing to confirm.
    if (engine.timerState === 'idle') {
      navigation.goBack();
      return;
    }
    wasRunningRef.current = engine.timerState === 'running';
    if (wasRunningRef.current) engine.pause();
    setQuitStep('confirmQuit');
  };

  // Keep the handler in sync with the latest closure (engine state, repLogs,
  // etc.) without tearing down and re-registering the BackHandler listener.
  const promptQuitRef = useRef(promptQuit);
  promptQuitRef.current = promptQuit;

  // Android hardware back button: show the quit confirmation instead of
  // leaving immediately.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      promptQuitRef.current();
      return true;
    });
    return () => subscription.remove();
  }, []);

  // Slide-to-go-back is the only way to leave this screen — there's no X
  // button. This is a hand-rolled left-edge swipe (PanResponder) rather than
  // the native stack's own interactive pop gesture (`gestureEnabled: true` +
  // `beforeRemove`): that combination proved unreliable on iOS, because the
  // native gesture can finish its visual transition before JS ever gets a
  // chance to intercept it and show the confirmation, leaving the screen in
  // a desynced state. Detecting the swipe ourselves means we only ever
  // navigate away after the confirmation is accepted, on both platforms.
  const EDGE_SWIPE_WIDTH = 24;
  const EDGE_SWIPE_THRESHOLD = 80;
  const swipeBackResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.pageX <= EDGE_SWIPE_WIDTH,
      onMoveShouldSetPanResponder: (_, gesture) =>
        gesture.x0 <= EDGE_SWIPE_WIDTH && gesture.dx > 12 && Math.abs(gesture.dy) < 40,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > EDGE_SWIPE_THRESHOLD) promptQuitRef.current();
      },
    })
  ).current;

  // Reset per-set weight entry whenever the phase advances
  useEffect(() => {
    setPendingWeight(null);
    setWeightInputVisible(false);
    setWeightInputValue('');
  }, [engine.currentPhaseIndex]);

  const goToCompletion = () => {
    if (completionNavigatedRef.current) return;
    completionNavigatedRef.current = true;
    navigation.replace('Completion', { totalElapsed: engine.totalElapsed, workout, repLogs });
  };

  // Finish: show the preloaded ad if it's ready, then move to the stats once it's
  // dismissed. If there's no ad or it can't show, go straight to the stats.
  useEffect(() => {
    if (engine.timerState !== 'completed' || completionStartedRef.current) return;
    completionStartedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (completionAd.status === 'loaded') {
      showingCompletionAdRef.current = true;
      completionAd.show();
    } else {
      goToCompletion();
    }
  }, [engine.timerState]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showingCompletionAdRef.current) return;
    if (completionAd.status === 'closed' || completionAd.status === 'error') goToCompletion();
  }, [completionAd.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!engine.currentPhase) {
    return (
      <View style={styles.blankScreen}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
        <Display style={styles.blankTitle}>No{'\n'}exercises</Display>
        <Body style={styles.blankBody}>
          Add a timed or rep-based exercise, and at least one set, before starting.
        </Body>
        <Pressable
          style={({ pressed }) => [styles.blankAction, pressed && styles.blankActionPressed]}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
        >
          <Label style={styles.blankActionLabel}>Go back</Label>
        </Pressable>
      </View>
    );
  }

  if (preStartSeconds !== null) {
    return (
      <View style={[styles.field, { backgroundColor: colors.accent }]}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.accent} />
        <View style={styles.statusBarSpacer} />
        <View style={styles.readyBody}>
          <Label style={styles.readyLabel}>Get ready</Label>
          <Display
            style={[styles.readyCount, { fontSize: countSize, lineHeight: Math.round(countSize * leading.tight) }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {preStartSeconds}
          </Display>
          <Display style={styles.readyNext} numberOfLines={2}>
            {engine.currentPhase.exerciseName}
          </Display>
        </View>
      </View>
    );
  }

  const isRest = engine.currentPhase.type === 'rest';
  const isRepPhase = !isRest && engine.currentPhase.mode === 'reps';
  const currentSetNumber = isRepPhase
    ? phases
        .slice(0, engine.currentPhaseIndex + 1)
        .filter(phase => phase.mode === 'reps' && phase.exerciseName === engine.currentPhase.exerciseName)
        .length
    : 0;
  const totalSetsForExercise = isRepPhase
    ? phases.filter(phase => phase.mode === 'reps' && phase.exerciseName === engine.currentPhase.exerciseName).length
    : 0;
  const totalExerciseCount = phases.filter(phase => phase.type === 'work').length;
  const completedExerciseCount = phases
    .slice(0, engine.currentPhaseIndex)
    .filter(phase => phase.type === 'work').length;
  const activeExerciseNumber = completedExerciseCount + 1;
  // Progress intentionally advances once a work exercise is complete, not during rests.
  const progressPercent = totalExerciseCount > 0
    ? (completedExerciseCount / totalExerciseCount) * 100
    : 0;
  const nextPhase = phases[engine.currentPhaseIndex + 1];
  // Every remaining work phase after the current position, each tagged with
  // its overall exercise number, for the "Up Next" drawer.
  const upcomingEntries = phases
    .map((phase, index) => ({ phase, index }))
    .filter(({ phase, index }) => phase.type === 'work' && index > engine.currentPhaseIndex)
    .map(({ phase, index }) => ({
      phase,
      exerciseNumber: 1 + phases.slice(0, index).filter(p => p.type === 'work').length,
    }));

  // Work phases run on an orange field with ink type; rest inverts to ink with
  // paper type, so a glance tells you which you are in.
  const field = isRest
    ? { bg: colors.ink, fg: colors.onInk, squareBg: colors.accent, squareFg: colors.ink }
    : { bg: colors.accent, fg: colors.ink, squareBg: colors.ink, squareFg: colors.accent };

  const totalRounds = Math.max(1, workout.rounds ?? 1);
  const perRound = Math.max(1, Math.ceil(totalExerciseCount / totalRounds));
  const currentRound = Math.min(totalRounds, Math.floor(completedExerciseCount / perRound) + 1);
  const exerciseInRound = Math.min(perRound, completedExerciseCount - (currentRound - 1) * perRound + 1);
  const positionLabel = totalRounds > 1
    ? `Rd ${currentRound}/${totalRounds} — Ex ${exerciseInRound}/${perRound}`
    : `Ex ${Math.min(activeExerciseNumber, totalExerciseCount)}/${totalExerciseCount}`;

  const nextMeta = nextPhase
    ? nextPhase.mode === 'reps'
      ? `×${nextPhase.reps}`
      : `${Math.ceil(nextPhase.duration)}s`
    : '';

  // Anton digits are ~0.52em wide and the line box is 0.8em tall; the count must
  // fit both the width left of the REPS label and the measured height.
  const repDigits = String(engine.currentPhase.reps ?? 0).length;
  const repFont = repArea
    ? Math.round(
        Math.max(
          96,
          Math.min(420, (repArea.w - 84) / (repDigits * 0.52), (repArea.h * 0.96) / 0.8),
        ),
      )
    : 180;

  const handleSaveWeight = () => {
    const parsed = parseFloat(weightInputValue);
    setPendingWeight(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
    setWeightInputVisible(false);
  };

  const handleRepDone = () => {
    if (!isRepPhase) return;
    const reps = engine.currentPhase.reps ?? 0;
    const weight = pendingWeight;

    setRepLogs(prev => [...prev, { exerciseName: engine.currentPhase.exerciseName, setNumber: currentSetNumber, reps, weight }]);
    setToastMessage(`${reps} reps${weight != null ? ` at ${weight} ${weightUnit}` : ''} logged`);
    setTimeout(() => setToastMessage(null), 2500);
    engine.completeRepPhase();
  };

  return (
    <View style={[styles.field, { backgroundColor: field.bg }]} {...swipeBackResponder.panHandlers}>
      <StatusBar barStyle={isRest ? 'light-content' : 'dark-content'} backgroundColor={field.bg} />
      <View style={styles.statusBarSpacer} />

      {toastMessage && (
        <View style={styles.toast} pointerEvents="none">
          <Label style={styles.toastText} numberOfLines={2}>{toastMessage}</Label>
        </View>
      )}

      {/* Top bar: quit, position, sound mode */}
      <View style={styles.topBar}>
        <Pressable
          style={[styles.square, { backgroundColor: field.squareBg }]}
          onPress={promptQuit}
          accessibilityRole="button"
          accessibilityLabel="Quit workout"
        >
          <CloseIcon color={field.squareFg} size={18} />
        </Pressable>
        <Label style={[styles.position, { color: field.fg }]} numberOfLines={1}>{positionLabel}</Label>
        <Pressable
          style={[styles.squareOutline, { borderColor: field.fg }]}
          onPress={cycleSoundMode}
          accessibilityRole="button"
          accessibilityLabel="Change countdown sound"
        >
          <SpeakerIcon color={field.fg} size={20} muted={soundMode === 'silent'} />
        </Pressable>
      </View>

      <View style={[styles.progressTrack, { borderColor: field.fg }]}>
        <View style={[styles.progressFill, { width: `${Math.min(100, progressPercent)}%`, backgroundColor: field.fg }]} />
      </View>

      {isRest ? (
        /* ── Rest ─────────────────────────────────────────────────────────── */
        <View style={styles.body}>
          <Label style={[styles.cue, { color: colors.accent }]}>Rest</Label>
          <Display
            style={[styles.timer, { color: field.fg, fontSize: timerSize, lineHeight: Math.round(timerSize * leading.tight) }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {Math.ceil(engine.remainingSeconds)}
          </Display>
          <Label style={[styles.unit, { color: field.fg }]}>Seconds</Label>

          <View style={[styles.nextBlock, { borderColor: colors.accent }]}>
            <Label style={[styles.nextBlockLabel, { color: colors.accent }]}>Next up</Label>
            <Display style={[styles.nextBlockName, { color: field.fg }]} numberOfLines={2} adjustsFontSizeToFit>
              {nextPhase?.exerciseName ?? 'Finish'}
            </Display>
            {nextMeta ? <Label style={[styles.nextBlockMeta, { color: field.fg }]}>{nextMeta}</Label> : null}
          </View>

          <View style={styles.restControls}>
            <Pressable
              style={[styles.adjustBtn, { borderColor: field.fg }]}
              onPress={() => engine.adjustRest(-5)}
              accessibilityRole="button"
              accessibilityLabel="Subtract five seconds of rest"
            >
              <Label style={[styles.adjustLabel, { color: field.fg }]}>−5s</Label>
            </Pressable>
            <Pressable
              style={[styles.adjustBtn, { borderColor: field.fg }]}
              onPress={() => engine.adjustRest(5)}
              accessibilityRole="button"
              accessibilityLabel="Add five seconds of rest"
            >
              <Label style={[styles.adjustLabel, { color: field.fg }]}>+5s</Label>
            </Pressable>
            <Pressable
              style={[styles.upNextBtn, { borderColor: field.fg }]}
              onPress={() => setUpNextVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="View upcoming exercises"
            >
              <Label style={[styles.adjustLabel, { color: field.fg }]}>All</Label>
              <ChevronIcon color={field.fg} size={12} direction="up" />
            </Pressable>
          </View>
        </View>
      ) : isRepPhase ? (
        /* ── Rep-based work ───────────────────────────────────────────────── */
        <View style={styles.body}>
          <Display
            style={[styles.exerciseName, { color: field.fg, fontSize: repNameSize, lineHeight: Math.round(repNameSize * leading.display) }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {engine.currentPhase.exerciseName}
          </Display>
          <Label style={[styles.cue, { color: field.fg }]}>
            Set {currentSetNumber} of {totalSetsForExercise}
          </Label>
          <View
            style={styles.repRow}
            onLayout={e => {
              const { width: w, height: h } = e.nativeEvent.layout;
              setRepArea(prev => (prev && Math.abs(prev.w - w) < 1 && Math.abs(prev.h - h) < 1 ? prev : { w, h }));
            }}
          >
            <Display
              style={[styles.repCount, { color: field.fg, fontSize: repFont, lineHeight: Math.round(repFont * 0.8) }]}
              numberOfLines={1}
            >
              {engine.currentPhase.reps}
            </Display>
            <Display style={[styles.repsUnit, { color: field.fg }]}>Reps</Display>
          </View>

          {weightInputVisible ? (
            <View style={styles.weightRow}>
              <TextInput
                style={[styles.weightInput, { borderColor: field.fg, color: field.fg }]}
                value={weightInputValue}
                onChangeText={setWeightInputValue}
                keyboardType="number-pad"
                placeholder={weightUnit.toUpperCase()}
                placeholderTextColor={colors.inkMuted}
                autoFocus
                selectionColor={field.fg}
              />
              <Pressable
                style={[styles.weightSave, { backgroundColor: field.squareBg }]}
                onPress={handleSaveWeight}
                accessibilityRole="button"
              >
                <Label style={[styles.weightSaveLabel, { color: field.squareFg }]}>Save</Label>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[styles.weightBtn, { borderColor: field.fg }]}
              onPress={() => {
                setWeightInputValue(pendingWeight != null ? String(pendingWeight) : '');
                setWeightInputVisible(true);
              }}
              accessibilityRole="button"
            >
              <Label style={[styles.weightBtnLabel, { color: field.fg }]}>
                {pendingWeight != null ? `Weight ${pendingWeight} ${weightUnit}` : '+ Add weight'}
              </Label>
            </Pressable>
          )}

          <Pressable
            style={({ pressed }) => [styles.doneBtn, pressed && styles.doneBtnPressed]}
            onPress={handleRepDone}
            accessibilityRole="button"
            accessibilityLabel="Mark set done"
          >
            <Display style={styles.doneLabel}>Done</Display>
          </Pressable>
        </View>
      ) : (
        /* ── Timed work ───────────────────────────────────────────────────── */
        <View style={styles.body}>
          <Display
            style={[styles.exerciseName, { color: field.fg, fontSize: nameSize, lineHeight: Math.round(nameSize * leading.display) }]}
            numberOfLines={2}
            adjustsFontSizeToFit
          >
            {engine.currentPhase.exerciseName}
          </Display>
          <Label style={[styles.cue, { color: field.fg }]}>
            Hold — {Math.round(engine.currentPhaseDuration)} sec
          </Label>
          <View style={styles.timerRow}>
            <Display
              style={[styles.timer, { color: field.fg, fontSize: timerSize, lineHeight: Math.round(timerSize * leading.tight) }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {Math.ceil(engine.remainingSeconds)}
            </Display>
            <Display style={[styles.timerUnit, { color: field.fg }]}>Sec{'\n'}Left</Display>
          </View>
        </View>
      )}

      {/* Footer: what's next, then the transport controls */}
      <View style={[styles.footer, { borderTopColor: field.fg, paddingBottom: insets.bottom }]}>
        {!isRest && (
          <View style={styles.nextRow}>
            <Label style={styles.nextLabel}>Next</Label>
            <Display style={styles.nextName} numberOfLines={1}>
              {nextPhase?.exerciseName ?? 'Finish'}
            </Display>
            {nextMeta ? <Display style={styles.nextMeta}>{nextMeta}</Display> : null}
          </View>
        )}
        <View style={styles.transport}>
          <Pressable
            style={({ pressed }) => [styles.transportSide, pressed && styles.transportPressed]}
            onPress={engine.skipToPreviousPhase}
            accessibilityRole="button"
            accessibilityLabel="Previous phase"
          >
            <SkipIcon color={colors.onInk} size={24} direction="left" />
          </Pressable>
          {!isRepPhase && (
            <Pressable
              style={({ pressed }) => [styles.transportMain, pressed && styles.transportPressed]}
              onPress={engine.timerState === 'paused' ? engine.resume : engine.pause}
              accessibilityRole="button"
              accessibilityLabel={engine.timerState === 'paused' ? 'Resume workout' : 'Pause workout'}
            >
              {engine.timerState === 'paused'
                ? <PlayIcon color={colors.accent} size={24} />
                : <PauseIcon color={colors.accent} size={24} />}
              <Display style={styles.transportLabel}>
                {engine.timerState === 'paused' ? 'Resume' : 'Pause'}
              </Display>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.transportSide,
              isRepPhase && styles.transportWide,
              pressed && styles.transportPressed,
            ]}
            onPress={engine.skipToNextPhase}
            accessibilityRole="button"
            accessibilityLabel="Skip to next phase"
          >
            <SkipIcon color={colors.onInk} size={24} direction="right" />
          </Pressable>
        </View>
      </View>

      <ConfirmDialog
        visible={quitStep === 'confirmQuit'}
        title="Quit workout?"
        message="Are you sure you want to quit this workout? Your progress in this session will end."
        onRequestClose={cancelQuit}
        actions={[
          { label: 'Quit', variant: 'destructive', onPress: () => setQuitStep('confirmSaveHistory') },
          { label: 'Keep Going', variant: 'neutral', onPress: cancelQuit },
        ]}
      />
      <ConfirmDialog
        visible={quitStep === 'confirmSaveHistory'}
        title="Save to history?"
        message="Do you want to save this partial session to your workout history?"
        onRequestClose={cancelQuit}
        actions={[
          { label: 'Save', variant: 'primary', onPress: confirmSaveToHistory },
          { label: "Don't Save", variant: 'destructive', onPress: proceedWithLeave },
        ]}
      />
      <UpNextDrawer
        visible={upNextVisible}
        onRequestClose={() => setUpNextVisible(false)}
        entries={upcomingEntries}
        totalExerciseCount={totalExerciseCount}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flex: 1,
  },
  statusBarSpacer: {
    height: band.statusBar,
  },
  // ── Top bar ───────────────────────────────────────────────────────────────
  topBar: {
    height: band.control + space.tight,
    paddingHorizontal: space.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.row,
  },
  square: {
    width: band.control,
    height: band.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squareOutline: {
    width: band.control,
    height: band.control,
    borderWidth: rule.heavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  position: {
    flex: 1,
    textAlign: 'center',
    fontSize: label.base,
    letterSpacing: tracking.label,
  },
  progressTrack: {
    marginHorizontal: space.gutter,
    height: space.tight,
    borderWidth: rule.heavy,
  },
  progressFill: {
    height: '100%',
  },
  // ── Body ──────────────────────────────────────────────────────────────────
  body: {
    flex: 1,
    paddingHorizontal: space.gutter,
    paddingTop: space.row,
    minHeight: 0,
  },
  exerciseName: {
    letterSpacing: tracking.display,
  },
  cue: {
    marginTop: space.tight,
    fontSize: label.cue,
    letterSpacing: tracking.wide,
  },
  timerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 0,
  },
  timer: {
    flexShrink: 1,
    fontVariant: ['tabular-nums'],
  },
  timerUnit: {
    fontSize: display.control,
    lineHeight: display.control,
    textAlign: 'right',
    alignSelf: 'flex-end',
    paddingBottom: space.block,
  },
  unit: {
    fontSize: label.cue,
    letterSpacing: tracking.wide,
  },
  // ── Rest ──────────────────────────────────────────────────────────────────
  nextBlock: {
    marginTop: space.block,
    borderWidth: rule.heavy,
    padding: space.row,
  },
  nextBlockLabel: {
    fontSize: label.micro,
    letterSpacing: tracking.wide,
  },
  nextBlockName: {
    marginTop: space.hair,
    fontSize: display.numeral,
    lineHeight: display.numeral * leading.snug,
  },
  nextBlockMeta: {
    marginTop: space.hair,
    fontSize: label.base,
    letterSpacing: tracking.label,
  },
  restControls: {
    flexDirection: 'row',
    gap: space.tight,
    marginTop: space.block,
    marginBottom: space.block,
  },
  adjustBtn: {
    width: 72,
    height: band.control + 8,
    borderWidth: rule.heavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upNextBtn: {
    flex: 1,
    height: band.control + 8,
    borderWidth: rule.heavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.tight,
  },
  adjustLabel: {
    fontSize: label.base,
    letterSpacing: tracking.label,
  },
  // ── Reps ──────────────────────────────────────────────────────────────────
  repRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 120,
  },
  repCount: {
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  repsUnit: {
    fontSize: display.control,
    lineHeight: display.control,
    alignSelf: 'flex-end',
    paddingBottom: space.block,
  },
  weightBtn: {
    alignSelf: 'flex-start',
    minHeight: band.control,
    paddingHorizontal: space.block,
    justifyContent: 'center',
    borderWidth: rule.heavy,
    marginBottom: space.row,
  },
  weightBtnLabel: {
    fontSize: label.base,
    letterSpacing: tracking.label,
  },
  weightRow: {
    flexDirection: 'row',
    gap: space.tight,
    marginBottom: space.row,
  },
  weightInput: {
    width: 120,
    height: band.control,
    borderWidth: rule.heavy,
    textAlign: 'center',
    fontFamily: font.bold,
    fontSize: label.cue,
    padding: 0,
  },
  weightSave: {
    height: band.control,
    paddingHorizontal: space.block,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weightSaveLabel: {
    fontSize: label.base,
    letterSpacing: tracking.label,
  },
  doneBtn: {
    height: 76,
    marginBottom: space.block,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnPressed: {
    backgroundColor: colors.inkPress,
  },
  doneLabel: {
    color: colors.onInk,
    fontSize: display.control,
    lineHeight: display.control * leading.snug,
    letterSpacing: tracking.label,
  },
  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    backgroundColor: colors.ink,
    borderTopWidth: rule.heavy,
  },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
    paddingHorizontal: space.gutter,
    paddingVertical: space.row,
    borderBottomWidth: 1,
    borderBottomColor: colors.inkDivider,
  },
  nextLabel: {
    color: colors.accent,
    fontSize: label.micro,
    letterSpacing: tracking.wide,
  },
  nextName: {
    flex: 1,
    color: colors.onInk,
    fontSize: display.wordmark,
    lineHeight: display.wordmark * leading.snug,
  },
  nextMeta: {
    color: colors.onInk,
    fontSize: display.wordmark,
    lineHeight: display.wordmark * leading.snug,
  },
  transport: {
    flexDirection: 'row',
    height: band.transport,
  },
  transportSide: {
    width: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transportWide: {
    flex: 1,
  },
  transportMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.row,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.inkDivider,
  },
  transportPressed: {
    backgroundColor: colors.inkPress,
  },
  transportLabel: {
    color: colors.onInk,
    fontSize: display.control,
    lineHeight: display.control * leading.snug,
    letterSpacing: tracking.label,
  },
  // ── Toast ─────────────────────────────────────────────────────────────────
  toast: {
    position: 'absolute',
    top: band.statusBar + space.tight,
    left: space.gutter,
    right: space.gutter,
    zIndex: 10,
    backgroundColor: colors.ink,
    paddingVertical: space.row,
    paddingHorizontal: space.block,
  },
  toastText: {
    color: colors.accent,
    fontSize: label.small,
    letterSpacing: tracking.label,
    textAlign: 'center',
  },
  // ── Get ready ─────────────────────────────────────────────────────────────
  readyBody: {
    flex: 1,
    paddingHorizontal: space.gutter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyLabel: {
    fontSize: label.cue,
    letterSpacing: tracking.wide,
  },
  readyCount: {
    fontVariant: ['tabular-nums'],
  },
  readyNext: {
    fontSize: display.numeral,
    lineHeight: display.numeral * leading.snug,
    textAlign: 'center',
  },
  // ── No exercises ──────────────────────────────────────────────────────────
  blankScreen: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingHorizontal: space.gutter,
    justifyContent: 'center',
    gap: space.block,
  },
  blankTitle: {
    fontSize: 56,
    lineHeight: 56 * leading.display,
    letterSpacing: tracking.display,
  },
  blankBody: {
    fontSize: label.base,
    lineHeight: label.base * 1.5,
    color: colors.inkMuted,
  },
  blankAction: {
    alignSelf: 'flex-start',
    minHeight: band.control,
    paddingHorizontal: space.block,
    justifyContent: 'center',
    borderWidth: rule.heavy,
    borderColor: colors.ink,
  },
  blankActionPressed: {
    backgroundColor: colors.rowPress,
  },
  blankActionLabel: {
    fontSize: label.small,
    letterSpacing: tracking.wide,
  },
});
