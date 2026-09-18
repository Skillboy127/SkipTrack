import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PencilIcon, ChevronIcon, LockIcon, CheckIcon } from '../components/WorkoutIcons';
import { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkoutPreview'>;

function isRepBased(ex: { reps?: number | null; workSeconds: number }): boolean {
  return ex.reps != null && ex.reps > 0 && ex.workSeconds <= 0;
}

export function WorkoutPreviewScreen({ route, navigation }: Props) {
  const { workout } = route.params;

  const onStart = () => {
    navigation.replace('ActiveSession', { workout });
  };

  const handleEdit = () => {
    navigation.navigate('WorkoutEditor', { workoutId: workout.id });
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
            <View style={styles.headerRightGroup}>
              <Text style={styles.modeLabel}>READY</Text>
              <TouchableOpacity style={styles.editButton} onPress={handleEdit} accessibilityLabel="Edit workout">
                <PencilIcon color="#94A3B8" size={14} />
                <Text style={styles.editButtonLabel}>Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.titleField}>
            <Text style={styles.title} numberOfLines={1}>{workout.name}</Text>
          </View>
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>
            EXERCISE LIST ({workout.exercises.length} ITEMS{workout.rounds && workout.rounds > 1 ? ` • ${workout.rounds} ROUNDS` : ''})
          </Text>
        </View>
        <View style={styles.exerciseList}>
          {workout.exercises.map((ex, index) => (
            <View key={ex.id || index} style={styles.exerciseRow}>
              <View style={styles.exerciseLeft}>
                <Text style={styles.exerciseIndex}>{index + 1}</Text>
                <Text style={styles.exerciseName} numberOfLines={2}>{ex.name}</Text>
              </View>
              <View style={styles.metricsInputs}>
                <View style={[styles.metricInput, styles.workInput]}>
                  <Text style={styles.workValue} numberOfLines={1}>{isRepBased(ex) ? `${ex.reps}r` : `${ex.workSeconds}s`}</Text>
                </View>
                <View style={[styles.metricInput, styles.restInput]}>
                  <Text style={styles.restValue} numberOfLines={1}>{ex.restSeconds}s</Text>
                </View>
                <View style={[styles.metricInput, styles.setsInput]}>
                  <Text style={styles.setsValue} numberOfLines={1}>{ex.sets}×</Text>
                </View>
                <View style={styles.lockIcon}><LockIcon /></View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.startButton} onPress={onStart}>
          <CheckIcon color="#09090A" size={20} />
          <Text style={styles.startLabel}>START WORKOUT</Text>
        </TouchableOpacity>
      </View>
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
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modeLabel: {
    color: '#CCFF00',
    fontFamily: 'Geist',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1F1F24',
  },
  editButtonLabel: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 12,
    fontWeight: '700',
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
  exerciseLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    minWidth: 0,
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  metricsInputs: {
    minWidth: 174,
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginLeft: 12,
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
    minWidth: 40,
    backgroundColor: '#121214',
  },
  restInput: {
    minWidth: 40,
    backgroundColor: '#121214',
  },
  setsInput: {
    minWidth: 40,
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
  footer: {
    height: 112,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 8,
    backgroundColor: '#09090A',
    borderTopWidth: 1,
    borderTopColor: '#1F1F24',
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
