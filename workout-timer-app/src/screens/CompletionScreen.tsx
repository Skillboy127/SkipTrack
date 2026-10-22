import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView, StatusBar } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList, WeightUnit } from '../types';
import { addHistoryEntry, loadWeightUnit } from '../storage';
import { ExerciseLogCard, groupRepLogs } from '../components/ExerciseLogCard';
import { AdBanner } from '../components/AdBanner';
import { Display, Label } from '../components/PosterText';
import { band, colors, display, label, leading, rule, space, tracking } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Completion'>;

const generateId = () => Math.random().toString(36).substring(2, 9);

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export function CompletionScreen({ route, navigation }: Props) {
  const { totalElapsed, workout, repLogs = [] } = route.params;
  const groupedLogs = useMemo(() => groupRepLogs(repLogs), [repLogs]);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('lb');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadWeightUnit().then(setWeightUnit);
  }, []);

  // Record this session to history exactly once, regardless of re-renders.
  const savedToHistoryRef = useRef(false);
  useEffect(() => {
    if (savedToHistoryRef.current) return;
    savedToHistoryRef.current = true;
    addHistoryEntry({
      id: generateId(),
      workout,
      completedAt: Date.now(),
      totalElapsedSeconds: totalElapsed,
      repLogs,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exerciseCount = workout.exercises.length;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.accent} />
      <View style={styles.statusBarSpacer} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Display style={styles.hero} numberOfLines={1} adjustsFontSizeToFit>Done</Display>
        <Label style={styles.workoutName} numberOfLines={2}>{workout.name || 'Workout'}</Label>

        <View style={styles.timeBlock}>
          <Display style={styles.time} numberOfLines={1} adjustsFontSizeToFit>{formatTime(totalElapsed)}</Display>
          <Label style={styles.timeLabel}>Total time</Label>
        </View>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Display style={styles.statValue}>{exerciseCount}</Display>
            <Label style={styles.statLabel}>Exercise{exerciseCount !== 1 ? 's' : ''}</Label>
          </View>
          {workout.rounds && workout.rounds > 1 ? (
            <View style={[styles.stat, styles.statDivider]}>
              <Display style={styles.statValue}>{workout.rounds}</Display>
              <Label style={styles.statLabel}>Rounds</Label>
            </View>
          ) : null}
          {groupedLogs.length > 0 && (
            <View style={[styles.stat, styles.statDivider]}>
              <Display style={styles.statValue}>{repLogs.length}</Display>
              <Label style={styles.statLabel}>Sets logged</Label>
            </View>
          )}
        </View>

        {groupedLogs.length > 0 && (
          <View style={styles.logs}>
            <Label style={styles.logsTitle}>Sets logged</Label>
            {groupedLogs.map(group => (
              <ExerciseLogCard
                key={group.exerciseName}
                exerciseName={group.exerciseName}
                sets={group.sets}
                weightUnit={weightUnit}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Separated from the Done button by its own rules and the footer padding. */}
      <AdBanner />

      <View style={[styles.footer, { paddingBottom: space.row + insets.bottom }]}>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          onPress={() => navigation.popToTop()}
          accessibilityRole="button"
          accessibilityLabel="Finish and go to workouts"
        >
          <Display style={styles.ctaLabel}>Done</Display>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.accent,
  },
  statusBarSpacer: {
    height: band.statusBar,
  },
  scroll: {
    paddingHorizontal: space.gutter,
    paddingTop: space.tight,
    paddingBottom: space.block,
  },
  hero: {
    fontSize: 150,
    lineHeight: Math.round(150 * leading.display),
    letterSpacing: tracking.display,
  },
  workoutName: {
    marginTop: space.hair,
    fontSize: label.cue,
    letterSpacing: tracking.label,
  },
  timeBlock: {
    marginTop: space.block,
    borderTopWidth: rule.heavy,
    borderBottomWidth: rule.heavy,
    borderColor: colors.ink,
    paddingVertical: space.row,
  },
  time: {
    fontSize: 104,
    lineHeight: Math.round(104 * leading.tight),
    fontVariant: ['tabular-nums'],
  },
  timeLabel: {
    marginTop: space.hair,
    fontSize: label.base,
    letterSpacing: tracking.wide,
  },
  statRow: {
    flexDirection: 'row',
    marginTop: space.block,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
  },
  stat: {
    flex: 1,
    padding: space.row,
  },
  statDivider: {
    borderLeftWidth: rule.heavy,
    borderLeftColor: colors.ink,
  },
  statValue: {
    fontSize: display.stat,
    lineHeight: display.stat * leading.snug,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    marginTop: space.hair,
    fontSize: label.micro,
  },
  logs: {
    marginTop: space.block,
    gap: space.tight,
  },
  logsTitle: {
    fontSize: label.micro,
    marginBottom: space.hair,
  },
  footer: {
    paddingTop: space.block,
    paddingHorizontal: space.gutter,
    backgroundColor: colors.accent,
    borderTopWidth: rule.heavy,
    borderTopColor: colors.ink,
  },
  cta: {
    height: band.cta,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: {
    backgroundColor: colors.inkPress,
  },
  ctaLabel: {
    color: colors.onInk,
    fontSize: display.cta,
    lineHeight: display.cta * leading.snug,
    letterSpacing: 0.6,
  },
});
