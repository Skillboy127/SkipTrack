import React, { memo, useCallback, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, StatusBar, PanResponder, Animated, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { noteTransition, onEditorSaved } from '../ads/interstitialManager';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList, Workout, Exercise } from '../types';
import { loadWorkouts, saveWorkout } from '../storage';
import { PencilIcon, TrashIcon, DragHandleIcon, ChevronIcon, CheckIcon, RotatingDumbbellIcon } from '../components/WorkoutIcons';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ReorderableList, ReorderItemInfo, ReorderScrollView } from '../components/ReorderableList';
import { band, colors, display, font, label, leading, rule, space, tracking } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkoutEditor'>;

const generateId = () => Math.random().toString(36).substring(2, 9);
const DEFAULT_REST_BETWEEN_ROUNDS = 90;

// Deliberately looser than the engine's rule: a row stays in REPS mode while its
// reps field is being edited (even momentarily at 0), and save validation catches
// anything that isn't actually runnable.
function isRepBased(ex: { reps?: number | null; workSeconds: number }): boolean {
  return ex.reps != null && ex.workSeconds <= 0;
}

const snapshotOf = (name: string, exercises: Exercise[], rounds: number, restBetweenRoundsSeconds: number | null) =>
  JSON.stringify({ name, exercises, rounds, restBetweenRoundsSeconds });

type ExerciseRowProps = {
  exercise: Exercise;
  index: number;
  onUpdate: (id: string, field: keyof Exercise, value: string | number | null) => void;
  onDelete: (id: string) => void;
  dragProps: ReorderItemInfo<Exercise>['dragProps'];
  registerNameInput: (id: string, input: TextInput | null) => void;
};

