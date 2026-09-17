import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity, Alert, StatusBar, PanResponder, Animated } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Workout, Exercise } from '../types';
import { loadWorkouts, saveWorkout } from '../storage';
import { PencilIcon, TrashIcon, DragHandleIcon, ChevronIcon, CheckIcon, RotatingDumbbellIcon } from '../components/WorkoutIcons';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkoutEditor'>;

const generateId = () => Math.random().toString(36).substring(2, 9);

type ExerciseRowProps = {
  exercise: Exercise;
  index: number;
  total: number;
  onUpdate: (id: string, field: keyof Exercise, value: string | number | null) => void;
  onDelete: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  nameInputRef: (input: TextInput | null) => void;
};

function ExerciseRow({ exercise, index, total, onUpdate, onDelete, onMove, nameInputRef }: ExerciseRowProps) {
  const swipeX = useRef(new Animated.Value(0)).current;
  const dragStartY = useRef(0);
  const rowResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 8,
    onPanResponderMove: (_, gesture) => swipeX.setValue(Math.min(0, gesture.dx)),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx < -90) {
        onDelete(exercise.id);
        return;
      }
      Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start(),
  })).current;
  const dragResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (_, gesture) => { dragStartY.current = gesture.y0; },
    onPanResponderMove: (_, gesture) => {
      const delta = gesture.moveY - dragStartY.current;
      if (delta <= -42 && index > 0) {
        onMove(index, -1);
        dragStartY.current -= 42;
      } else if (delta >= 42 && index < total - 1) {
        onMove(index, 1);
        dragStartY.current += 42;
      }
    },
  })).current;

  const isRepBased = exercise.reps != null && exercise.workSeconds <= 0;

  const step = (field: 'workSeconds' | 'restSeconds' | 'sets' | 'reps', amount: number) => {
    const next = Math.max(0, Number(exercise[field]) + amount);
    onUpdate(exercise.id, field, field === 'sets' ? Math.max(1, next) : next);
  };
  const warning = isRepBased ? !exercise.reps : exercise.workSeconds <= 0;

  const toggleWorkMode = () => {
    if (isRepBased) {
      onUpdate(exercise.id, 'reps', null);
      onUpdate(exercise.id, 'workSeconds', 30);
    } else {
      onUpdate(exercise.id, 'workSeconds', 0);
      onUpdate(exercise.id, 'reps', 8);
    }
  };

  return (
    <View style={styles.exerciseRowWrapper}>
      <View style={styles.deleteBackdrop}>
        <TrashIcon color="#FFFFFF" size={20} />
      </View>
      <Animated.View style={[styles.exerciseRow, { transform: [{ translateX: swipeX }] }]} {...rowResponder.panHandlers}>
      <View style={styles.exerciseLeft}>
        <View style={styles.dragHandle} {...dragResponder.panHandlers}>
          <DragHandleIcon />
        </View>
        <Text style={styles.exerciseIndex}>{index + 1}</Text>
        <TextInput
          ref={nameInputRef}
          style={styles.exerciseName}
          value={exercise.name}
          onChangeText={text => onUpdate(exercise.id, 'name', text)}
          placeholder="Exercise Name"
          placeholderTextColor="#64748B"
          selectionColor="#CCFF00"
          multiline
        />
      </View>
      <View style={styles.metricsInputs}>
        <View style={styles.metricColumn}>
          <TouchableOpacity style={styles.modeToggle} onPress={toggleWorkMode}>
            <Text style={styles.modeToggleText}>{isRepBased ? 'REPS' : 'SEC'}</Text>
          </TouchableOpacity>
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepButton} onPress={() => step(isRepBased ? 'reps' : 'workSeconds', isRepBased ? -1 : -5)}>
              <Text style={styles.stepText}>−</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.metricInput, styles.workInput]}
              value={(isRepBased ? exercise.reps : exercise.workSeconds)?.toString() ?? '0'}
              onChangeText={text => onUpdate(exercise.id, isRepBased ? 'reps' : 'workSeconds', parseInt(text, 10) || 0)}
              keyboardType="number-pad"
              selectionColor="#CCFF00"
            />
            <TouchableOpacity style={styles.stepButton} onPress={() => step(isRepBased ? 'reps' : 'workSeconds', isRepBased ? 1 : 5)}>
              <Text style={styles.stepText}>+</Text>
            </TouchableOpacity>
          </View>
          {warning && <Text style={styles.inlineWarning}>!</Text>}
        </View>
        <View style={styles.metricColumn}>
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepButton} onPress={() => step('restSeconds', -5)}>
              <Text style={styles.stepText}>−</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.metricInput, styles.restInput]}
              value={exercise.restSeconds.toString()}
              onChangeText={text => onUpdate(exercise.id, 'restSeconds', parseInt(text, 10) || 0)}
              keyboardType="number-pad"
              selectionColor="#CCFF00"
            />
            <TouchableOpacity style={styles.stepButton} onPress={() => step('restSeconds', 5)}>
              <Text style={styles.stepText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.metricColumn}>
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepButton} onPress={() => step('sets', -1)}>
              <Text style={styles.stepText}>−</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.metricInput, styles.setsInput]}
              value={exercise.sets.toString()}
              onChangeText={text => onUpdate(exercise.id, 'sets', parseInt(text, 10) || 0)}
              keyboardType="number-pad"
              selectionColor="#CCFF00"
            />
            <TouchableOpacity style={styles.stepButton} onPress={() => step('sets', 1)}>
              <Text style={styles.stepText}>+</Text>
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
}

