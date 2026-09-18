import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share } from 'react-native';
import { RepSetLog } from '../types';
import { ChevronIcon } from './WorkoutIcons';

export function groupRepLogs(repLogs: RepSetLog[]): { exerciseName: string; sets: RepSetLog[] }[] {
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

export function ExerciseLogCard({ exerciseName, sets }: { exerciseName: string; sets: RepSetLog[] }) {
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

const styles = StyleSheet.create({
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