// Memoised, so scrolling or editing one row doesn't rebuild all the others.
const ExerciseRow = memo(function ExerciseRow({ exercise, index, onUpdate, onDelete, dragProps, registerNameInput }: ExerciseRowProps) {
  // Created once per row (not on every render).
  const [swipeX] = useState(() => new Animated.Value(0));
  // The red delete background only exists while the row is being swiped.
  const [swiping, setSwiping] = useState(false);
  const exerciseIdRef = useRef(exercise.id);
  const onDeleteRef = useRef(onDelete);
  useEffect(() => {
    exerciseIdRef.current = exercise.id;
    onDeleteRef.current = onDelete;
  });
  const [rowResponder] = useState(() => {
    const springBack = () =>
      Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setSwiping(false);
      });
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 8,
      onPanResponderGrant: () => setSwiping(true),
      onPanResponderMove: (_, gesture) => swipeX.setValue(Math.min(0, gesture.dx)),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx < -90) {
          onDeleteRef.current(exerciseIdRef.current);
          return;
        }
        springBack();
      },
      onPanResponderTerminate: springBack,
    });
  });
  const setNameInput = useCallback((input: TextInput | null) => registerNameInput(exercise.id, input), [registerNameInput, exercise.id]);
  const repBased = isRepBased(exercise);

  const step = (field: 'workSeconds' | 'restSeconds' | 'sets' | 'reps', amount: number) => {
    const next = Math.max(0, Number(exercise[field]) + amount);
    onUpdate(exercise.id, field, field === 'sets' ? Math.max(1, next) : next);
  };
  const warning = repBased ? !exercise.reps : exercise.workSeconds <= 0;

  const toggleWorkMode = () => {
    if (repBased) {
      onUpdate(exercise.id, 'reps', null);
      onUpdate(exercise.id, 'workSeconds', 30);
    } else {
      onUpdate(exercise.id, 'workSeconds', 0);
      onUpdate(exercise.id, 'reps', 8);
    }
  };

  return (
    <View style={styles.exerciseRowWrapper}>
      {swiping && (
        <View style={styles.deleteBackdrop}>
          <TrashIcon color={colors.onInk} size={20} />
        </View>
      )}
      <Animated.View style={[styles.exerciseRow, { transform: [{ translateX: swipeX }] }]} {...rowResponder.panHandlers}>
      <View style={styles.exerciseLeft}>
        {/* Press and hold here to lift the row, then drag it up or down. */}
        <View style={styles.grabZone} {...dragProps(180)} accessibilityLabel="Hold and drag to reorder">
          <DragHandleIcon />
          <Text style={styles.exerciseIndex}>{index + 1}</Text>
        </View>
        <TextInput
          ref={setNameInput}
          style={styles.exerciseName}
          value={exercise.name}
          onChangeText={text => onUpdate(exercise.id, 'name', text)}
          placeholder="Exercise Name"
          placeholderTextColor={colors.placeholder}
          selectionColor={colors.accentDeep}
          multiline
          // Wraps long names but never scrolls its own text: on Android a scrolling
          // multi-line field inside a list fights the list for vertical drags.
          scrollEnabled={false}
        />
      </View>
      <View style={styles.metricsInputs}>
        <View style={styles.metricColumn}>
          <TouchableOpacity style={styles.modeToggle} onPress={toggleWorkMode} hitSlop={6}>
            <Text style={styles.modeToggleText}>{repBased ? 'REPS' : 'SEC'}</Text>
          </TouchableOpacity>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepButton}
              onPress={() => step(repBased ? 'reps' : 'workSeconds', repBased ? 1 : 5)}
              hitSlop={{ top: 6, bottom: 2, left: 10, right: 10 }}
            >
              <Text style={styles.stepText}>+</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.metricInput, styles.workInput]}
              value={(repBased ? exercise.reps : exercise.workSeconds)?.toString() ?? '0'}
              onChangeText={text => onUpdate(exercise.id, repBased ? 'reps' : 'workSeconds', parseInt(text, 10) || 0)}
              keyboardType="number-pad"
              selectionColor={colors.accentDeep}
            />
            <TouchableOpacity
              style={styles.stepButton}
              onPress={() => step(repBased ? 'reps' : 'workSeconds', repBased ? -1 : -5)}
              hitSlop={{ top: 2, bottom: 6, left: 10, right: 10 }}
            >
              <Text style={styles.stepText}>−</Text>
            </TouchableOpacity>
          </View>
          {warning && <Text style={styles.inlineWarning}>!</Text>}
        </View>
        <View style={styles.metricColumn}>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepButton}
              onPress={() => step('restSeconds', 5)}
              hitSlop={{ top: 6, bottom: 2, left: 10, right: 10 }}
            >
              <Text style={styles.stepText}>+</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.metricInput, styles.restInput]}
              value={exercise.restSeconds.toString()}
              onChangeText={text => onUpdate(exercise.id, 'restSeconds', parseInt(text, 10) || 0)}
              keyboardType="number-pad"
              selectionColor={colors.accentDeep}
            />
            <TouchableOpacity
              style={styles.stepButton}
              onPress={() => step('restSeconds', -5)}
              hitSlop={{ top: 2, bottom: 6, left: 10, right: 10 }}
            >
              <Text style={styles.stepText}>−</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.metricColumn}>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepButton}
              onPress={() => step('sets', 1)}
              hitSlop={{ top: 6, bottom: 2, left: 10, right: 10 }}
            >
              <Text style={styles.stepText}>+</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.metricInput, styles.setsInput]}
              value={exercise.sets.toString()}
              onChangeText={text => onUpdate(exercise.id, 'sets', parseInt(text, 10) || 0)}
              keyboardType="number-pad"
              selectionColor={colors.accentDeep}
            />
            <TouchableOpacity
              style={styles.stepButton}
              onPress={() => step('sets', -1)}
              hitSlop={{ top: 2, bottom: 6, left: 10, right: 10 }}
            >
              <Text style={styles.stepText}>−</Text>
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity style={styles.deleteButton} onPress={() => onDelete(exercise.id)} hitSlop={6}>
          <TrashIcon />
        </TouchableOpacity>
      </View>
      </Animated.View>
    </View>
  );
});

