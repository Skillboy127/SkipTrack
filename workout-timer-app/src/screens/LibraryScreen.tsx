import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, Pressable, StatusBar, TextInput, Image, Animated, useWindowDimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, ServerUsage, Workout } from '../types';
import { loadWorkouts, deleteWorkout, saveWorkout, saveWorkouts } from '../storage';
import { useIsFocused } from '@react-navigation/native';
import { getWorkoutDuration, workoutHasReps } from '../workoutLogic';
import { getLastKnownUsage } from '../api';
import { PlayIcon, PlusIcon, SearchIcon, CloseIcon, DragHandleIcon } from '../components/WorkoutIcons';
import { ReorderableList, ReorderItemInfo, ReorderScrollView } from '../components/ReorderableList';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BottomTabBar } from '../components/BottomTabBar';
import { Display, Label, Body } from '../components/PosterText';
import { band, colors, display, label, leading, rule, space, tracking } from '../theme';

const generateId = () => Math.random().toString(36).substring(2, 9);

type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

type PendingDelete = { workout: Workout; index: number };
type FilterMode = 'all' | 'timed' | 'reps';
type SortMode = 'recent' | 'custom' | 'name' | 'duration' | 'exercises';

const SORT_ORDER: SortMode[] = ['recent', 'custom', 'name', 'duration', 'exercises'];
const SORT_LABELS: Record<SortMode, string> = {
  recent: 'Recent',
  custom: 'Custom',
  name: 'Name A–Z',
  duration: 'Duration',
  exercises: 'Most',
};

const FILTERS: { key: FilterMode; title: string }[] = [
  { key: 'all', title: 'All' },
  { key: 'timed', title: 'Timed' },
  { key: 'reps', title: 'Reps' },
];

