import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, StatusBar, TextInput } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Workout } from '../types';
import { loadWorkouts, deleteWorkout } from '../storage';
import { useIsFocused } from '@react-navigation/native';
import { getWorkoutDuration, workoutHasReps } from '../workoutLogic';
import { PencilIcon, DumbbellIcon, ClockIcon, ChevronIcon, DownloadIcon, PlusIcon, SearchIcon, CloseIcon, SettingsIcon } from '../components/WorkoutIcons';
import { ConfirmDialog } from '../components/ConfirmDialog';

type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

type PendingDelete = { workout: Workout; index: number };
type FilterMode = 'all' | 'timed' | 'reps';
type SortMode = 'recent' | 'name' | 'duration' | 'exercises';

const SORT_ORDER: SortMode[] = ['recent', 'name', 'duration', 'exercises'];
const SORT_LABELS: Record<SortMode, string> = {
  recent: 'Recent',
  name: 'Name A–Z',
  duration: 'Duration',
  exercises: 'Most Exercises',
};

export function LibraryScreen({ navigation }: Props) {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<Workout | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const pendingDeleteIdRef = useRef<string | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused) {
      loadData();
    }
  }, [isFocused]);

  const loadData = async () => {
    const data = await loadWorkouts();
    setWorkouts(pendingDeleteIdRef.current ? data.filter(w => w.id !== pendingDeleteIdRef.current) : data);
  };

  const displayedWorkouts = useMemo(() => {
    let list = workouts;
    if (filterMode === 'reps') list = list.filter(workoutHasReps);
    else if (filterMode === 'timed') list = list.filter(w => !workoutHasReps(w));

    const query = searchQuery.trim().toLowerCase();
    if (query) list = list.filter(w => w.name.toLowerCase().includes(query));

    const withDuration = list.map(w => ({ workout: w, duration: getWorkoutDuration(w) }));
    switch (sortMode) {
      case 'name':
        withDuration.sort((a, b) => a.workout.name.localeCompare(b.workout.name));
        break;
      case 'duration':
        withDuration.sort((a, b) => a.duration - b.duration);
        break;
      case 'exercises':
        withDuration.sort((a, b) => b.workout.exercises.length - a.workout.exercises.length);
        break;
      case 'recent':
      default:
        withDuration.sort((a, b) => (b.workout.createdAt ?? 0) - (a.workout.createdAt ?? 0));
        break;
    }
    return withDuration.map(item => item.workout);
  }, [workouts, filterMode, searchQuery, sortMode]);

  const isFiltering = searchQuery.trim().length > 0 || filterMode !== 'all';

  const cycleSortMode = () => {
    const currentIndex = SORT_ORDER.indexOf(sortMode);
    setSortMode(SORT_ORDER[(currentIndex + 1) % SORT_ORDER.length]);
  };

  const clearSearchAndFilters = () => {
    setSearchQuery('');
    setFilterMode('all');
  };

  const handleDelete = (workout: Workout) => {
    setDeleteConfirmTarget(workout);
  };

  const confirmDelete = () => {
    const workout = deleteConfirmTarget;
    setDeleteConfirmTarget(null);
    if (!workout) return;

    const index = workouts.findIndex(w => w.id === workout.id);
    setWorkouts(current => current.filter(w => w.id !== workout.id));
    setPendingDelete({ workout, index });
    pendingDeleteIdRef.current = workout.id;
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    deleteTimer.current = setTimeout(() => {
      deleteWorkout(workout.id);
      pendingDeleteIdRef.current = null;
      setPendingDelete(null);
    }, 4000);
  };

  const handleUndoDelete = () => {
    if (!pendingDelete) return;
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    setWorkouts(current => {
      const restored = [...current];
      restored.splice(Math.min(pendingDelete.index, restored.length), 0, pendingDelete.workout);
      return restored;
    });
    pendingDeleteIdRef.current = null;
    setPendingDelete(null);
  };

  const renderItem = ({ item }: { item: Workout }) => {
    const exerciseCount = item.exercises.length;
    const hasReps = workoutHasReps(item);

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('WorkoutPreview', { workout: item })}
        onLongPress={() => handleDelete(item)}
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
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.historyHeaderBtn}
              onPress={() => navigation.navigate('History')}
              hitSlop={8}
              accessibilityLabel="View workout history"
            >
              <ClockIcon color="#94A3B8" size={14} />
              <Text style={styles.historyHeaderLabel}>History</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsHeaderBtn}
              onPress={() => navigation.navigate('Settings')}
              hitSlop={8}
              accessibilityLabel="Open settings"
            >
              <SettingsIcon color="#94A3B8" size={16} />
            </TouchableOpacity>
          </View>
        </View>
        {workouts.length > 0 && (
          <View style={styles.searchSection}>
            <View style={styles.searchBar}>
              <SearchIcon color="#64748B" size={15} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search workouts"
                placeholderTextColor="#64748B"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                  <CloseIcon color="#64748B" size={13} />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.filterSortRow}>
              <View style={styles.chipGroup}>
                {(['all', 'timed', 'reps'] as const).map(mode => (
                  <TouchableOpacity
                    key={mode}
                    style={[styles.chip, filterMode === mode && styles.chipActive]}
                    onPress={() => setFilterMode(mode)}
                  >
                    <Text style={[styles.chipText, filterMode === mode && styles.chipTextActive]}>
                      {mode === 'all' ? 'All' : mode === 'timed' ? 'Timed' : 'Reps'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={styles.sortButton} onPress={cycleSortMode} accessibilityLabel="Change sort order">
                <Text style={styles.sortButtonText}>{SORT_LABELS[sortMode]}</Text>
                <ChevronIcon color="#94A3B8" size={10} direction="down" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
      <FlatList
        style={styles.list}
        data={displayedWorkouts}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={displayedWorkouts.length === 0 ? styles.emptyListContainer : styles.listContainer}
        ListHeaderComponent={
          workouts.length > 0 ? (
            <Text style={styles.sectionTitle}>
              {isFiltering ? `${displayedWorkouts.length} OF ${workouts.length} ROUTINES` : `Saved Routines (${workouts.length})`}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          workouts.length === 0 ? (
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
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.illustration}>
                <SearchIcon color="#94A3B8" size={30} />
              </View>
              <View style={styles.textGroup}>
                <Text style={styles.emptyTitle}>No matches</Text>
                <Text style={styles.emptyDescription}>Try a different search term or clear your filters.</Text>
              </View>
              <TouchableOpacity style={styles.secondaryButton} onPress={clearSearchAndFilters}>
                <Text style={styles.secondaryButtonLabel}>Clear Search & Filters</Text>
              </TouchableOpacity>
            </View>
          )
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
      {pendingDelete && (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText} numberOfLines={1}>"{pendingDelete.workout.name}" removed</Text>
          <TouchableOpacity onPress={handleUndoDelete}>
            <Text style={styles.undoText}>UNDO</Text>
          </TouchableOpacity>
        </View>
      )}
      <ConfirmDialog
        visible={deleteConfirmTarget !== null}
        title="Delete workout?"
        message={`Remove "${deleteConfirmTarget?.name ?? ''}"? You can undo this for a few seconds.`}
        onRequestClose={() => setDeleteConfirmTarget(null)}
        actions={[
          { label: 'Delete', variant: 'destructive', onPress: confirmDelete },
          { label: 'Cancel', variant: 'neutral', onPress: () => setDeleteConfirmTarget(null) },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0B0B',
  },
  topSection: {
    alignSelf: 'stretch',
  },
  list: {
    flex: 1,
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
  cardActions: {
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchSection: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 10,
  },
  searchBar: {
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1F1F24',
    backgroundColor: '#121214',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 14,
  },
  filterSortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  chipGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#1F1F24',
    backgroundColor: '#121214',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    borderColor: '#CCFF00',
    backgroundColor: 'rgba(204, 255, 0, 0.12)',
  },
  chipText: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 12,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#CCFF00',
  },
  sortButton: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sortButtonText: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 12,
    fontWeight: '600',
  },
  historyHeaderBtn: {
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
  historyHeaderLabel: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 13,
    fontWeight: '700',
  },
  settingsHeaderBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#121214',
    borderWidth: 1,
    borderColor: '#1F1F24',
    alignItems: 'center',
    justifyContent: 'center',
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
  snackbar: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 118,
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
    flex: 1,
    marginRight: 12,
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
});