export function WorkoutEditorScreen({ route, navigation }: Props) {
  const { workoutId, draftWorkout } = route.params;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    noteTransition('editor');
  }, []);

  const [name, setName] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [rounds, setRounds] = useState(1);
  const [restBetweenRoundsSeconds, setRestBetweenRoundsSeconds] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [removedExercise, setRemovedExercise] = useState<{ exercise: Exercise; index: number } | null>(null);
  const [bulkWorkSeconds, setBulkWorkSeconds] = useState(30);
  const [bulkRestSeconds, setBulkRestSeconds] = useState(45);
  // Which bulk-apply confirmation is open, if any — work and rest are applied
  // independently, so this tracks just the one field the user is about to
  // change rather than a single combined confirmation for both.
  const [bulkConfirmField, setBulkConfirmField] = useState<'work' | 'rest' | null>(null);
  const nameInputs = useRef<Record<string, TextInput | null>>({});
  const registerNameInput = useCallback((id: string, input: TextInput | null) => {
    nameInputs.current[id] = input;
  }, []);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest list, for callbacks that must stay the same function between renders.
  const exercisesRef = useRef(exercises);
  useEffect(() => {
    exercisesRef.current = exercises;
  });
  const createdAtRef = useRef<number | null>(null);
  // Snapshot of the workout as it was loaded, compared against the live state to
  // decide whether leaving should prompt about discarding unsaved edits.
  const baselineRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const allowLeaveRef = useRef(false);
  const pendingLeaveActionRef = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const [discardVisible, setDiscardVisible] = useState(false);

  const currentSnapshot = snapshotOf(name, exercises, rounds, restBetweenRoundsSeconds);
  const currentSnapshotRef = useRef(currentSnapshot);
  currentSnapshotRef.current = currentSnapshot;

  useEffect(() => {
    if (draftWorkout) {
      setName(draftWorkout.name);
      setExercises(draftWorkout.exercises);
      setRounds(draftWorkout.rounds ?? 1);
      setRestBetweenRoundsSeconds(draftWorkout.restBetweenRoundsSeconds ?? null);
      createdAtRef.current = draftWorkout.createdAt ?? null;
      baselineRef.current = snapshotOf(draftWorkout.name, draftWorkout.exercises, draftWorkout.rounds ?? 1, draftWorkout.restBetweenRoundsSeconds ?? null);
      setLoading(false);
    } else if (workoutId) {
      loadWorkouts().then(workouts => {
        const found = workouts.find(w => w.id === workoutId);
        if (found) {
          setName(found.name);
          setExercises(found.exercises);
          setRounds(found.rounds ?? 1);
          setRestBetweenRoundsSeconds(found.restBetweenRoundsSeconds ?? null);
          createdAtRef.current = found.createdAt ?? null;
          baselineRef.current = snapshotOf(found.name, found.exercises, found.rounds ?? 1, found.restBetweenRoundsSeconds ?? null);
        }
        setLoading(false);
      });
    } else {
      baselineRef.current = snapshotOf('', [], 1, null);
      setLoading(false);
    }
  }, [workoutId, draftWorkout]);

  useEffect(() => {
    return navigation.addListener('beforeRemove', e => {
      if (allowLeaveRef.current || baselineRef.current === null) return;
      if (currentSnapshotRef.current === baselineRef.current) return;
      e.preventDefault();
      pendingLeaveActionRef.current = e.data.action;
      setDiscardVisible(true);
    });
  }, [navigation]);

  const confirmDiscard = () => {
    setDiscardVisible(false);
    allowLeaveRef.current = true;
    if (pendingLeaveActionRef.current) navigation.dispatch(pendingLeaveActionRef.current);
  };

  const stepRounds = (amount: number) => {
    setRounds(current => Math.max(1, current + amount));
  };

  const stepRestBetweenRounds = (amount: number) => {
    setRestBetweenRoundsSeconds(current => Math.max(0, (current ?? DEFAULT_REST_BETWEEN_ROUNDS) + amount));
  };

  const handleApplyBulkWork = () => {
    setExercises(current => current.map(ex => (
      // Rep-based exercises have no work-seconds field to overwrite — leave them alone.
      isRepBased(ex) ? ex : { ...ex, workSeconds: bulkWorkSeconds }
    )));
    setBulkConfirmField(null);
  };

  const handleApplyBulkRest = () => {
    setExercises(current => current.map(ex => ({ ...ex, restSeconds: bulkRestSeconds })));
    setBulkConfirmField(null);
  };

  const handleAddExercise = () => {
    const newExercise = {
      id: generateId(),
      name: 'New Exercise',
      workSeconds: 30,
      reps: null,
      restSeconds: 45,
      sets: 1,
    };
    setExercises(current => [...current, newExercise]);
    setTimeout(() => nameInputs.current[newExercise.id]?.focus(), 80);
  };

  const handleUpdateExercise = useCallback((id: string, field: keyof Exercise, value: string | number | null) => {
    setExercises(currentExercises => currentExercises.map(ex => {
      if (ex.id === id) {
        return { ...ex, [field]: value };
      }
      return ex;
    }));
  }, []);

  const handleRemoveExercise = useCallback((id: string) => {
    const current = exercisesRef.current;
    const index = current.findIndex(exercise => exercise.id === id);
    const exercise = current[index];
    if (!exercise) return;

    setExercises(list => list.filter(item => item.id !== id));
    setRemovedExercise({ exercise, index });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setRemovedExercise(null), 4000);
  }, []);

  const handleReorder = (from: number, to: number) => {
    setExercises(current => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const handleUndo = () => {
    if (!removedExercise) return;
    setExercises(currentExercises => {
      const restored = [...currentExercises];
      restored.splice(Math.min(removedExercise.index, restored.length), 0, removedExercise.exercise);
      return restored;
    });
    setRemovedExercise(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!name.trim()) {
      Alert.alert('Workout name needed', 'Add a name before saving this workout.');
      return;
    }
    if (exercises.length === 0) {
      Alert.alert('Error', 'Add at least one exercise');
      return;
    }
    const incomplete = exercises.filter(ex => (isRepBased(ex) ? !ex.reps : ex.workSeconds <= 0));
    if (incomplete.length > 0) {
      const names = incomplete.map(ex => ex.name.trim() || 'Untitled exercise').join(', ');
      Alert.alert(
        'Set a work time or rep count',
        `${names} ${incomplete.length === 1 ? 'needs' : 'need'} a work time or rep count before saving.`,
      );
      return;
    }

    savingRef.current = true;
    const workout: Workout = {
      id: workoutId || draftWorkout?.id || generateId(),
      name,
      exercises,
      rounds,
      restBetweenRoundsSeconds: rounds > 1 ? (restBetweenRoundsSeconds ?? DEFAULT_REST_BETWEEN_ROUNDS) : null,
      createdAt: createdAtRef.current ?? Date.now(),
    };

    await saveWorkout(workout);
    allowLeaveRef.current = true;
    // A brand-new import draft goes straight to Library; an edit (even one opened
    // from a preview) returns to wherever it came from so that screen refreshes.
    if (draftWorkout && !workoutId) {
      navigation.navigate('Library');
    } else {
      navigation.goBack();
    }
    onEditorSaved();
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <RotatingDumbbellIcon color={colors.ink} size={48} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : -100}
    >
      <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
      <ReorderScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.statusBarSpacer} />
        <View style={styles.topNavigation}>
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.backAction} onPress={() => navigation.goBack()}>
              <ChevronIcon color={colors.ink} size={18} direction="left" />
              <Text style={styles.backLabel}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.modeLabel}>{workoutId ? 'EDITING' : 'ADDING'}</Text>
          </View>
          <View style={styles.titleField}>
            <TextInput
              style={styles.titleInput}
              value={name}
              onChangeText={setName}
              placeholder="Add Workout"
              placeholderTextColor={colors.placeholder}
              selectionColor={colors.accentDeep}
            />
            <PencilIcon />
          </View>
        </View>

        {/* Structure / Circuit Rounds Section */}
        <View style={styles.structureCard}>
          <View style={styles.structureRow}>
            <View style={styles.structureLabelGroup}>
              <Text style={styles.structureTitle}>Circuit Rounds</Text>
              <Text style={styles.structureSubtitle}>Number of times to cycle through all exercises</Text>
            </View>
            <View style={styles.roundsStepper}>
              <TouchableOpacity style={styles.roundsStepBtn} onPress={() => stepRounds(-1)}>
                <Text style={styles.roundsStepText}>−</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.roundsValueInput}
                value={rounds.toString()}
                onChangeText={text => setRounds(Math.max(1, parseInt(text, 10) || 1))}
                keyboardType="number-pad"
                selectionColor={colors.accentDeep}
              />
              <TouchableOpacity style={styles.roundsStepBtn} onPress={() => stepRounds(1)}>
                <Text style={styles.roundsStepText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {rounds > 1 && (
            <View style={[styles.structureRow, styles.structureRowBorder]}>
              <View style={styles.structureLabelGroup}>
                <Text style={styles.structureTitle}>Rest Between Rounds</Text>
                <Text style={styles.structureSubtitle}>Break time after finishing all exercises in a round</Text>
              </View>
              <View style={styles.roundsStepper}>
                <TouchableOpacity style={styles.roundsStepBtn} onPress={() => stepRestBetweenRounds(-5)}>
                  <Text style={styles.roundsStepText}>−</Text>
                </TouchableOpacity>
                <View style={styles.restInputWithSuffix}>
                  <TextInput
                    style={[styles.roundsValueInput, styles.restValueInput]}
                    value={(restBetweenRoundsSeconds ?? DEFAULT_REST_BETWEEN_ROUNDS).toString()}
                    onChangeText={text => setRestBetweenRoundsSeconds(Math.max(0, parseInt(text, 10) || 0))}
                    keyboardType="number-pad"
                    selectionColor={colors.accentDeep}
                  />
                  <Text style={styles.restSuffix}>s</Text>
                </View>
                <TouchableOpacity style={styles.roundsStepBtn} onPress={() => stepRestBetweenRounds(5)}>
                  <Text style={styles.roundsStepText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Bulk Edit Section */}
        <View style={styles.structureCard}>
          <View style={styles.structureRow}>
            <View style={styles.structureLabelGroup}>
              <Text style={styles.structureTitle}>Work Time (All)</Text>
              <Text style={styles.structureSubtitle}>Applied to every timed exercise below</Text>
            </View>
            <View style={styles.roundsStepper}>
              <TouchableOpacity style={styles.roundsStepBtn} onPress={() => setBulkWorkSeconds(v => Math.max(0, v - 5))}>
                <Text style={styles.roundsStepText}>−</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.roundsValueInput}
                value={bulkWorkSeconds.toString()}
                onChangeText={text => setBulkWorkSeconds(Math.max(0, parseInt(text, 10) || 0))}
                keyboardType="number-pad"
                selectionColor={colors.accentDeep}
              />
              <TouchableOpacity style={styles.roundsStepBtn} onPress={() => setBulkWorkSeconds(v => v + 5)}>
                <Text style={styles.roundsStepText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.structureRow, styles.structureRowBorder, styles.applyAllRow]}
            onPress={() => setBulkConfirmField('work')}
            disabled={exercises.length === 0}
          >
            <Text style={styles.applyAllText}>Apply Work Time to All</Text>
          </TouchableOpacity>
          <View style={[styles.structureRow, styles.structureRowBorder]}>
            <View style={styles.structureLabelGroup}>
              <Text style={styles.structureTitle}>Rest Time (All)</Text>
              <Text style={styles.structureSubtitle}>Applied to every exercise below</Text>
            </View>
            <View style={styles.roundsStepper}>
              <TouchableOpacity style={styles.roundsStepBtn} onPress={() => setBulkRestSeconds(v => Math.max(0, v - 5))}>
                <Text style={styles.roundsStepText}>−</Text>
              </TouchableOpacity>
              <View style={styles.restInputWithSuffix}>
                <TextInput
                  style={[styles.roundsValueInput, styles.restValueInput]}
                  value={bulkRestSeconds.toString()}
                  onChangeText={text => setBulkRestSeconds(Math.max(0, parseInt(text, 10) || 0))}
                  keyboardType="number-pad"
                  selectionColor={colors.accentDeep}
                />
                <Text style={styles.restSuffix}>s</Text>
              </View>
              <TouchableOpacity style={styles.roundsStepBtn} onPress={() => setBulkRestSeconds(v => v + 5)}>
                <Text style={styles.roundsStepText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.structureRow, styles.structureRowBorder, styles.applyAllRow]}
            onPress={() => setBulkConfirmField('rest')}
            disabled={exercises.length === 0}
          >
            <Text style={styles.applyAllText}>Apply Rest Time to All</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>EXERCISE LIST ({exercises.length} ITEMS)</Text>
          <View style={styles.columnHeaders}>
            <Text style={styles.columnHeaderLabel}>WORK</Text>
            <Text style={styles.columnHeaderLabel}>REST</Text>
            <Text style={styles.columnHeaderLabel}>SETS</Text>
          </View>
        </View>
        <ReorderableList
          data={exercises}
          keyExtractor={ex => ex.id}
          onReorder={handleReorder}
          style={styles.exerciseList}
          renderItem={({ item, index, dragProps }) => (
            <ExerciseRow
              exercise={item}
              index={index}
              onUpdate={handleUpdateExercise}
              onDelete={handleRemoveExercise}
              dragProps={dragProps}
              registerNameInput={registerNameInput}
            />
          )}
        />
      </ReorderScrollView>

        <TouchableOpacity style={styles.addExerciseButton} onPress={handleAddExercise}>
          <Text style={styles.addExerciseText}>+ Add Exercise</Text>
        </TouchableOpacity>
      <View style={[styles.footer, { paddingBottom: space.row + insets.bottom }]}>
        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <CheckIcon color={colors.onInk} size={18} />
          <Text style={styles.saveLabel}>SAVE CHANGES</Text>
        </TouchableOpacity>
      </View>
      {removedExercise && (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>Exercise removed</Text>
          <TouchableOpacity onPress={handleUndo}>
            <Text style={styles.undoText}>UNDO</Text>
          </TouchableOpacity>
        </View>
      )}
      <ConfirmDialog
        visible={bulkConfirmField !== null}
        title={bulkConfirmField === 'work' ? 'Apply work time to all exercises?' : 'Apply rest time to all exercises?'}
        message={
          bulkConfirmField === 'work'
            ? `Set every timed exercise's work time to ${bulkWorkSeconds}s. Rep-based exercises are left as-is, and rest times aren't touched.`
            : `Set every exercise's rest time to ${bulkRestSeconds}s. Work times and rep counts aren't touched.`
        }
        onRequestClose={() => setBulkConfirmField(null)}
        actions={[
          { label: 'Apply', variant: 'primary', onPress: bulkConfirmField === 'work' ? handleApplyBulkWork : handleApplyBulkRest },
          { label: 'Cancel', variant: 'neutral', onPress: () => setBulkConfirmField(null) },
        ]}
      />
      <ConfirmDialog
        visible={discardVisible}
        title="Discard changes?"
        message="You have unsaved changes to this workout."
        onRequestClose={() => setDiscardVisible(false)}
        actions={[
          { label: 'Discard', variant: 'destructive', onPress: confirmDiscard },
          { label: 'Keep Editing', variant: 'neutral', onPress: () => setDiscardVisible(false) },
        ]}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    // Extra bottom padding guarantees there's room to scroll the last
    // exercise row's inputs above the keyboard even once it's showing.
    paddingBottom: 280,
  },
  statusBarSpacer: {
    height: band.statusBar,
  },
  // ── Header ────────────────────────────────────────────────────────────────
  topNavigation: {
    paddingHorizontal: space.gutter,
    paddingTop: space.tight,
    paddingBottom: space.row,
    gap: space.row,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backAction: {
    minHeight: band.control,
    paddingRight: space.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.hair + 2,
  },
  backLabel: {
    fontFamily: font.black,
    color: colors.ink,
    fontSize: label.small,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
  },
  modeLabel: {
    fontFamily: font.black,
    color: colors.ink,
    fontSize: label.micro,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    backgroundColor: colors.accent,
    paddingHorizontal: space.tight,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  titleField: {
    borderBottomWidth: rule.heavy,
    borderBottomColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: space.tight,
  },
  titleInput: {
    flex: 1,
    padding: 0,
    color: colors.ink,
    fontFamily: font.display,
    fontSize: display.cta,
    lineHeight: display.cta * leading.snug,
    textTransform: 'uppercase',
  },
  // ── Structure cards ───────────────────────────────────────────────────────
  structureCard: {
    marginHorizontal: space.gutter,
    marginBottom: space.block,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
  },
  structureRow: {
    paddingHorizontal: space.row,
    paddingVertical: space.tight,
    minHeight: band.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  structureRowBorder: {
    borderTopWidth: rule.heavy,
    borderTopColor: colors.ink,
  },
  structureLabelGroup: {
    flex: 1,
    marginRight: space.row,
  },
  structureTitle: {
    fontFamily: font.black,
    color: colors.ink,
    fontSize: label.base,
    letterSpacing: tracking.label,
    textTransform: 'uppercase',
  },
  structureSubtitle: {
    fontFamily: font.medium,
    color: colors.inkMuted,
    fontSize: label.micro,
    lineHeight: label.micro * 1.4,
    marginTop: 2,
  },
  roundsStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.hair,
  },
  roundsStepBtn: {
    width: band.control,
    height: band.control,
    borderWidth: rule.thin,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundsStepText: {
    fontFamily: font.black,
    color: colors.ink,
    fontSize: label.cue,
  },
  roundsValueInput: {
    width: 48,
    height: band.control,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    color: colors.ink,
    fontFamily: font.bold,
    fontSize: label.cue,
    textAlign: 'center',
    paddingVertical: 0,
    fontVariant: ['tabular-nums'],
  },
  restValueInput: {},
  restInputWithSuffix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.hair,
  },
  restSuffix: {
    fontFamily: font.black,
    color: colors.ink,
    fontSize: label.small,
  },
  applyAllRow: {
    justifyContent: 'center',
    minHeight: band.control,
    backgroundColor: colors.accent,
  },
  applyAllText: {
    fontFamily: font.black,
    color: colors.ink,
    fontSize: label.small,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
  },
  // ── List header ───────────────────────────────────────────────────────────
  listHeader: {
    paddingHorizontal: space.gutter,
    paddingVertical: space.tight,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listTitle: {
    fontFamily: font.black,
    color: colors.onInk,
    fontSize: label.micro,
    letterSpacing: tracking.label,
    textTransform: 'uppercase',
  },
  columnHeaders: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.hair,
    marginRight: 30,
  },
  columnHeaderLabel: {
    width: 52,
    fontFamily: font.black,
    color: colors.onInk,
    fontSize: 10,
    letterSpacing: tracking.label,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  // ── Exercise rows ─────────────────────────────────────────────────────────
  exerciseList: {
    backgroundColor: colors.paper,
  },
  exerciseRowWrapper: {
    borderBottomWidth: rule.heavy,
    borderBottomColor: colors.ink,
    overflow: 'hidden',
  },
  deleteBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: space.gutter,
  },
  exerciseRow: {
    minHeight: 56,
    paddingHorizontal: space.row,
    paddingVertical: space.tight,
    backgroundColor: colors.paper,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exerciseLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
  },
  // A generous target (handle plus number) for the press-and-hold that lifts a row.
  grabZone: {
    minWidth: 48,
    height: 96,
    paddingHorizontal: space.hair,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.hair,
    marginLeft: -space.hair,
  },
  exerciseIndex: {
    width: 22,
    fontFamily: font.display,
    color: colors.inkMuted,
    fontSize: display.entryTitle,
    lineHeight: display.entryTitle,
  },
  exerciseName: {
    flex: 1,
    minHeight: 20,
    maxHeight: 80,
    padding: 0,
    color: colors.ink,
    fontFamily: font.bold,
    fontSize: label.cue,
    lineHeight: label.cue * 1.3,
  },
  // Width = 3 metricColumns (44 each) + 3 gaps (4 each) between all 4 row
  // children (the columns plus the trailing delete button) + the delete
  // button itself (26) — recompute this if any of those sizes change.
  metricsInputs: {
    width: 170,
    height: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.hair,
    flexShrink: 0,
  },
  metricColumn: {
    width: 44,
    height: 96,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  modeToggle: {
    height: 18,
    minWidth: 40,
    paddingHorizontal: space.hair,
    marginBottom: space.hair,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeToggleText: {
    fontFamily: font.black,
    color: colors.onInk,
    fontSize: 9,
    letterSpacing: tracking.label,
  },
  stepper: {
    width: 40,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
  },
  stepButton: {
    width: 40,
    height: 24,
    borderWidth: rule.thin,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    fontFamily: font.black,
    color: colors.ink,
    fontSize: label.cue,
    lineHeight: label.cue + 2,
  },
  inlineWarning: {
    position: 'absolute',
    top: 98,
    fontFamily: font.black,
    color: colors.danger,
    fontSize: label.micro,
  },
  metricInput: {
    width: 40,
    height: 28,
    paddingVertical: 2,
    paddingHorizontal: 1,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    color: colors.ink,
    fontFamily: font.bold,
    fontSize: label.base,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  workInput: {},
  restInput: {},
  setsInput: {},
  deleteButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    marginBottom: 2,
  },
  // ── Add / save ────────────────────────────────────────────────────────────
  addExerciseButton: {
    minHeight: band.cta,
    flexShrink: 0,
    backgroundColor: colors.paper,
    borderTopWidth: rule.heavy,
    borderTopColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    elevation: 5,
  },
  addExerciseText: {
    fontFamily: font.black,
    color: colors.ink,
    fontSize: label.base,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
  },
  snackbar: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    bottom: 140,
    minHeight: band.actionHeight,
    paddingHorizontal: space.block,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  snackbarText: {
    fontFamily: font.black,
    color: colors.onInk,
    fontSize: label.small,
    letterSpacing: tracking.label,
    textTransform: 'uppercase',
  },
  undoText: {
    fontFamily: font.black,
    color: colors.accent,
    fontSize: label.small,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
  },
  footer: {
    paddingTop: space.row,
    paddingHorizontal: space.gutter,
    paddingBottom: space.row,
    backgroundColor: colors.paper,
    borderTopWidth: rule.heavy,
    borderTopColor: colors.ink,
  },
  saveButton: {
    height: band.cta,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.tight,
  },
  saveLabel: {
    fontFamily: font.display,
    color: colors.onInk,
    fontSize: display.cta,
    lineHeight: display.cta * leading.snug,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
