import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, StatusBar, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Workout } from '../types';
import { loadWorkouts, deleteWorkout } from '../storage';
import { useIsFocused } from '@react-navigation/native';
import { getWorkoutDuration, workoutHasReps } from '../workoutLogic';
import { PencilIcon, DumbbellIcon, ClockIcon, ChevronIcon, DownloadIcon, PlusIcon } from '../components/WorkoutIcons';

type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function LibraryScreen({ navigation }: Props) {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused) {
      loadData();
    }
  }, [isFocused]);

  const loadData = async () => {
    const data = await loadWorkouts();
    setWorkouts(data);
  };

  const handleDelete = async (id: string) => {
    Alert.alert('Delete workout?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteWorkout(id);
          loadData();
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: Workout }) => {
    const exerciseCount = item.exercises.length;
    const totalSeconds = getWorkoutDuration(item);
    const hasReps = workoutHasReps(item);

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('WorkoutPreview', { workout: item })}
        onLongPress={() => handleDelete(item.id)}
        delayLongPress={600}
      >
        <View style={styles.cardInfo}>
          <View style={styles.workoutNameRow}>
            <Text style={styles.workoutName} numberOfLines={1}>{item.name}</Text>
            {hasReps && (
              <View style={styles.repsBadge} accessibilityLabel="Contains rep-based exercises">
                <DumbbellIcon size={13} color="#CCFF00" />
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.exerciseCount}>
              {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''}
              {item.rounds && item.rounds > 1 ? ` • ${item.rounds} rounds` : ''}
            </Text>
            <View style={styles.metaDot} />
            <View style={styles.durationGroup}>
              <ClockIcon color="#94A3B8" size={13} />
              <Text style={styles.durationValue}>{formatDuration(totalSeconds)}</Text>
            </View>
          </View>
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity
            onPress={() => navigation.navigate('WorkoutEditor', { workoutId: item.id })}
            hitSlop={8}
            accessibilityLabel={`Edit ${item.name}`}
          >
            <PencilIcon />
          </TouchableOpacity>
          <ChevronIcon color="#475569" size={16} direction="right" />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0B0B" />
      <View style={styles.topSection}>
        <View style={styles.statusBarSpacer} />
        <View style={styles.screenHeader}>
          <View style={styles.titleGroup}>
            <DumbbellIcon color="#CCFF00" size={22} />
            <Text style={styles.title}>My Workouts</Text>
          </View>
          {workouts.length > 0 && (
            <TouchableOpacity
              style={styles.importHeaderBtn}
              onPress={() => navigation.navigate('ImportVideo')}
              hitSlop={8}
              accessibilityLabel="Import workout"
            >
              <DownloadIcon color="#CCFF00" size={14} />
              <Text style={styles.importHeaderLabel}>Import</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <FlatList
        data={workouts}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={workouts.length === 0 ? styles.emptyListContainer : styles.listContainer}
        ListHeaderComponent={workouts.length > 0 ? <Text style={styles.sectionTitle}>Saved Routines ({workouts.length})</Text> : null}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.illustration}>
              <View style={styles.dumbbell}>
                <View style={styles.dumbbellPlate} />
                <View style={styles.dumbbellBar} />
                <View style={[styles.dumbbellPlate, styles.dumbbellPlateRight]} />
              </View>
            </View>
            <View style={styles.textGroup}>
              <Text style={styles.emptyTitle}>No workouts yet</Text>
              <Text style={styles.emptyDescription}>
                Import a YouTube video to build sets instantly or craft your exercises manually.
              </Text>
            </View>
            <View style={styles.buttonWrap}>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => navigation.navigate('ImportVideo')}
              >
                <DownloadIcon color="#09090A" size={20} />
                <Text style={styles.primaryButtonLabel}>Import Workout</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => navigation.navigate('WorkoutEditor', {})}
              >
                <Text style={styles.secondaryButtonLabel}>+ Build Custom Workout</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
      />
      <View style={styles.floatingAndFooter}>
        <View style={styles.fabRow}>
          <TouchableOpacity
            style={styles.fabImport}
            onPress={() => navigation.navigate('ImportVideo')}
            accessibilityLabel="Import workout"
          >
            <DownloadIcon color="#CCFF00" size={16} />
            <Text style={styles.fabImportLabel}>Import</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.fab}
            onPress={() => navigation.navigate('WorkoutEditor', {})}
            accessibilityLabel="Create new workout"
          >
            <PlusIcon color="#09090A" size={26} />
          </TouchableOpacity>
        </View>
        <View style={styles.footerSpace} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0B0B',
  },
  topSection: {
    height: 106,
    alignSelf: 'stretch',
  },
  statusBarSpacer: {
    height: 44,
  },
  screenHeader: {
    height: 62,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsButton: {
    width: 34,
    height: 34,
    borderRadius: 99,
    backgroundColor: '#121214',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIcon: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 20,
  },
  title: {
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 31,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 100,
    gap: 12,
  },
  emptyListContainer: {
    flexGrow: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
  },
  card: {
    height: 76,
    backgroundColor: '#121214',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F1F24',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  cardInfo: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  workoutNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  workoutName: {
    flexShrink: 1,
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
  },
  repsBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(204, 255, 0, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  exerciseCount: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 17,
  },
  metaDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#475569',
  },
  durationGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  durationValue: {
    color: '#CCFF00',
    fontFamily: 'Geist',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
  },
  cardActions: {
    width: 44,
    height: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: 12,
  },
  emptyState: {
    alignItems: 'center',
    gap: 32,
  },
  illustration: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: '#1F1F24',
    backgroundColor: '#121214',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dumbbell: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    transform: [{ rotate: '-45deg' }],
  },
  dumbbellBar: {
    height: 4,
    marginHorizontal: 5,
    backgroundColor: '#94A3B8',
    borderRadius: 2,
  },
  dumbbellPlate: {
    position: 'absolute',
    left: 4,
    width: 7,
    height: 28,
    borderWidth: 2,
    borderColor: '#94A3B8',
    borderRadius: 3,
  },
  dumbbellPlateRight: {
    left: undefined,
    right: 4,
  },
  textGroup: {
    alignItems: 'center',
    gap: 12,
    height: 80,
    alignSelf: 'stretch',
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
    textAlign: 'center',
  },
  emptyDescription: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 14,
    fontWeight: '400',
    height: 42,
    lineHeight: 21,
    textAlign: 'center',
  },
  buttonWrap: {
    alignSelf: 'stretch',
    paddingTop: 8,
    gap: 12,
  },
  primaryButton: {
    height: 54,
    borderRadius: 12,
    backgroundColor: '#CCFF00',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryButtonLabel: {
    color: '#09090A',
    fontFamily: 'Geist',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
  },
  secondaryButton: {
    height: 50,
    borderRadius: 12,
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1F1F24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonLabel: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  floatingAndFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 106,
  },
  importHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1F1F24',
  },
  importHeaderLabel: {
    color: '#CCFF00',
    fontFamily: 'Geist',
    fontSize: 13,
    fontWeight: '700',
  },
  fabRow: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 20,
    gap: 12,
  },
  fabImport: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#CCFF00',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 5,
  },
  fabImportLabel: {
    color: '#CCFF00',
    fontFamily: 'Geist',
    fontSize: 14,
    fontWeight: '700',
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#CCFF00',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 5,
  },
  footerSpace: {
    height: 50,
    paddingTop: 16,
    backgroundColor: '#09090A',
    alignItems: 'center',
  },
});
