import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, TextInput, Modal, PanResponder } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PencilIcon, ChevronIcon, DragHandleIcon, LockIcon, CheckIcon } from '../components/WorkoutIcons';
import { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkoutPreview'>;
type WheelField = 'workSeconds' | 'restSeconds' | 'sets' | 'reps';
type WheelSelection = { exerciseId: string; field: WheelField } | null;

function isRepBased(ex: { reps?: number | null; workSeconds: number }): boolean {
  return ex.reps != null && ex.reps > 0 && ex.workSeconds <= 0;
}

export function WorkoutPreviewScreen({ route, navigation }: Props) {
  const { workout } = route.params;
  const [exercises, setExercises] = useState(() => workout.exercises.map(exercise => ({ ...exercise })));
  const [nameHeights, setNameHeights] = useState<Record<string, number>>({});
  const [wheelSelection, setWheelSelection] = useState<WheelSelection>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragIndex = useRef<number | null>(null);
  const dragOffset = useRef(0);
  const nameInputs = useRef<Record<string, TextInput | null>>({});

  const updateExercise = (id: string, field: 'name' | 'workSeconds' | 'restSeconds' | 'sets' | 'reps', value: string) => {
    setExercises(currentExercises => currentExercises.map(exercise => {
      if (exercise.id !== id) return exercise;
      if (field === 'name') return { ...exercise, name: value };
      return { ...exercise, [field]: Number.parseInt(value, 10) || 0 };
    }));
  };

  const onStart = () => {
    navigation.replace('ActiveSession', { workout: { ...workout, exercises } });
  };

  const handleAddExercise = () => {
    const newExercise = {
      id: Math.random().toString(36).substring(2, 9),
      name: '',
      workSeconds: 30,
      restSeconds: 15,
      sets: 1,
    };
    setExercises(currentExercises => [...currentExercises, newExercise]);
    setTimeout(() => nameInputs.current[newExercise.id]?.focus(), 80);
  };

  const moveExercise = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= exercises.length) return;
    setExercises(currentExercises => {
      const reordered = [...currentExercises];
      [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
      return reordered;
    });
  };

  const createDragResponder = (index: number) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      dragIndex.current = index;
      dragOffset.current = 0;
      setDraggingIndex(index);
    },
    onPanResponderMove: (_, gestureState) => {
      if (dragIndex.current === null) return;
      const delta = gestureState.dy - dragOffset.current;
      if (delta <= -56 && dragIndex.current > 0) {
        moveExercise(dragIndex.current, -1);
        dragIndex.current -= 1;
        dragOffset.current -= 56;
      } else if (delta >= 56 && dragIndex.current < exercises.length - 1) {
        moveExercise(dragIndex.current, 1);
        dragIndex.current += 1;
        dragOffset.current += 56;
      }
    },
    onPanResponderRelease: () => {
      dragIndex.current = null;
      dragOffset.current = 0;
      setDraggingIndex(null);
    },
    onPanResponderTerminate: () => {
      dragIndex.current = null;
      dragOffset.current = 0;
      setDraggingIndex(null);
    },
  });

  const selectedExercise = wheelSelection
    ? exercises.find(exercise => exercise.id === wheelSelection.exerciseId)
    : undefined;
  const wheelValues = wheelSelection?.field === 'sets'
    ? Array.from({ length: 20 }, (_, index) => index + 1)
    : wheelSelection?.field === 'reps'
      ? Array.from({ length: 100 }, (_, index) => index + 1)
      : Array.from({ length: 301 }, (_, index) => index);
  const selectedValue = selectedExercise && wheelSelection
    ? selectedExercise[wheelSelection.field]
    : 0;
  const selectedWheelIndex = Math.max(0, wheelValues.indexOf(selectedValue ?? 0));
  const wheelLabel = wheelSelection?.field === 'workSeconds'
    ? 'WORK TIME'
    : wheelSelection?.field === 'restSeconds'
      ? 'REST TIME'
      : wheelSelection?.field === 'reps'
        ? 'REPS'
        : 'SETS';

  const commitWheelValue = (offsetY: number) => {
    if (!wheelSelection) return;
    const index = Math.max(0, Math.min(wheelValues.length - 1, Math.round(offsetY / 44)));
    updateExercise(wheelSelection.exerciseId, wheelSelection.field, wheelValues[index].toString());
  };
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0B0B" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.statusBarSpacer} />
        <View style={styles.topNavigation}>
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.backAction} onPress={() => navigation.goBack()}>
              <ChevronIcon color="#94A3B8" size={18} direction="left" />
              <Text style={styles.backLabel}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.modeLabel}>READY</Text>
          </View>
          <View style={styles.titleField}>
            <Text style={styles.title}>{workout.name}</Text>
            <PencilIcon />
          </View>
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>
            EXERCISE LIST ({exercises.length} ITEMS{workout.rounds && workout.rounds > 1 ? ` • ${workout.rounds} ROUNDS` : ''})
          </Text>
        </View>
        <View style={styles.exerciseList}>
          {exercises.map((ex, index) => (
            <View key={ex.id || index} style={[styles.exerciseRow, draggingIndex === index && styles.draggingRow]}>
              <View style={styles.exerciseLeft}>
                <View style={styles.dragHandle} {...createDragResponder(index).panHandlers}>
                  <DragHandleIcon />
                </View>
                <Text style={styles.exerciseIndex}>{index + 1}</Text>
                <TextInput
                  ref={input => { nameInputs.current[ex.id] = input; }}
                  style={[styles.exerciseName, { height: nameHeights[ex.id] }]}
                  value={ex.name}
                  onChangeText={value => updateExercise(ex.id, 'name', value)}
                  placeholder="Exercise name"
                  placeholderTextColor="#64748B"
                  multiline
                  scrollEnabled={false}
                  onContentSizeChange={event => {
                    const height = Math.max(20, event.nativeEvent.contentSize.height);
                    setNameHeights(current => current[ex.id] === height ? current : { ...current, [ex.id]: height });
                  }}
                  selectionColor="#CCFF00"
                />
              </View>
              <View style={styles.metricsInputs}>
                <TouchableOpacity
                  style={[styles.metricInput, styles.workInput]}
                  onPress={() => setWheelSelection({ exerciseId: ex.id, field: isRepBased(ex) ? 'reps' : 'workSeconds' })}
                >
                  <Text style={styles.workValue}>{isRepBased(ex) ? `${ex.reps}r` : `${ex.workSeconds}s`}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.metricInput, styles.restInput]}
                  onPress={() => setWheelSelection({ exerciseId: ex.id, field: 'restSeconds' })}
                >
                  <Text style={styles.restValue}>{ex.restSeconds}s</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.metricInput, styles.setsInput]}
                  onPress={() => setWheelSelection({ exerciseId: ex.id, field: 'sets' })}
                >
                  <Text style={styles.setsValue}>{ex.sets}×</Text>
                </TouchableOpacity>
                <View style={styles.lockIcon}><LockIcon /></View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <TouchableOpacity style={styles.addExerciseButton} onPress={handleAddExercise}>
        <Text style={styles.addExerciseText}>+ Add Exercise</Text>
      </TouchableOpacity>
      <View style={styles.footer}>
        <TouchableOpacity style={styles.startButton} onPress={onStart}>
          <CheckIcon color="#09090A" size={20} />
          <Text style={styles.startLabel}>START WORKOUT</Text>
        </TouchableOpacity>
      </View>
      <Modal
        visible={wheelSelection !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setWheelSelection(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.wheelSheet}>
            <View style={styles.wheelHeader}>
              <Text style={styles.wheelTitle}>{wheelLabel}</Text>
              <TouchableOpacity onPress={() => setWheelSelection(null)}>
                <Text style={styles.wheelDone}>DONE</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.wheelViewport}>
              <ScrollView
                key={`${wheelSelection?.exerciseId}-${wheelSelection?.field}`}
                showsVerticalScrollIndicator={false}
                snapToInterval={44}
                decelerationRate="fast"
                contentOffset={{ x: 0, y: selectedWheelIndex * 44 }}
                onMomentumScrollEnd={event => commitWheelValue(event.nativeEvent.contentOffset.y)}
                onScrollEndDrag={event => commitWheelValue(event.nativeEvent.contentOffset.y)}
                contentContainerStyle={styles.wheelContent}
              >
                {wheelValues.map(value => (
                  <View key={value} style={styles.wheelRow}>
                    <Text style={styles.wheelValue}>
                      {wheelSelection?.field === 'sets'
                        ? `${value}×`
                        : wheelSelection?.field === 'reps'
                          ? `${value} reps`
                          : `${value}s`}
                    </Text>
                  </View>
                ))}
              </ScrollView>
              <View pointerEvents="none" style={styles.wheelSelectionFrame} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0B0B',
  },
  scrollContent: {
    paddingBottom: 24,
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
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: '#1F1F24',
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flex: 1,
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 31,
  },
  listHeader: {
    height: 30,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#121214',
  },
  listTitle: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  exerciseList: {
    backgroundColor: '#09090A',
  },
  exerciseRow: {
    minHeight: 56,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1F1F24',
    backgroundColor: '#09090A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  draggingRow: {
    backgroundColor: '#121214',
    borderColor: '#CCFF00',
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
    width: 0,
    minWidth: 0,
    padding: 0,
    margin: 0,
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'left',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  metricsInputs: {
    width: 174,
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metricInput: {
    height: 25,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workInput: {
    width: 40,
    backgroundColor: '#121214',
  },
  restInput: {
    width: 40,
    backgroundColor: '#121214',
  },
  setsInput: {
    width: 32,
    backgroundColor: '#121214',
  },
  workValue: {
    color: '#CCFF00',
    fontFamily: 'JetBrains Mono',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  restValue: {
    color: '#6B9EFA',
    fontFamily: 'JetBrains Mono',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  setsValue: {
    color: '#FFFFFF',
    fontFamily: 'JetBrains Mono',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  lockIcon: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    justifyContent: 'flex-end',
  },
  wheelSheet: {
    height: 300,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: '#121214',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: '#1F1F24',
  },
  wheelHeader: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  wheelTitle: {
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  wheelDone: {
    color: '#CCFF00',
    fontFamily: 'Geist',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  wheelViewport: {
    height: 220,
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#09090A',
  },
  wheelContent: {
    paddingVertical: 88,
  },
  wheelRow: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelValue: {
    color: '#94A3B8',
    fontFamily: 'JetBrains Mono',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  wheelSelectionFrame: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 88,
    height: 44,
    borderWidth: 1,
    borderColor: '#CCFF00',
    borderRadius: 8,
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
  addExerciseButton: {
    height: 58,
    flexShrink: 0,
    backgroundColor: '#0B0B0B',
    borderTopWidth: 1,
    borderTopColor: '#1F1F24',
    alignItems: 'center',
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
  startButton: {
    height: 54,
    borderRadius: 12,
    backgroundColor: '#CCFF00',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  startLabel: {
    color: '#09090A',
    fontFamily: 'Geist',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
  },
});
