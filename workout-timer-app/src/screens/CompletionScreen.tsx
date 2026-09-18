import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { addHistoryEntry } from '../storage';
import { CheckIcon } from '../components/WorkoutIcons';
import { ExerciseLogCard, groupRepLogs } from '../components/ExerciseLogCard';

type Props = NativeStackScreenProps<RootStackParamList, 'Completion'>;

const generateId = () => Math.random().toString(36).substring(2, 9);

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export function CompletionScreen({ route, navigation }: Props) {
  const { totalElapsed, workout, repLogs = [] } = route.params;
  const groupedLogs = useMemo(() => groupRepLogs(repLogs), [repLogs]);

  // Record this session to history exactly once, regardless of re-renders.
  const savedToHistoryRef = useRef(false);
  useEffect(() => {
    if (savedToHistoryRef.current) return;
    savedToHistoryRef.current = true;
    addHistoryEntry({
      id: generateId(),
      workout,
      completedAt: Date.now(),
      totalElapsedSeconds: totalElapsed,
      repLogs,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  footerWrapper: { height: 112, paddingTop: 16, paddingHorizontal: 20, paddingBottom: 8, borderTopWidth: 1, borderTopColor: '#1F1F24', backgroundColor: '#09090A' },
  doneButton: { height: 54, borderRadius: 12, backgroundColor: '#CCFF00', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  doneLabel: { color: '#09090A', fontSize: 18, fontWeight: '700', lineHeight: 23, textTransform: 'uppercase' },
  logsSection: { paddingHorizontal: 24, gap: 12 },
  logsSectionTitle: { color: '#94A3B8', fontSize: 11, fontWeight: '700', lineHeight: 14, textTransform: 'uppercase' },
});
