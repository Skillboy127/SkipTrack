import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView, StatusBar, TextInput } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { RootStackParamList, Workout, WorkoutHistoryEntry, WeightUnit } from '../types';
import { loadHistory, deleteHistoryEntry, loadWeightUnit } from '../storage';
import { PlayIcon, TrashIcon, SearchIcon, CloseIcon } from '../components/WorkoutIcons';
import { ExerciseLogCard, groupRepLogs } from '../components/ExerciseLogCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AdBanner } from '../components/AdBanner';
import { BottomTabBar } from '../components/BottomTabBar';
import { Display, Label, Body } from '../components/PosterText';
import { band, colors, display, label, leading, rule, space, tracking } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;
type Section = { header: string; entries: WorkoutHistoryEntry[] };

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

function formatDateHeader(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'TODAY';
  if (date.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

function groupByDate(history: WorkoutHistoryEntry[]): Section[] {
  const sections: Section[] = [];
  for (const entry of history) {
    const header = formatDateHeader(entry.completedAt);
    const last = sections[sections.length - 1];
    if (last && last.header === header) {
      last.entries.push(entry);
    } else {
      sections.push({ header, entries: [entry] });
    }
  }
  return sections;
}

/** Consecutive-day streak ending today, or yesterday if today has no completed workout yet. */
function computeStreak(history: WorkoutHistoryEntry[]): number {
  if (history.length === 0) return 0;
  const days = new Set(history.map(entry => new Date(entry.completedAt).toDateString()));
  const cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function HistoryEntryCard({
  entry,
  onRepeat,
  onDelete,
  weightUnit,
}: {
  entry: WorkoutHistoryEntry;
  onRepeat: (workout: Workout) => void;
  onDelete: (entry: WorkoutHistoryEntry) => void;
  weightUnit: WeightUnit;
}) {
  const [expanded, setExpanded] = useState(false);
  const groupedLogs = useMemo(() => groupRepLogs(entry.repLogs), [entry.repLogs]);
  const hasLogs = groupedLogs.length > 0;
  // No hour12 option, so this follows the device's 12/24-hour setting.
  const time = new Date(entry.completedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const exerciseCount = entry.workout.exercises.length;

  return (
    <View style={styles.entry}>
      <View style={styles.entryTop}>
        {/* Time of day reads as a filled chip; duration is labelled DUR. */}
        <View style={styles.timeChip}>
          <Label style={styles.timeChipText}>{time}</Label>
        </View>
        <View style={styles.durationGroup}>
          <Label style={styles.durationLabel}>Dur</Label>
          <Display style={styles.durationValue}>{formatTime(entry.totalElapsedSeconds)}</Display>
        </View>
        <Pressable
          style={styles.entryDelete}
          onPress={() => onDelete(entry)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${entry.workout.name} from history`}
        >
          <TrashIcon color={colors.inkMuted} size={18} />
        </Pressable>
      </View>

      <Pressable
        onPress={() => { if (hasLogs) setExpanded(e => !e); }}
        disabled={!hasLogs}
        accessibilityRole={hasLogs ? 'button' : undefined}
        accessibilityLabel={hasLogs ? `Toggle logged sets for ${entry.workout.name}` : undefined}
      >
        <Display style={styles.entryName} numberOfLines={2}>{entry.workout.name || 'Workout'}</Display>
        <Label style={styles.entryMeta}>
          {exerciseCount} Exercise{exerciseCount !== 1 ? 's' : ''}{hasLogs ? ` · ${expanded ? 'Hide' : 'Show'} sets` : ''}
        </Label>
      </Pressable>

      {expanded && hasLogs && (
        <View style={styles.entryLogs}>
          {groupedLogs.map(group => (
            <ExerciseLogCard key={group.exerciseName} exerciseName={group.exerciseName} sets={group.sets} weightUnit={weightUnit} />
          ))}
        </View>
      )}

      <Pressable
        style={({ pressed }) => [styles.goAgain, pressed && styles.goAgainPressed]}
        onPress={() => onRepeat(entry.workout)}
        accessibilityRole="button"
        accessibilityLabel={`Repeat ${entry.workout.name}`}
      >
        <PlayIcon color={colors.ink} size={13} />
        <Label style={styles.goAgainLabel}>Go again</Label>
      </Pressable>
    </View>
  );
}

type PendingDelete = { entry: WorkoutHistoryEntry; index: number };

export function HistoryScreen({ navigation }: Props) {
  const [history, setHistory] = useState<WorkoutHistoryEntry[]>([]);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<WorkoutHistoryEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('lb');
  const pendingDeleteIdRef = useRef<string | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused) {
      loadHistory().then(data => {
        setHistory(pendingDeleteIdRef.current ? data.filter(entry => entry.id !== pendingDeleteIdRef.current) : data);
      });
      loadWeightUnit().then(setWeightUnit);
    }
  }, [isFocused]);

  const totalWorkouts = history.length;
  const totalActiveSeconds = useMemo(() => history.reduce((sum, entry) => sum + entry.totalElapsedSeconds, 0), [history]);
  const streak = useMemo(() => computeStreak(history), [history]);
  const filteredHistory = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return history;
    return history.filter(entry => (entry.workout.name || '').toLowerCase().includes(query));
  }, [history, searchQuery]);
  const sections = useMemo(() => groupByDate(filteredHistory), [filteredHistory]);

  const handleRepeat = (workout: Workout) => {
    navigation.navigate('WorkoutPreview', { workout });
  };

  const handleDeleteEntry = (entry: WorkoutHistoryEntry) => {
    setDeleteConfirmTarget(entry);
  };

  const confirmDeleteEntry = () => {
    const entry = deleteConfirmTarget;
    setDeleteConfirmTarget(null);
    if (!entry) return;

    const index = history.findIndex(h => h.id === entry.id);
    setHistory(current => current.filter(h => h.id !== entry.id));
    setPendingDelete({ entry, index });
    pendingDeleteIdRef.current = entry.id;
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    deleteTimer.current = setTimeout(() => {
      deleteHistoryEntry(entry.id);
      pendingDeleteIdRef.current = null;
      setPendingDelete(null);
    }, 4000);
  };

  const handleUndoDeleteEntry = () => {
    if (!pendingDelete) return;
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    setHistory(current => {
      const restored = [...current];
      restored.splice(Math.min(pendingDelete.index, restored.length), 0, pendingDelete.entry);
      return restored;
    });
    pendingDeleteIdRef.current = null;
    setPendingDelete(null);
  };

  const toggleSearch = () => {
    setSearchOpen(open => {
      if (open) setSearchQuery('');
      return !open;
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
      <View style={styles.statusBarSpacer} />

      <View style={styles.header}>
        <Display style={styles.hero} numberOfLines={1} adjustsFontSizeToFit>The Log</Display>
        {history.length > 0 && (
          <Pressable
            style={[styles.searchSquare, searchOpen && styles.searchSquareActive]}
            onPress={toggleSearch}
            accessibilityRole="button"
            accessibilityLabel={searchOpen ? 'Close search' : 'Search history'}
          >
            {searchOpen
              ? <CloseIcon color={colors.onInk} size={14} />
              : <SearchIcon color={colors.ink} size={16} />}
          </Pressable>
        )}
      </View>

      {history.length === 0 ? (
        <View style={styles.emptyState}>
          <Display style={styles.emptyTitle}>Nothing{'\n'}logged{'\n'}yet</Display>
          <Body style={styles.emptyBody}>
            Finish a workout and it lands here, with your streak and total time.
          </Body>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Display style={styles.statValue}>{totalWorkouts}</Display>
              <Label style={styles.statLabel}>Workouts</Label>
            </View>
            <View style={[styles.stat, styles.statDivider]}>
              <Display style={styles.statValue}>{formatTime(totalActiveSeconds)}</Display>
              <Label style={styles.statLabel}>Total time</Label>
            </View>
            <View style={[styles.stat, styles.statDivider, styles.statAccent]}>
              <Display style={styles.statValue}>{streak}</Display>
              <Label style={styles.statLabel}>Day streak</Label>
            </View>
          </View>

          {searchOpen && (
            <View style={styles.searchField}>
              <SearchIcon color={colors.ink} size={16} />
              <TextInput
                style={styles.searchInput}
                placeholder="SEARCH THE LOG"
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

          {filteredHistory.length === 0 ? (
            <View style={styles.noMatches}>
              <Display style={styles.noMatchesTitle}>No matches</Display>
              <Body style={styles.emptyBody}>Try a different search term.</Body>
            </View>
          ) : (
            sections.map(section => (
              <View key={section.header} style={styles.section}>
                <Label style={styles.sectionHeader}>{section.header}</Label>
                {section.entries.map(entry => (
                  <HistoryEntryCard
                    key={entry.id}
                    entry={entry}
                    onRepeat={handleRepeat}
                    onDelete={handleDeleteEntry}
                    weightUnit={weightUnit}
                  />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {pendingDelete && (
        <View style={styles.snackbar}>
          <Label style={styles.snackbarText} numberOfLines={1}>
            {pendingDelete.entry.workout.name || 'Workout'} removed
          </Label>
          <Pressable onPress={handleUndoDeleteEntry} hitSlop={10} accessibilityRole="button">
            <Label style={styles.undo}>Undo</Label>
          </Pressable>
        </View>
      )}

      <AdBanner />
      <BottomTabBar active="history" />

      <ConfirmDialog
        visible={deleteConfirmTarget !== null}
        title="Delete this session?"
        message={`Remove "${deleteConfirmTarget?.workout.name || 'Workout'}" from your history? You can undo this for a few seconds.`}
        onRequestClose={() => setDeleteConfirmTarget(null)}
        actions={[
          { label: 'Delete', variant: 'destructive', onPress: confirmDeleteEntry },
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
  header: {
    paddingHorizontal: space.gutter,
    paddingTop: space.tight,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.row,
  },
  hero: {
    flex: 1,
    fontSize: display.hero,
    lineHeight: Math.round(display.hero * leading.display),
    letterSpacing: tracking.display,
  },
  searchSquare: {
    width: band.control,
    height: band.control,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.tight,
  },
  searchSquareActive: {
    backgroundColor: colors.ink,
  },
  scroll: {
    paddingHorizontal: space.gutter,
    paddingTop: space.block,
    paddingBottom: space.block,
  },
  // ── Stats ─────────────────────────────────────────────────────────────────
  stats: {
    flexDirection: 'row',
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
  statAccent: {
    backgroundColor: colors.accent,
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
  // ── Search ────────────────────────────────────────────────────────────────
  searchField: {
    marginTop: space.row,
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
  // ── Entries ───────────────────────────────────────────────────────────────
  section: {
    marginTop: space.block,
  },
  sectionHeader: {
    fontSize: label.micro,
    color: colors.inkMuted,
    marginBottom: space.tight,
  },
  entry: {
    borderTopWidth: rule.heavy,
    borderTopColor: colors.ink,
    paddingVertical: space.row,
  },
  entryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.row,
  },
  timeChip: {
    backgroundColor: colors.ink,
    paddingHorizontal: space.tight,
    paddingVertical: space.hair + 1,
  },
  timeChipText: {
    color: colors.onInk,
    fontSize: label.small,
    letterSpacing: tracking.label,
  },
  durationGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.hair + 2,
  },
  durationLabel: {
    fontSize: label.micro,
    color: colors.inkMuted,
  },
  durationValue: {
    fontSize: display.entryTitle,
    lineHeight: display.entryTitle * leading.snug,
    fontVariant: ['tabular-nums'],
  },
  entryDelete: {
    width: band.control,
    height: band.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -space.row,
  },
  entryName: {
    marginTop: space.tight,
    fontSize: display.rowTitle,
    lineHeight: display.rowTitle * leading.snug,
  },
  entryMeta: {
    marginTop: space.hair,
    fontSize: label.micro,
    color: colors.inkMuted,
  },
  entryLogs: {
    marginTop: space.row,
    gap: space.tight,
  },
  goAgain: {
    alignSelf: 'flex-start',
    marginTop: space.row,
    minHeight: band.control,
    paddingHorizontal: space.block,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
  },
  goAgainPressed: {
    backgroundColor: colors.rowPress,
  },
  goAgainLabel: {
    fontSize: label.small,
    letterSpacing: tracking.wide,
  },
  // ── Empty ─────────────────────────────────────────────────────────────────
  emptyState: {
    flex: 1,
    paddingHorizontal: space.gutter,
    justifyContent: 'center',
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
  noMatches: {
    paddingTop: space.block * 2,
    gap: space.tight,
  },
  noMatchesTitle: {
    fontSize: display.rowTitle,
    lineHeight: display.rowTitle * leading.snug,
  },
  // ── Snackbar ──────────────────────────────────────────────────────────────
  snackbar: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    bottom: band.tabBar + band.adStrip + space.block,
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
