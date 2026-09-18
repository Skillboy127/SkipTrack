import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { RootStackParamList, Workout, WorkoutHistoryEntry } from '../types';
import { loadHistory } from '../storage';
import { ChevronIcon, DumbbellIcon, PlayIcon } from '../components/WorkoutIcons';
import { ExerciseLogCard, groupRepLogs } from '../components/ExerciseLogCard';

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

function HistoryEntryCard({ entry, onRepeat }: { entry: WorkoutHistoryEntry; onRepeat: (workout: Workout) => void }) {
  const [expanded, setExpanded] = useState(false);
  const groupedLogs = useMemo(() => groupRepLogs(entry.repLogs), [entry.repLogs]);
  const hasLogs = groupedLogs.length > 0;
  const time = new Date(entry.completedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const exerciseCount = entry.workout.exercises.length;

  return (
    <View style={styles.entryCard}>
      <TouchableOpacity
        style={styles.entryHeader}
        onPress={() => setExpanded(e => !e)}
        disabled={!hasLogs}
        accessibilityLabel={hasLogs ? `Toggle log for ${entry.workout.name}` : undefined}
      >
        <View style={styles.entryInfo}>
          <Text style={styles.entryName} numberOfLines={1}>{entry.workout.name || 'Workout'}</Text>
          <Text style={styles.entryMeta}>
            {time} · {formatTime(entry.totalElapsedSeconds)} · {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''}
          </Text>
        </View>
        {hasLogs && <ChevronIcon color="#94A3B8" size={14} direction={expanded ? 'up' : 'down'} />}
      </TouchableOpacity>

      {expanded && hasLogs && (
        <View style={styles.entryLogs}>
          {groupedLogs.map(group => (
            <ExerciseLogCard key={group.exerciseName} exerciseName={group.exerciseName} sets={group.sets} />
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.repeatButton} onPress={() => onRepeat(entry.workout)} accessibilityLabel={`Repeat ${entry.workout.name}`}>
        <PlayIcon color="#CCFF00" size={12} />
        <Text style={styles.repeatButtonText}>Repeat Workout</Text>
      </TouchableOpacity>
    </View>
  );
}

export function HistoryScreen({ navigation }: Props) {
  const [history, setHistory] = useState<WorkoutHistoryEntry[]>([]);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused) {
      loadHistory().then(setHistory);
    }
  }, [isFocused]);

  const totalWorkouts = history.length;
  const totalActiveSeconds = useMemo(() => history.reduce((sum, entry) => sum + entry.totalElapsedSeconds, 0), [history]);
  const streak = useMemo(() => computeStreak(history), [history]);
  const sections = useMemo(() => groupByDate(history), [history]);

  const handleRepeat = (workout: Workout) => {
    navigation.navigate('WorkoutPreview', { workout });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0B0B" />
      <View style={styles.statusBarSpacer} />
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backAction} onPress={() => navigation.goBack()} accessibilityLabel="Go back">
          <ChevronIcon color="#94A3B8" size={18} direction="left" />
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.screenTitle}>History</Text>
        <View style={styles.headerSpacer} />
      </View>

      {history.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.illustration}>
            <DumbbellIcon color="#94A3B8" size={36} />
          </View>
          <Text style={styles.emptyTitle}>No workouts completed yet</Text>
          <Text style={styles.emptyDescription}>Finish a workout and it'll show up here, with your streak and progress over time.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.statsRow}>
            <View style={styles.statColumn}><Text style={styles.statValue}>{totalWorkouts}</Text><Text style={styles.statLabel}>Workouts</Text></View>
            <View style={styles.statDivider} />
            <View style={styles.statColumn}><Text style={styles.statValue}>{streak}</Text><Text style={styles.statLabel}>Day Streak</Text></View>
            <View style={styles.statDivider} />
            <View style={styles.statColumn}><Text style={styles.statValue}>{formatTime(totalActiveSeconds)}</Text><Text style={styles.statLabel}>Total Time</Text></View>
          </View>

          {sections.map(section => (
            <View key={section.header} style={styles.section}>
              <Text style={styles.sectionHeader}>{section.header}</Text>
              {section.entries.map(entry => (
                <HistoryEntryCard key={entry.id} entry={entry} onRepeat={handleRepeat} />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090A' },
  statusBarSpacer: { height: 44 },
  headerRow: {
    height: 48,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backAction: { width: 64, height: 20, flexDirection: 'row', alignItems: 'center', gap: 6 },
  backLabel: { color: '#94A3B8', fontSize: 15, lineHeight: 20 },
  screenTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', lineHeight: 23 },
  headerSpacer: { width: 64 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 32, gap: 20 },
  statsRow: {
    height: 74,
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 12,
    backgroundColor: '#121214',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  statColumn: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { color: '#FFFFFF', fontFamily: 'monospace', fontSize: 18, fontWeight: '700', lineHeight: 24 },
  statLabel: { color: '#94A3B8', fontSize: 11, fontWeight: '600', lineHeight: 14, textTransform: 'uppercase' },
  statDivider: { width: 1, height: 24, backgroundColor: '#1F1F24', marginTop: 2 },
  section: { gap: 10 },
  sectionHeader: { color: '#94A3B8', fontSize: 11, fontWeight: '700', lineHeight: 14, textTransform: 'uppercase' },
  entryCard: {
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 12,
    backgroundColor: '#121214',
    overflow: 'hidden',
  },
  entryHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  entryInfo: { flex: 1, gap: 4, minWidth: 0 },
  entryName: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  entryMeta: { color: '#94A3B8', fontSize: 12 },
  entryLogs: { paddingHorizontal: 12, paddingBottom: 12, gap: 8, borderTopWidth: 1, borderTopColor: '#1F1F24', paddingTop: 12 },
  repeatButton: {
    height: 40,
    borderTopWidth: 1,
    borderTopColor: '#1F1F24',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  repeatButtonText: { color: '#CCFF00', fontSize: 13, fontWeight: '700' },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 20,
  },
  illustration: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1,
    borderColor: '#1F1F24',
    backgroundColor: '#121214',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  emptyDescription: { color: '#94A3B8', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
