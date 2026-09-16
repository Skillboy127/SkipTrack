import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, StatusBar, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Workout } from '../types';
import { loadWorkouts, deleteWorkout } from '../storage';
import { useIsFocused } from '@react-navigation/native';
import { getWorkoutDuration } from '../workoutLogic';
import { PencilIcon } from '../components/WorkoutIcons';

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

    return (
      <TouchableOpacity 
        style={styles.card} 
        onPress={() => navigation.navigate('WorkoutPreview', { workout: item })}
        onLongPress={() => handleDelete(item.id)}
        delayLongPress={600}
      >
        <View style={styles.cardInfo}>
          <Text style={styles.workoutName} numberOfLines={1}>{item.name}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.exerciseCount}>{exerciseCount} exercises</Text>
            <View style={styles.metaDot} />
            <View style={styles.durationGroup}>
              <Text style={styles.clockIcon}>◷</Text>
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
          <Text style={styles.chevron}>›</Text>
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
            <Text style={styles.trendingIcon}>↗</Text>
            <Text style={styles.title}>My Workouts</Text>
          </View>
          {workouts.length > 0 && (
            <TouchableOpacity style={styles.settingsButton} hitSlop={8}>
              <Text style={styles.settingsIcon}>⚙</Text>
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
                <View style={styles.downloadIcon}>
                  <View style={styles.downloadArrow} />
                  <View style={styles.downloadTray} />
                </View>
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
            style={styles.fab}
            onPress={() => navigation.navigate('WorkoutEditor', {})}
            accessibilityLabel="Create new workout"
          >
            <Text style={styles.plusIcon}>+</Text>
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
  trendingIcon: {
    color: '#CCFF00',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 24,
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
  workoutName: {
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
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
  clockIcon: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 16,
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
  chevron: {
    color: '#475569',
    fontSize: 24,
    lineHeight: 18,
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
  downloadIcon: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadArrow: {
    width: 2,
    height: 12,
    backgroundColor: '#09090A',
  },
  downloadTray: {
    position: 'absolute',
    bottom: 2,
    width: 16,
    height: 6,
    borderWidth: 2,
    borderTopWidth: 0,
    borderColor: '#09090A',
    borderRadius: 2,
  },
  floatingAndFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 106,
  },
  fabRow: {
    height: 56,
    alignItems: 'flex-end',
    paddingRight: 20,
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
  plusIcon: {
    color: '#09090A',
    fontSize: 30,
    fontWeight: '400',
    lineHeight: 32,
  },
  footerSpace: {
    height: 50,
    paddingTop: 16,
    backgroundColor: '#09090A',
    alignItems: 'center',
  },
});
