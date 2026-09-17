import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Share } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, RepSetLog } from '../types';
import { expandWorkout } from '../workoutLogic';
import { CheckIcon, ChevronIcon } from '../components/WorkoutIcons';

type Props = NativeStackScreenProps<RootStackParamList, 'Completion'>;

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

function groupRepLogs(repLogs: RepSetLog[]): { exerciseName: string; sets: RepSetLog[] }[] {
  const order: string[] = [];
  const byExercise = new Map<string, RepSetLog[]>();

  repLogs.forEach(log => {
    if (!byExercise.has(log.exerciseName)) {
      byExercise.set(log.exerciseName, []);
      order.push(log.exerciseName);
    }
    byExercise.get(log.exerciseName)!.push(log);
  });

  return order.map(exerciseName => ({ exerciseName, sets: byExercise.get(exerciseName)! }));
}

function ExerciseLogCard({ exerciseName, sets }: { exerciseName: string; sets: RepSetLog[] }) {
  const [expanded, setExpanded] = useState(false);

  const handleShare = () => {
    const lines = sets.map((s, i) => `Set ${i + 1}: ${s.reps} reps${s.weight != null ? ` @ ${s.weight} lb` : ''}`);
    Share.share({ message: `${exerciseName}\n${lines.join('\n')}` }).catch(() => {});
  };

  return (
    <View style={styles.logCard}>
      <TouchableOpacity style={styles.logCardHeader} onPress={() => setExpanded(e => !e)} accessibilityLabel={`Toggle log for ${exerciseName}`}>
        <Text style={styles.logExerciseName} numberOfLines={1}>{exerciseName}</Text>
        <View style={styles.logDisclosureGroup}>
          <Text style={styles.logDisclosure}>{expanded ? 'Hide Log' : 'View Log'}</Text>
          <ChevronIcon color="#CCFF00" size={12} direction={expanded ? 'up' : 'down'} />
        </View>
      </TouchableOpacity>
      {expanded && (
        <View style={styles.logDetail}>
          {sets.map((s, i) => (
            <View key={i} style={styles.logRow}>
              <Text style={styles.logRowLabel}>Set {i + 1}</Text>
              <Text style={styles.logRowValue}>{s.reps} reps{s.weight != null ? ` @ ${s.weight} lb` : ''}</Text>
            </View>
          ))}
          <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
            <Text style={styles.shareButtonText}>Share as text</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export function CompletionScreen({ route, navigation }: Props) {
  const { totalElapsed, workout, repLogs = [] } = route.params;
  const phases = useMemo(() => expandWorkout(workout), [workout]);
  const activeSeconds = phases.filter(phase => phase.type === 'work').reduce((total, phase) => total + phase.duration, 0);
  const restSeconds = phases.filter(phase => phase.type === 'rest').reduce((total, phase) => total + phase.duration, 0);
  const groupedLogs = useMemo(() => groupRepLogs(repLogs), [repLogs]);

  const summary = (
    <>
      <View style={styles.checkmarkBadge}><CheckIcon color="#CCFF00" size={30} /></View>
      <View style={styles.titlesGroup}>
        <Text style={styles.title}>Workout Complete</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{workout.name || 'Workout'}</Text>
      </View>
      <View style={styles.timeGroup}>
        <Text style={styles.elapsedTime}>{formatTime(totalElapsed)}</Text>
        <Text style={styles.timeLabel}>Total Elapsed Time</Text>
      </View>
      <View style={styles.statsRow}>
        <View style={styles.statColumn}><Text style={styles.statValue}>{workout.exercises.length}</Text><Text style={styles.statLabel}>Exercises</Text></View>
        <View style={styles.statDivider} />
        <View style={styles.statColumn}><Text style={styles.statValue}>{formatTime(activeSeconds)}</Text><Text style={styles.statLabel}>Active Time</Text></View>
        <View style={styles.statDivider} />
        <View style={styles.statColumn}><Text style={styles.statValue}>{formatTime(restSeconds)}</Text><Text style={styles.statLabel}>Rest Time</Text></View>
      </View>
    </>
  );

  return (
    <View style={styles.container}>
      <View style={styles.statusBarSpacer} />
      {groupedLogs.length > 0 ? (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.centerContentScroll}>{summary}</View>
          <View style={styles.logsSection}>
            <Text style={styles.logsSectionTitle}>SETS LOGGED</Text>
            {groupedLogs.map(group => (
              <ExerciseLogCard key={group.exerciseName} exerciseName={group.exerciseName} sets={group.sets} />
            ))}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.centerContent}>{summary}</View>
      )}
      <View style={styles.footerWrapper}>
        <TouchableOpacity style={styles.doneButton} onPress={() => navigation.popToTop()}>
          <CheckIcon color="#09090A" size={22} /><Text style={styles.doneLabel}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090A' },
  statusBarSpacer: { height: 44 },
  centerContent: { flex: 1, paddingHorizontal: 24, paddingVertical: 20, alignItems: 'center', justifyContent: 'center', gap: 36 },
  scrollContent: { flexGrow: 1, paddingBottom: 24 },
  centerContentScroll: { width: '100%', paddingHorizontal: 24, paddingVertical: 20, alignItems: 'center', gap: 36 },
  checkmarkBadge: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: '#CCFF00', backgroundColor: 'rgba(204, 255, 0, 0.1)', alignItems: 'center', justifyContent: 'center' },
  titlesGroup: { width: '100%', alignItems: 'center', gap: 8 },
  title: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', lineHeight: 36, textAlign: 'center' },
  subtitle: { width: '100%', color: '#94A3B8', fontSize: 16, fontWeight: '500', lineHeight: 21, textAlign: 'center' },
  timeGroup: { alignItems: 'center', gap: 4 },
  elapsedTime: { color: '#CCFF00', fontFamily: 'monospace', fontSize: 72, fontWeight: '800', lineHeight: 72, fontVariant: ['tabular-nums'] },
  timeLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '700', lineHeight: 16, textTransform: 'uppercase' },
  statsRow: { width: '100%', height: 74, paddingVertical: 16, paddingHorizontal: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#1F1F24', flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  statColumn: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { color: '#FFFFFF', fontFamily: 'monospace', fontSize: 18, fontWeight: '700', lineHeight: 24 },
  statLabel: { color: '#94A3B8', fontSize: 11, fontWeight: '600', lineHeight: 14, textTransform: 'uppercase' },
  statDivider: { width: 1, height: 24, backgroundColor: '#1F1F24' },
  footerWrapper: { height: 112, paddingTop: 16, paddingHorizontal: 20, paddingBottom: 8, borderTopWidth: 1, borderTopColor: '#1F1F24', backgroundColor: '#09090A' },
  doneButton: { height: 54, borderRadius: 12, backgroundColor: '#CCFF00', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  doneLabel: { color: '#09090A', fontSize: 18, fontWeight: '700', lineHeight: 23, textTransform: 'uppercase' },
  logsSection: { paddingHorizontal: 24, gap: 12 },
  logsSectionTitle: { color: '#94A3B8', fontSize: 11, fontWeight: '700', lineHeight: 14, textTransform: 'uppercase' },
  logCard: { borderWidth: 1, borderColor: '#1F1F24', borderRadius: 12, backgroundColor: '#121214', overflow: 'hidden' },
  logCardHeader: { paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  logExerciseName: { flex: 1, color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  logDisclosureGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logDisclosure: { color: '#CCFF00', fontSize: 12, fontWeight: '700' },
  logDetail: { paddingHorizontal: 16, paddingBottom: 14, gap: 8, borderTopWidth: 1, borderTopColor: '#1F1F24' },
  logRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 },
  logRowLabel: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  logRowValue: { color: '#FFFFFF', fontFamily: 'monospace', fontSize: 13, fontWeight: '700' },
  shareButton: { marginTop: 4, height: 40, borderRadius: 10, borderWidth: 1, borderColor: '#1F1F24', alignItems: 'center', justifyContent: 'center' },
  shareButtonText: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
});