export function LibraryScreen({ navigation }: Props) {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<Workout | null>(null);
  const [actionMenuTarget, setActionMenuTarget] = useState<Workout | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [reorderMode, setReorderMode] = useState(false);
  const [usage, setUsage] = useState<ServerUsage | null>(getLastKnownUsage());
  const pendingDeleteIdRef = useRef<string | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocused = useIsFocused();

  // The hero is sized to fill the line, then collapses as the list scrolls so
  // only the wordmark row stays pinned.
  const { width } = useWindowDimensions();
  const heroSize = Math.min(104, Math.round((width - space.gutter * 2) / 3.75));
  const heroHeight = Math.round(heroSize * leading.display) + space.tight;
  const [scrollY] = useState(() => new Animated.Value(0));
  const heroCollapse = {
    height: scrollY.interpolate({
      inputRange: [0, heroHeight],
      outputRange: [heroHeight, 0],
      extrapolate: 'clamp' as const,
    }),
    opacity: scrollY.interpolate({
      inputRange: [0, heroHeight * 0.6],
      outputRange: [1, 0],
      extrapolate: 'clamp' as const,
    }),
  };

  useEffect(() => {
    if (isFocused) {
      loadData();
      // Whatever the server last told us; the Import screen owns fetching it.
      setUsage(getLastKnownUsage());
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
      case 'custom':
        // The stored order is the user's own arrangement; leave it untouched.
        break;
      case 'recent':
      default:
        withDuration.sort((a, b) => (b.workout.createdAt ?? 0) - (a.workout.createdAt ?? 0));
        break;
    }
    return withDuration.map(item => item.workout);
  }, [workouts, filterMode, searchQuery, sortMode]);

  const isFiltering = searchQuery.trim().length > 0 || filterMode !== 'all';
  // Reordering only makes sense on the full, unfiltered list.
  const reordering = reorderMode && !isFiltering;

  const startReordering = () => {
    // Switching to Custom keeps what's on screen: freeze the current order as the
    // stored one, so nothing jumps when the mode changes.
    if (sortMode !== 'custom') {
      setWorkouts(displayedWorkouts);
      saveWorkouts(displayedWorkouts);
      setSortMode('custom');
    }
    setReorderMode(true);
  };

  const handleReorder = (from: number, to: number) => {
    const next = [...workouts];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setWorkouts(next);
    saveWorkouts(next);
  };

  const cycleSortMode = () => {
    const currentIndex = SORT_ORDER.indexOf(sortMode);
    setSortMode(SORT_ORDER[(currentIndex + 1) % SORT_ORDER.length]);
  };

  const clearSearchAndFilters = () => {
    setSearchQuery('');
    setFilterMode('all');
  };

  const toggleSearch = () => {
    setReorderMode(false);
    setSearchOpen(open => {
      if (open) setSearchQuery('');
      return !open;
    });
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

  const handleDuplicate = async (workout: Workout) => {
    const duplicate: Workout = {
      ...workout,
      id: generateId(),
      name: `${workout.name} (Copy)`,
      createdAt: Date.now(),
    };
    await saveWorkout(duplicate);
    loadData();
  };

  const handleDuplicateFromMenu = () => {
    const workout = actionMenuTarget;
    setActionMenuTarget(null);
    if (workout) handleDuplicate(workout);
  };

  const handleEditFromMenu = () => {
    const workout = actionMenuTarget;
    setActionMenuTarget(null);
    if (workout) navigation.navigate('WorkoutEditor', { workoutId: workout.id });
  };

  const handleDeleteFromMenu = () => {
    const workout = actionMenuTarget;
    setActionMenuTarget(null);
    if (workout) handleDelete(workout);
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

  const renderItem = ({ item, index }: { item: Workout; index: number }) => {
    const exerciseCount = item.exercises.length;
    const rounds = item.rounds && item.rounds > 1 ? ` / ${item.rounds} Rounds` : '';
    const reps = workoutHasReps(item) ? ' / Reps' : '';

    return (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => navigation.navigate('WorkoutPreview', { workout: item })}
        onLongPress={() => setActionMenuTarget(item)}
        delayLongPress={500}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}. ${exerciseCount} exercises. Long press for more actions.`}
      >
        <View style={styles.numeralCol}>
          <Display style={styles.numeral}>{String(index + 1).padStart(2, '0')}</Display>
        </View>
        <View style={styles.rowBody}>
          <Display style={styles.rowTitle} numberOfLines={1}>{item.name}</Display>
          <Label style={styles.rowMeta} numberOfLines={1}>
            {exerciseCount} Exercise{exerciseCount !== 1 ? 's' : ''}{rounds}{reps}
          </Label>
        </View>
        <View style={styles.playSquare}>
          <PlayIcon color={colors.ink} size={20} />
        </View>
      </Pressable>
    );
  };

  const renderReorderItem = ({ item, index, active, dragProps }: ReorderItemInfo<Workout>) => {
    const exerciseCount = item.exercises.length;
    const rounds = item.rounds && item.rounds > 1 ? ` / ${item.rounds} Rounds` : '';
    const reps = workoutHasReps(item) ? ' / Reps' : '';

    return (
      <View
        style={[styles.row, styles.rowReorder, active && styles.rowActive]}
        {...dragProps()}
        accessibilityLabel={`${item.name}. Hold and drag to reorder.`}
      >
        <View style={styles.numeralCol}>
          <Display style={styles.numeral}>{String(index + 1).padStart(2, '0')}</Display>
        </View>
        <View style={styles.rowBody}>
          <Display style={styles.rowTitle} numberOfLines={1}>{item.name}</Display>
          <Label style={styles.rowMeta} numberOfLines={1}>
            {exerciseCount} Exercise{exerciseCount !== 1 ? 's' : ''}{rounds}{reps}
          </Label>
        </View>
        {/* The handle lifts the row the moment it's touched. */}
        <View style={styles.playSquare} {...dragProps(0)} accessibilityLabel="Drag to reorder">
          <DragHandleIcon color={colors.ink} size={22} />
        </View>
      </View>
    );
  };

  const emptyState = workouts.length === 0 ? (
    <View style={styles.emptyState}>
      <Display style={styles.emptyTitle}>No{'\n'}workouts{'\n'}yet</Display>
      <Body style={styles.emptyBody}>
        Import a workout from a photo or text, or build your exercises by hand.
      </Body>
      <Pressable
        style={({ pressed }) => [styles.emptyAction, pressed && styles.emptyActionPressed]}
        onPress={() => navigation.navigate('WorkoutEditor', {})}
        accessibilityRole="button"
      >
        <Label style={styles.emptyActionLabel}>+ Build a workout</Label>
      </Pressable>
    </View>
  ) : (
    <View style={styles.emptyState}>
      <Display style={styles.emptyTitle}>No{'\n'}matches</Display>
      <Body style={styles.emptyBody}>Try a different search term, or clear your filters.</Body>
      <Pressable
        style={({ pressed }) => [styles.emptyAction, pressed && styles.emptyActionPressed]}
        onPress={clearSearchAndFilters}
        accessibilityRole="button"
      >
        <Label style={styles.emptyActionLabel}>Clear search &amp; filters</Label>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
      <View style={styles.statusBarSpacer} />

      <View style={styles.header}>
        <View style={styles.brand}>
          <Image source={require('../../assets/flex-mark.png')} style={styles.mark} />
          <Display style={styles.wordmark}>Flex</Display>
        </View>
        {usage !== null && (
          <View style={styles.importsLeft}>
            <View style={styles.importsDot} />
            <Label style={styles.importsLabel}>{usage.remaining} Imports Left</Label>
          </View>
        )}
      </View>

      <Animated.View style={[styles.heroWrap, heroCollapse]}>
        <Display
          style={[styles.hero, { fontSize: heroSize, lineHeight: Math.round(heroSize * leading.display) }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          Workouts
        </Display>
      </Animated.View>

      <View style={styles.filterBar}>
        {FILTERS.map((filter, index) => {
          const selected = filter.key === filterMode;
          return (
            <Pressable
              key={filter.key}
              style={[styles.filter, index > 0 && styles.filterDivider, selected && styles.filterActive]}
              onPress={() => {
                setReorderMode(false);
                setFilterMode(filter.key);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Label style={[styles.filterLabel, selected && styles.filterLabelActive]}>{filter.title}</Label>
            </Pressable>
          );
        })}
        <Pressable
          style={[styles.searchSquare, styles.filterDivider, searchOpen && styles.filterActive]}
          onPress={toggleSearch}
          accessibilityRole="button"
          accessibilityLabel={searchOpen ? 'Close search' : 'Search workouts'}
        >
          {searchOpen
            ? <CloseIcon color={colors.onInk} size={14} />
            : <SearchIcon color={colors.ink} size={16} />}
        </Pressable>
      </View>

      {searchOpen && (
        <View style={styles.searchField}>
          <SearchIcon color={colors.ink} size={16} />
          <TextInput
            style={styles.searchInput}
            placeholder="SEARCH WORKOUTS"
            placeholderTextColor={colors.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
          />
        </View>
      )}

      {workouts.length > 0 && (
        <View style={styles.sectionLine}>
          <Label style={styles.sectionCount}>
            {reordering
              ? 'Hold a row, then drag'
              : isFiltering
                ? `${displayedWorkouts.length} of ${workouts.length} Routines`
                : `${workouts.length} Routines`}
          </Label>
          <View style={styles.sectionActions}>
            {!reordering && (
              <Pressable onPress={cycleSortMode} hitSlop={10} accessibilityRole="button" accessibilityLabel="Change sort order">
                <Label style={styles.sortLabel}>Sort: {SORT_LABELS[sortMode]}</Label>
              </Pressable>
            )}
            {workouts.length > 1 && !isFiltering && !searchOpen && (
              <Pressable
                style={[styles.reorderBtn, reordering && styles.reorderBtnActive]}
                onPress={reordering ? () => setReorderMode(false) : startReordering}
                disabled={pendingDelete !== null}
                accessibilityRole="button"
                accessibilityLabel={reordering ? 'Finish reordering' : 'Reorder workouts'}
              >
                <Label style={[styles.reorderLabel, reordering && styles.reorderLabelActive]}>
                  {reordering ? 'Done' : 'Reorder'}
                </Label>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {reordering ? (
        <ReorderScrollView
          style={styles.list}
          contentContainerStyle={styles.listContainer}
          onScroll={e => scrollY.setValue(e.nativeEvent.contentOffset.y)}
        >
          <ReorderableList
            data={displayedWorkouts}
            keyExtractor={item => item.id}
            onReorder={handleReorder}
            renderItem={renderReorderItem}
          />
        </ReorderScrollView>
      ) : (
      <FlatList
        style={styles.list}
        data={displayedWorkouts}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={displayedWorkouts.length === 0 ? styles.emptyListContainer : styles.listContainer}
        ListEmptyComponent={emptyState}
        keyboardShouldPersistTaps="handled"
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
      />
      )}

      <Pressable
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        onPress={() => navigation.navigate('Import')}
        accessibilityRole="button"
        accessibilityLabel="Import a workout"
      >
        <Display style={styles.ctaLabel}>Import a workout</Display>
        <Pressable
          style={styles.ctaSquare}
          onPress={() => navigation.navigate('WorkoutEditor', {})}
          accessibilityRole="button"
          accessibilityLabel="Build a workout by hand"
        >
          <PlusIcon color={colors.ink} size={20} />
        </Pressable>
      </Pressable>

      {pendingDelete && (
        <View style={styles.snackbar}>
          <Label style={styles.snackbarText} numberOfLines={1}>{pendingDelete.workout.name} removed</Label>
          <Pressable onPress={handleUndoDelete} hitSlop={10} accessibilityRole="button">
            <Label style={styles.undo}>Undo</Label>
          </Pressable>
        </View>
      )}

      <BottomTabBar active="workouts" />

      <ConfirmDialog
        visible={actionMenuTarget !== null}
        title={actionMenuTarget?.name ?? 'Workout'}
        onRequestClose={() => setActionMenuTarget(null)}
        actions={[
          { label: 'Edit', variant: 'primary', onPress: handleEditFromMenu },
          { label: 'Duplicate', variant: 'neutral', onPress: handleDuplicateFromMenu },
          { label: 'Delete', variant: 'destructive', onPress: handleDeleteFromMenu },
          { label: 'Cancel', variant: 'neutral', onPress: () => setActionMenuTarget(null) },
        ]}
      />
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
    backgroundColor: colors.paper,
  },
  statusBarSpacer: {
    height: band.statusBar,
  },
  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: space.gutter,
    paddingTop: space.tight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
  },
  mark: {
    width: 26,
    height: 26,
  },
  wordmark: {
    fontSize: display.wordmark,
    letterSpacing: 0.4,
  },
  importsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.hair + 2,
  },
  importsDot: {
    width: 10,
    height: 10,
    backgroundColor: colors.accent,
  },
  importsLabel: {
    fontSize: label.small,
  },
  // ── Hero ──────────────────────────────────────────────────────────────────
  heroWrap: {
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  hero: {
    paddingHorizontal: space.gutter,
    letterSpacing: tracking.display,
  },
  // ── Filter bar ────────────────────────────────────────────────────────────
  filterBar: {
    marginHorizontal: space.gutter,
    marginTop: space.block,
    flexDirection: 'row',
    borderWidth: rule.heavy,
    borderColor: colors.ink,
  },
  filter: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDivider: {
    borderLeftWidth: rule.heavy,
    borderLeftColor: colors.ink,
  },
  filterActive: {
    backgroundColor: colors.ink,
  },
  filterLabel: {
    fontSize: label.base,
    letterSpacing: tracking.label,
  },
  filterLabelActive: {
    color: colors.onInk,
  },
  searchSquare: {
    width: band.search,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchField: {
    marginHorizontal: space.gutter,
    marginTop: space.tight,
    height: band.control,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
    paddingHorizontal: space.row,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    color: colors.ink,
    fontSize: label.base,
    letterSpacing: tracking.label,
  },
  // ── Section line ──────────────────────────────────────────────────────────
  sectionLine: {
    paddingHorizontal: space.gutter,
    paddingTop: space.block,
    paddingBottom: space.tight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionCount: {
    fontSize: label.micro,
  },
  sortLabel: {
    fontSize: label.micro,
    color: colors.inkMuted,
  },
  sectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.row,
  },
  reorderBtn: {
    minHeight: band.control,
    paddingHorizontal: space.row,
    justifyContent: 'center',
    borderWidth: rule.heavy,
    borderColor: colors.ink,
  },
  reorderBtnActive: {
    backgroundColor: colors.ink,
  },
  reorderLabel: {
    fontSize: label.micro,
    letterSpacing: tracking.wide,
  },
  reorderLabelActive: {
    color: colors.onInk,
  },
  // ── Rows ──────────────────────────────────────────────────────────────────
  list: {
    flex: 1,
  },
  listContainer: {
    borderBottomWidth: rule.heavy,
    borderBottomColor: colors.ink,
  },
  emptyListContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: rule.heavy,
    borderTopColor: colors.ink,
    height: band.row,
  },
  rowPressed: {
    backgroundColor: colors.rowPress,
  },
  // Rows in reorder mode need an opaque face so a lifted row covers its neighbours.
  rowReorder: {
    backgroundColor: colors.paper,
  },
  rowActive: {
    backgroundColor: colors.rowPress,
  },
  numeralCol: {
    width: band.numeralCol,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numeral: {
    fontSize: display.rowNumeral,
    lineHeight: display.rowNumeral * leading.snug,
  },
  rowBody: {
    flex: 1,
    paddingVertical: space.tight,
    paddingRight: space.row,
    justifyContent: 'center',
    minWidth: 0,
  },
  rowTitle: {
    fontSize: display.entryTitle,
    lineHeight: display.entryTitle * leading.snug,
  },
  rowMeta: {
    fontSize: label.small,
    marginTop: space.hair,
  },
  playSquare: {
    width: band.play,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: rule.heavy,
    borderLeftColor: colors.ink,
  },
  // ── Empty states ──────────────────────────────────────────────────────────
  emptyState: {
    paddingHorizontal: space.gutter,
    gap: space.block,
  },
  emptyTitle: {
    fontSize: 56,
    lineHeight: 56 * leading.display,
    letterSpacing: tracking.display,
  },
  emptyBody: {
    fontSize: label.base,
    lineHeight: label.base * 1.5,
    color: colors.inkMuted,
  },
  emptyAction: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.block,
    paddingVertical: space.row,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
  },
  emptyActionPressed: {
    backgroundColor: colors.rowPress,
  },
  emptyActionLabel: {
    fontSize: label.small,
    letterSpacing: tracking.wide,
  },
  // ── Call to action ────────────────────────────────────────────────────────
  cta: {
    height: band.cta,
    marginHorizontal: space.gutter,
    marginVertical: space.row,
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
  // ── Snackbar ──────────────────────────────────────────────────────────────
  snackbar: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    bottom: band.tabBar + band.cta + space.block,
    minHeight: band.actionHeight,
    paddingHorizontal: space.block,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.row,
  },
  snackbarText: {
    flex: 1,
    color: colors.onInk,
    fontSize: label.small,
  },
  undo: {
    color: colors.accent,
    fontSize: label.small,
    letterSpacing: tracking.wide,
  },
});