export function WorkoutEditorScreen({ route, navigation }: Props) {
  const { workoutId, draftWorkout } = route.params;

  const [name, setName] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [rounds, setRounds] = useState(1);
  const [restBetweenRoundsSeconds, setRestBetweenRoundsSeconds] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [removedExercise, setRemovedExercise] = useState<{ exercise: Exercise; index: number } | null>(null);
  const nameInputs = useRef<Record<string, TextInput | null>>({});
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (draftWorkout) {
      setName(draftWorkout.name);
      setExercises(draftWorkout.exercises);
      setRounds(draftWorkout.rounds ?? 1);
      setRestBetweenRoundsSeconds(draftWorkout.restBetweenRoundsSeconds ?? null);
      setLoading(false);
    } else if (workoutId) {
      loadWorkouts().then(workouts => {
        const found = workouts.find(w => w.id === workoutId);
        if (found) {
          setName(found.name);
          setExercises(found.exercises);
          setRounds(found.rounds ?? 1);
          setRestBetweenRoundsSeconds(found.restBetweenRoundsSeconds ?? null);
        }
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, [workoutId, draftWorkout]);

  const stepRounds = (amount: number) => {
    setRounds(current => Math.max(1, current + amount));
  };

  const stepRestBetweenRounds = (amount: number) => {
    setRestBetweenRoundsSeconds(current => Math.max(0, (current ?? 0) + amount));
  };

  const handleAddExercise = () => {
    const newExercise = {
      id: generateId(),
      name: 'New Exercise',
      workSeconds: 30,
      reps: null,
      restSeconds: 15,
      sets: 1,
    };
    setExercises(current => [...current, newExercise]);
    setTimeout(() => nameInputs.current[newExercise.id]?.focus(), 80);
  };

  const handleUpdateExercise = (id: string, field: keyof Exercise, value: string | number | null) => {
    setExercises(currentExercises => currentExercises.map(ex => {
      if (ex.id === id) {
        return { ...ex, [field]: value };
      }
      return ex;
    }));
  };

  const handleRemoveExercise = (id: string) => {
    setExercises(currentExercises => {
      const index = currentExercises.findIndex(exercise => exercise.id === id);
      const exercise = currentExercises[index];
      if (!exercise) return currentExercises;
      setRemovedExercise({ exercise, index });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setRemovedExercise(null), 4000);
      return currentExercises.filter(item => item.id !== id);
    });
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    setExercises(currentExercises => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= currentExercises.length) return currentExercises;
      const reordered = [...currentExercises];
      [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
      return reordered;
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
    if (!name.trim()) {
      Alert.alert('Workout name needed', 'Add a name before saving this workout.');
      return;
    }
    if (exercises.length === 0) {
      Alert.alert('Error', 'Add at least one exercise');
      return;
    }

    const workout: Workout = {
      id: workoutId || generateId(),
      name,
      exercises,
      rounds,
      restBetweenRoundsSeconds: rounds > 1 ? (restBetweenRoundsSeconds ?? 60) : null,
    };

    await saveWorkout(workout);
    // If this was an import draft, go straight to Library.
    // If it was a regular edit, go back to wherever we came from.
    if (draftWorkout) {
      navigation.navigate('Library');
    } else {
      navigation.goBack();
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <RotatingDumbbellIcon color="#CCFF00" size={48} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0B0B" />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.statusBarSpacer} />
        <View style={styles.topNavigation}>
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.backAction} onPress={() => navigation.goBack()}>
              <ChevronIcon color="#94A3B8" size={18} direction="left" />
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
              placeholderTextColor="#64748B"
              selectionColor="#CCFF00"
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
                selectionColor="#CCFF00"
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
                    value={(restBetweenRoundsSeconds ?? 60).toString()}
                    onChangeText={text => setRestBetweenRoundsSeconds(Math.max(0, parseInt(text, 10) || 0))}
                    keyboardType="number-pad"
                    selectionColor="#CCFF00"
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

        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>EXERCISE LIST ({exercises.length} ITEMS)</Text>
          <View style={styles.columnHeaders}>
            <Text style={styles.columnHeaderLabel}>WORK</Text>
            <Text style={styles.columnHeaderLabel}>REST</Text>
            <Text style={styles.columnHeaderLabel}>SETS</Text>
          </View>
        </View>
        <View style={styles.exerciseList}>
            {exercises.map((ex, index) => (
              <ExerciseRow
                key={ex.id}
                exercise={ex}
                index={index}
                total={exercises.length}
                onUpdate={handleUpdateExercise}
                onDelete={handleRemoveExercise}
                onMove={handleMove}
                nameInputRef={input => { nameInputs.current[ex.id] = input; }}
              />
            ))}
        </View>
      </ScrollView>

        <TouchableOpacity style={styles.addExerciseButton} onPress={handleAddExercise}>
          <Text style={styles.addExerciseText}>+ Add Exercise</Text>
        </TouchableOpacity>
      <View style={styles.footer}>
        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <CheckIcon color="#09090A" size={18} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0B0B',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  scrollView: {
    flex: 1,
  },
  statusBarSpacer: {
    height: 44,
  },
  topNavigation: {
    height: 99,
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 16,
  },
  headerRow: {
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backAction: {
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backLabel: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 15,
    lineHeight: 20,
  },
  modeLabel: {
    color: '#CCFF00',
    fontFamily: 'Geist',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  titleField: {
    height: 39,
    borderBottomWidth: 2,
    borderBottomColor: '#1F1F24',
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
  },
  titleInput: {
    flex: 1,
    height: 31,
    padding: 0,
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 31,
  },
  // ── Structure Card ────────────────────────────────────────────────────────
  structureCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 12,
    backgroundColor: '#121214',
    overflow: 'hidden',
  },
  structureRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  structureRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#1F1F24',
  },
  structureLabelGroup: {
    flex: 1,
    marginRight: 12,
  },
  structureTitle: {
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  structureSubtitle: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  roundsStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  roundsStepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#1F1F24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundsStepText: {
    color: '#CCFF00',
    fontFamily: 'Geist',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  roundsValueInput: {
    width: 42,
    height: 32,
    backgroundColor: '#09090A',
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 8,
    color: '#CCFF00',
    fontFamily: 'JetBrains Mono',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 0,
  },
  restValueInput: {
    color: '#6B9EFA',
  },
  restInputWithSuffix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  restSuffix: {
    color: '#6B9EFA',
    fontFamily: 'JetBrains Mono',
    fontSize: 13,
    fontWeight: '700',
  },
  // ── List Header ────────────────────────────────────────────────────────────
  listHeader: {
    minHeight: 32,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#121214',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listTitle: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  columnHeaders: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 32,
  },
  columnHeaderLabel: {
    width: 52,
    color: '#64748B',
    fontFamily: 'Geist',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  exerciseList: {
    backgroundColor: '#09090A',
  },
  exerciseRowWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: '#1F1F24',
    overflow: 'hidden',
  },
  deleteBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 24,
  },
  exerciseRow: {
    minHeight: 56,
    paddingHorizontal: 16,
    backgroundColor: '#09090A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exerciseLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dragHandle: {
    width: 24,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -4,
    marginRight: -4,
  },
  exerciseIndex: {
    width: 18,
    color: '#94A3B8',
    fontFamily: 'JetBrains Mono',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  exerciseName: {
    flex: 1,
    minHeight: 20,
    maxHeight: 40,
    padding: 0,
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  metricsInputs: {
    width: 204,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  metricColumn: {
    width: 52,
    alignItems: 'center',
  },
  modeToggle: {
    height: 16,
    minWidth: 38,
    paddingHorizontal: 4,
    borderRadius: 4,
    backgroundColor: '#1F1F24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeToggleText: {
    color: '#94A3B8',
    fontFamily: 'JetBrains Mono',
    fontSize: 8,
    fontWeight: '700',
  },
  stepper: {
    width: 52,
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButton: {
    width: 9,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  inlineWarning: {
    position: 'absolute',
    top: 45,
    color: '#F59E0B',
    fontFamily: 'JetBrains Mono',
    fontSize: 10,
    fontWeight: '700',
  },
  metricInput: {
    width: 34,
    height: 25,
    paddingVertical: 3,
    paddingHorizontal: 1,
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 6,
    fontFamily: 'JetBrains Mono',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
    textAlign: 'center',
  },
  workInput: {
    color: '#CCFF00',
  },
  restInput: {
    color: '#6B9EFA',
  },
  setsInput: {
    color: '#FFFFFF',
  },
  deleteButton: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addExerciseButton: {
    height: 68,
    flexShrink: 0,
    paddingTop: 16,
    paddingBottom: 32,
    backgroundColor: '#0B0B0B',
    borderTopWidth: 1,
    borderTopColor: '#1F1F24',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    zIndex: 5,
    elevation: 5,
  },
  addExerciseText: {
    color: '#CCFF00',
    fontFamily: 'Geist',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  snackbar: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 126,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#1F1F24',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  snackbarText: {
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 14,
    lineHeight: 18,
  },
  undoText: {
    color: '#CCFF00',
    fontFamily: 'Geist',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  footer: {
    height: 112,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 8,
    backgroundColor: '#09090A',
    borderTopWidth: 1,
    borderTopColor: '#1F1F24',
  },
  saveButton: {
    height: 54,
    borderRadius: 12,
    backgroundColor: '#CCFF00',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveLabel: {
    color: '#09090A',
    fontFamily: 'Geist',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
  },
});
