import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, RepSetLog } from '../types';
import { useTimerEngine } from '../useTimerEngine';
import { useAudio } from '../useAudio';
import { useSpeech } from '../useSpeech';
import { expandWorkout } from '../workoutLogic';
import { addHistoryEntry, loadTtsEnabled } from '../storage';
import { SkipIcon, PlayIcon, PauseIcon } from '../components/WorkoutIcons';
import { ConfirmDialog } from '../components/ConfirmDialog';

type Props = NativeStackScreenProps<RootStackParamList, 'ActiveSession'>;
type QuitStep = 'closed' | 'confirmQuit' | 'confirmSaveHistory';
type NavAction = Readonly<{ type: string; payload?: object; source?: string; target?: string }>;

const generateId = () => Math.random().toString(36).substring(2, 9);

export function ActiveSessionScreen({ route, navigation }: Props) {
  const { workout } = route.params;
  const phases = useMemo(() => expandWorkout(workout), [workout]);

  const { playBeep } = useAudio();
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const { speak, speakCountdown } = useSpeech(ttsEnabled);
  const engine = useTimerEngine(phases, playBeep, speakCountdown);

  const [repLogs, setRepLogs] = useState<RepSetLog[]>([]);
  const [pendingWeight, setPendingWeight] = useState<number | null>(null);
  const [weightInputVisible, setWeightInputVisible] = useState(false);
  const [weightInputValue, setWeightInputValue] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [quitStep, setQuitStep] = useState<QuitStep>('closed');
  // Seconds left in the "get ready" countdown shown before the workout timer
  // actually starts; null once it's finished and the real session has begun.
  const PRE_START_SECONDS = 5;
  const PRE_START_WORDS: Record<number, string> = { 5: 'five', 4: 'four', 3: 'three', 2: 'two', 1: 'one' };
  const [preStartSeconds, setPreStartSeconds] = useState<number | null>(PRE_START_SECONDS);

  // Load the user's TTS preference (defaults to on)
  useEffect(() => {
    loadTtsEnabled().then(setTtsEnabled);
  }, []);

  // Give the user a spoken "get ready" countdown before the first phase's
  // timer actually starts, so there's time to get into position.
  useEffect(() => {
    speak(PRE_START_WORDS[PRE_START_SECONDS]);
    const interval = setInterval(() => {
      setPreStartSeconds(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return null;
        }
        const next = prev - 1;
        speak(PRE_START_WORDS[next] ?? String(next));
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Start the actual workout timer once the "get ready" countdown finishes
  useEffect(() => {
    if (preStartSeconds === null) {
      engine.start();
    }
  }, [preStartSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Announce the next exercise as soon as a rest phase begins, giving the full
  // rest duration to hear it — not just the last second of the countdown.
  useEffect(() => {
    if (!engine.currentPhase || engine.currentPhase.type !== 'rest') return;
    const upcoming = phases[engine.currentPhaseIndex + 1];
    if (upcoming?.exerciseName) {
      speak(`Next up, ${upcoming.exerciseName}`);
    }
  }, [engine.currentPhaseIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set right before any navigation away from this screen that we initiated
  // ourselves (finishing the workout), so the quit-confirmation guard below
  // lets it through instead of intercepting it.
  const allowLeaveRef = useRef(false);
  const wasRunningRef = useRef(false);
  const pendingNavActionRef = useRef<NavAction | null>(null);

  const resumeIfNeeded = () => {
    if (wasRunningRef.current) engine.resume();
  };

  const cancelQuit = () => {
    setQuitStep('closed');
    pendingNavActionRef.current = null;
    resumeIfNeeded();
  };

  const proceedWithLeave = () => {
    const action = pendingNavActionRef.current;
    setQuitStep('closed');
    pendingNavActionRef.current = null;
    if (!action) return;
    allowLeaveRef.current = true;
    navigation.dispatch(action);
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

  const promptQuit = (action: NavAction) => {
    wasRunningRef.current = engine.timerState === 'running';
    if (wasRunningRef.current) engine.pause();
    pendingNavActionRef.current = action;
    setQuitStep('confirmQuit');
  };

  // Keep the listener in sync with the latest closure (engine state, repLogs, etc.)
  // without tearing down and re-registering it on every render.
  const promptQuitRef = useRef(promptQuit);
  promptQuitRef.current = promptQuit;

  // Intercept any attempt to leave this screen — the Android hardware back
  // button, an edge-swipe back gesture, or a header back action — and show
  // the quit confirmation instead, unless we ourselves triggered the leave.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current) return;
      e.preventDefault();
      promptQuitRef.current(e.data.action);
    });
    return unsubscribe;
  }, [navigation]);

  // Reset per-set weight entry whenever the phase advances
  useEffect(() => {
    setPendingWeight(null);
    setWeightInputVisible(false);
    setWeightInputValue('');
  }, [engine.currentPhaseIndex]);

  // Handle completion
  useEffect(() => {
    if (engine.timerState === 'completed') {
      allowLeaveRef.current = true;
      navigation.replace('Completion', { totalElapsed: engine.totalElapsed, workout, repLogs });
    }
  }, [engine.timerState, engine.totalElapsed, navigation, workout, repLogs]);

  if (!engine.currentPhase) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptySessionTitle}>No exercises</Text>
        <Text style={styles.emptySessionText}>Add a timed or rep-based exercise and at least one set before starting.</Text>
        <TouchableOpacity
          style={styles.emptySessionButton}
          onPress={() => {
            allowLeaveRef.current = true;
            navigation.goBack();
          }}
        >
          <Text style={styles.emptySessionButtonText}>GO BACK</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (preStartSeconds !== null) {
    return (
      <View style={styles.container}>
        <View style={styles.getReadyContainer}>
          <Text style={styles.getReadyLabel}>GET READY</Text>
          <Text style={styles.getReadyCount}>{preStartSeconds}</Text>
          <Text style={styles.getReadyHint} numberOfLines={2}>
            {engine.currentPhase.exerciseName} starts in...
          </Text>
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
  const phaseAccent = isRest ? '#6B9EFA' : '#CCFF00';
  const phaseProgress = engine.currentPhaseDuration > 0
     ? Math.min(1, Math.max(0, (engine.currentPhaseDuration - engine.remainingSeconds) / engine.currentPhaseDuration))
    : 0;

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
    setToastMessage(`Nice work – ${reps} reps${weight != null ? ` at ${weight} lb` : ''} logged!`);
    setTimeout(() => setToastMessage(null), 2500);
    engine.completeRepPhase();
  };

  return (
    <View style={styles.container}>
      {toastMessage && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}
      <View style={styles.statusBarSpacer} />
      <View style={styles.progressTracker}>
        <View style={styles.progressLabels}>
          <Text style={styles.workoutTag}>{workout.name || 'WORKOUT'}</Text>
          {!isRest && (
            <Text style={styles.progressPercentage}>
              EXERCISE {Math.min(activeExerciseNumber, totalExerciseCount)} OF {totalExerciseCount}
            </Text>
          )}
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(100, progressPercent)}%` }]} />
        </View>
      </View>

      <View style={styles.currentExerciseBox}>
        <Text style={styles.exerciseName} numberOfLines={2}>
          {isRest ? 'Rest' : engine.currentPhase.exerciseName}
        </Text>
      </View>

      <View style={[styles.countdownContainer, isRepPhase && styles.repContainer]}>
        {isRepPhase ? (
          <View style={styles.repContent}>
            <Text style={styles.repCount}>{engine.currentPhase.reps}</Text>
            <Text style={styles.secondsUnit}>REPS</Text>
          </View>
        ) : (
          <View style={styles.timerRing}>
            <View style={[styles.timerRingBackground, { borderColor: isRest ? 'rgba(107, 158, 250, 0.15)' : 'rgba(204, 255, 0, 0.15)' }]} />
            <View
              style={[
                styles.timerRingProgress,
                {
                  borderColor: phaseAccent,
                  opacity: 0.3 + (phaseProgress * 0.7),
                },
              ]}
            />
            <View style={styles.digitsGroup}>
              <Text style={[styles.timer, isRest && styles.timerRest]}>{Math.ceil(engine.remainingSeconds)}</Text>
              <Text style={styles.secondsUnit}>{isRest ? 'SECONDS REST' : 'SECONDS LEFT'}</Text>
            </View>
          </View>
        )}
        {isRest && (
          <View style={styles.restAdjustments}>
            <TouchableOpacity style={styles.adjustBtn} onPress={() => engine.adjustRest(-5)} accessibilityLabel="Subtract five seconds">
              <Text style={styles.adjustBtnText}>-5s</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.adjustBtn} onPress={() => engine.adjustRest(5)} accessibilityLabel="Add five seconds">
              <Text style={styles.adjustBtnText}>+5s</Text>
            </TouchableOpacity>
          </View>
        )}
        {isRest && <Text style={styles.adjustmentCue}>Tweak rest time (+/- 5s) directly during rest phase</Text>}
        {isRepPhase && (
          <View style={styles.repActionsGroup}>
            {weightInputVisible ? (
              <View style={styles.weightInputRow}>
                <TextInput
                  style={styles.weightInput}
                  value={weightInputValue}
                  onChangeText={setWeightInputValue}
                  keyboardType="number-pad"
                  placeholder="lb"
                  placeholderTextColor="#475569"
                  autoFocus
                  selectionColor="#CCFF00"
                />
                <TouchableOpacity style={styles.weightSaveBtn} onPress={handleSaveWeight}>
                  <Text style={styles.weightSaveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.addWeightButton}
                onPress={() => {
                  setWeightInputValue(pendingWeight != null ? String(pendingWeight) : '');
                  setWeightInputVisible(true);
                }}
              >
                <Text style={styles.addWeightButtonText}>
                  {pendingWeight != null ? `Weight: ${pendingWeight} lb` : '+ Add Weight'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.repDoneButton} onPress={handleRepDone}>
              <Text style={styles.repDoneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.sessionFooter}>
        <View style={styles.nextContainer}>
          <View style={styles.nextLeft}>
            <Text style={styles.nextLabel}>UP NEXT</Text>
            <Text style={styles.nextName} numberOfLines={1}>
              {nextPhase?.exerciseName || 'Complete'}
            </Text>
          </View>
          <Text style={styles.nextDuration}>
            {nextPhase
              ? nextPhase.mode === 'reps'
                ? `${nextPhase.reps} Reps`
                : `${Math.ceil(nextPhase.duration)}s ${nextPhase.type === 'work' ? 'Work' : 'Rest'}`
              : 'Done'}
          </Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity style={styles.secondaryControl} onPress={engine.skipToPreviousPhase} accessibilityLabel="Previous phase">
            <SkipIcon color="#FFFFFF" size={18} direction="left" />
          </TouchableOpacity>
          {!isRepPhase && (
            <TouchableOpacity
              style={styles.primaryControl}
              onPress={engine.timerState === 'paused' ? engine.resume : engine.pause}
              accessibilityLabel={engine.timerState === 'paused' ? 'Resume workout' : 'Pause workout'}
            >
              {engine.timerState === 'paused' ? <PlayIcon color="#09090A" size={26} /> : <PauseIcon color="#09090A" size={26} />}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.secondaryControl} onPress={engine.skipToNextPhase} accessibilityLabel="Skip to next phase">
            <SkipIcon color="#FFFFFF" size={18} direction="right" />
          </TouchableOpacity>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090A',
  },
  statusBarSpacer: {
    height: 44,
  },
  progressTracker: {
    height: 55,
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 4,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  workoutTag: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
    textTransform: 'uppercase',
    maxWidth: '45%',
  },
  progressPercentage: {
    color: '#CCFF00',
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#1A1A1E',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: '#CCFF00',
  },
  currentExerciseBox: {
    minHeight: 92,
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseName: {
    width: '100%',
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 36,
    textAlign: 'center',
  },
  countdownContainer: {
    flex: 1,
    minHeight: 433,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repContainer: {
    gap: 28,
  },
  repContent: {
    alignItems: 'center',
  },
  repCount: {
    color: '#CCFF00',
    fontFamily: 'monospace',
    fontSize: 100,
    fontWeight: '800',
    lineHeight: 100,
    fontVariant: ['tabular-nums'],
  },
  repActionsGroup: {
    width: '82%',
    alignItems: 'center',
    gap: 14,
  },
  addWeightButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1F1F24',
    backgroundColor: '#121214',
  },
  addWeightButtonText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  weightInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  weightInput: {
    width: 90,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1F1F24',
    backgroundColor: '#121214',
    color: '#FFFFFF',
    fontFamily: 'monospace',
    fontSize: 16,
    textAlign: 'center',
  },
  weightSaveBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#1F1F24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weightSaveBtnText: {
    color: '#CCFF00',
    fontSize: 14,
    fontWeight: '700',
  },
  repDoneButton: {
    width: '100%',
    height: 68,
    borderRadius: 14,
    backgroundColor: '#CCFF00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  repDoneButtonText: {
    color: '#09090A',
    fontSize: 24,
    fontWeight: '800',
  },
  toast: {
    position: 'absolute',
    top: 100,
    left: 24,
    right: 24,
    zIndex: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(204, 255, 0, 0.95)',
    alignItems: 'center',
  },
  toastText: {
    color: '#09090A',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  timerRing: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerRingBackground: {
    ...StyleSheet.absoluteFill,
    borderWidth: 8,
    borderColor: '#1A1A1E',
    borderRadius: 120,
  },
  timerRingProgress: {
    ...StyleSheet.absoluteFill,
    borderWidth: 8,
    borderColor: 'transparent',
    borderRadius: 120,
  },
  digitsGroup: {
    alignItems: 'center',
  },
  timer: {
    color: '#CCFF00',
    fontFamily: 'monospace',
    fontSize: 100,
    fontWeight: '800',
    lineHeight: 100,
    fontVariant: ['tabular-nums'],
  },
  timerRest: {
    color: '#6B9EFA',
  },
  secondsUnit: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    textTransform: 'uppercase',
  },
  restAdjustments: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '50%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  adjustmentCue: {
    position: 'absolute',
    bottom: 8,
    width: '100%',
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
  },
  adjustBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1F1F24',
    backgroundColor: '#121214',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjustBtnText: {
    color: '#94A3B8',
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
  },
  sessionFooter: {
    height: 204,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 16,
    backgroundColor: '#09090A',
    borderTopWidth: 1,
    borderTopColor: '#1F1F24',
  },
  nextContainer: {
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#121214',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nextLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  nextLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  nextName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  nextDuration: {
    color: '#94A3B8',
    fontFamily: 'monospace',
    fontSize: 13,
  },
  controls: {
    flexDirection: 'row',
    height: 72,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  secondaryControl: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#121214',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryControl: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#CCFF00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySessionTitle: {
    marginTop: 180,
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySessionText: {
    marginTop: 12,
    paddingHorizontal: 32,
    color: '#94A3B8',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  emptySessionButton: {
    alignSelf: 'center',
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#CCFF00',
  },
  emptySessionButtonText: {
    color: '#09090A',
    fontSize: 14,
    fontWeight: '700',
  },
  getReadyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 20,
  },
  getReadyLabel: {
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  getReadyCount: {
    color: '#CCFF00',
    fontFamily: 'monospace',
    fontSize: 140,
    fontWeight: '800',
    lineHeight: 140,
    fontVariant: ['tabular-nums'],
  },
  getReadyHint: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
});
