import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTimerEngine } from '../useTimerEngine';
import { useAudio } from '../useAudio';
import { expandWorkout } from '../workoutLogic';

type Props = NativeStackScreenProps<RootStackParamList, 'ActiveSession'>;

export function ActiveSessionScreen({ route, navigation }: Props) {
  const { workout } = route.params;
  const phases = useMemo(() => expandWorkout(workout), [workout]);
  
  const { playBeep } = useAudio();
  const engine = useTimerEngine(phases, playBeep);

  // Auto-start on mount
  useEffect(() => {
    engine.start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle completion
  useEffect(() => {
    if (engine.timerState === 'completed') {
      navigation.replace('Completion', { totalElapsed: engine.totalElapsed, workout });
    }
  }, [engine.timerState, engine.totalElapsed, navigation]);

  if (!engine.currentPhase) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptySessionTitle}>No timed exercises</Text>
        <Text style={styles.emptySessionText}>Add a work duration and at least one set before starting.</Text>
        <TouchableOpacity style={styles.emptySessionButton} onPress={() => navigation.goBack()}>
          <Text style={styles.emptySessionButtonText}>GO BACK</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isRest = engine.currentPhase.type === 'rest';
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

  return (
    <View style={styles.container}>
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

      <View style={styles.countdownContainer}>
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
            {nextPhase ? `${Math.ceil(nextPhase.duration)}s ${nextPhase.type === 'work' ? 'Work' : 'Rest'}` : 'Done'}
          </Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity style={styles.secondaryControl} onPress={engine.skipToPreviousPhase} accessibilityLabel="Previous phase">
            <Text style={styles.controlIcon}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.primaryControl}
            onPress={engine.timerState === 'paused' ? engine.resume : engine.pause}
            accessibilityLabel={engine.timerState === 'paused' ? 'Resume workout' : 'Pause workout'}
          >
            <Text style={styles.pauseIcon}>{engine.timerState === 'paused' ? '▶' : 'Ⅱ'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryControl} onPress={engine.skipToNextPhase} accessibilityLabel="Skip to next phase">
            <Text style={styles.controlIcon}>▶|</Text>
          </TouchableOpacity>
        </View>
      </View>
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
  controlIcon: {
    color: '#FFFFFF',
    fontFamily: 'monospace',
    fontSize: 20,
    fontWeight: '700',
  },
  pauseIcon: {
    color: '#09090A',
    fontSize: 22,
    fontWeight: '800',
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
});
