import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, StatusBar } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronIcon, PlayIcon } from '../components/WorkoutIcons';
import { noteTransition } from '../ads/interstitialManager';
import { RootStackParamList, Workout } from '../types';
import { loadCountdownSoundMode, loadWorkouts } from '../storage';
import { primeSpeechEngine } from '../useSpeech';
import { getWorkoutDuration, isRepExercise } from '../workoutLogic';
import { Display, Label } from '../components/PosterText';
import { band, colors, display, label, leading, rule, space, tracking } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkoutPreview'>;

export function WorkoutPreviewScreen({ route, navigation }: Props) {
  const [workout, setWorkout] = useState<Workout>(route.params.workout);
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    noteTransition('preview');
  }, []);

  // Re-read the saved copy whenever this screen regains focus, so changes made
  // in the editor show up here and are what Start actually runs.
  useEffect(() => {
    if (!isFocused) return;
    loadWorkouts().then(workouts => {
      const latest = workouts.find(w => w.id === route.params.workout.id);
      if (latest) setWorkout(latest);
    });
  }, [isFocused, route.params.workout.id]);

  // Give the TTS engine a head start while the user is still reviewing the
  // workout, so the "get ready" countdown's first word doesn't lag once they
  // actually tap Start.
  useEffect(() => {
    loadCountdownSoundMode().then(mode => {
      if (mode === 'speech') primeSpeechEngine();
    });
  }, []);

  const onStart = () => {
    navigation.replace('ActiveSession', { workout });
  };

  // Pass the current copy too, so a workout that's no longer in the library
  // (opened via History's Repeat) still opens populated instead of blank.
  const handleEdit = () => {
    navigation.navigate('WorkoutEditor', { workoutId: workout.id, draftWorkout: workout });
  };

  const totalMinutes = Math.max(1, Math.round(getWorkoutDuration(workout) / 60));
  const rounds = workout.rounds && workout.rounds > 1 ? ` · ${workout.rounds} Rounds` : '';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
      <View style={styles.statusBarSpacer} />

      <View style={styles.topBar}>
        <Pressable
          style={({ pressed }) => [styles.square, pressed && styles.squarePressed]}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ChevronIcon color={colors.ink} size={18} direction="left" />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.editBtn, pressed && styles.squarePressed]}
          onPress={handleEdit}
          accessibilityRole="button"
          accessibilityLabel="Edit workout"
        >
          <Label style={styles.editLabel}>Edit</Label>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Display style={styles.hero} numberOfLines={3} adjustsFontSizeToFit>{workout.name}</Display>
        <Label style={styles.meta}>
          {workout.exercises.length} Exercise{workout.exercises.length !== 1 ? 's' : ''}{rounds} · ~{totalMinutes} Min
        </Label>

        <View style={styles.list}>
          {workout.exercises.map((ex, index) => (
            <View key={ex.id || index} style={styles.row}>
              <View style={styles.numeralCol}>
                <Display style={styles.numeral}>{String(index + 1).padStart(2, '0')}</Display>
              </View>
              <View style={styles.rowBody}>
                <Display style={styles.rowTitle} numberOfLines={2}>{ex.name}</Display>
                <View style={styles.chips}>
                  <View style={styles.chip}>
                    <Label style={styles.chipText}>
                      {isRepExercise(ex) ? `${ex.reps} Reps` : `${ex.workSeconds}s Work`}
                    </Label>
                  </View>
                  {ex.restSeconds > 0 && (
                    <View style={styles.chip}>
                      <Label style={styles.chipText}>{ex.restSeconds}s Rest</Label>
                    </View>
                  )}
                  {ex.sets > 1 && (
                    <View style={styles.chip}>
                      <Label style={styles.chipText}>×{ex.sets}</Label>
                    </View>
                  )}
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <Pressable
        style={({ pressed }) => [styles.cta, { marginBottom: space.row + insets.bottom }, pressed && styles.ctaPressed]}
        onPress={onStart}
        accessibilityRole="button"
        accessibilityLabel="Start workout"
      >
        <Display style={styles.ctaLabel}>Start workout</Display>
        <View style={styles.ctaSquare}>
          <PlayIcon color={colors.ink} size={20} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  statusBarSpacer: {
    height: band.statusBar,
  },
  topBar: {
    paddingHorizontal: space.gutter,
    paddingTop: space.tight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  square: {
    width: band.control,
    height: band.control,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squarePressed: {
    backgroundColor: colors.rowPress,
  },
  editBtn: {
    minHeight: band.control,
    paddingHorizontal: space.block,
    justifyContent: 'center',
    borderWidth: rule.heavy,
    borderColor: colors.ink,
  },
  editLabel: {
    fontSize: label.small,
    letterSpacing: tracking.wide,
  },
  scroll: {
    paddingTop: space.row,
    paddingBottom: space.block,
  },
  hero: {
    paddingHorizontal: space.gutter,
    fontSize: display.hero,
    lineHeight: Math.round(display.hero * leading.display),
    letterSpacing: tracking.display,
  },
  meta: {
    paddingHorizontal: space.gutter,
    marginTop: space.tight,
    fontSize: label.base,
  },
  list: {
    marginTop: space.block,
    borderBottomWidth: rule.heavy,
    borderBottomColor: colors.ink,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: rule.heavy,
    borderTopColor: colors.ink,
    minHeight: band.row,
  },
  numeralCol: {
    width: band.numeralCol,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numeral: {
    fontSize: display.numeral,
    lineHeight: display.numeral * leading.snug,
    color: colors.inkMuted,
  },
  rowBody: {
    flex: 1,
    paddingVertical: space.tight,
    paddingRight: space.gutter,
    justifyContent: 'center',
    minWidth: 0,
  },
  rowTitle: {
    fontSize: display.entryTitle,
    lineHeight: display.entryTitle * leading.snug,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.hair + 2,
    marginTop: space.hair + 2,
  },
  chip: {
    borderWidth: rule.thin,
    borderColor: colors.ink,
    paddingHorizontal: space.tight,
    paddingVertical: 2,
  },
  chipText: {
    fontSize: label.micro,
  },
  cta: {
    height: band.cta,
    marginHorizontal: space.gutter,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space.gutter,
    paddingRight: space.row,
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
  ctaSquare: {
    width: 34,
    height: 34,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
