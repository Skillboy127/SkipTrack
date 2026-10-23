import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Share } from 'react-native';
import { RepSetLog, WeightUnit } from '../types';
import { ChevronIcon } from './WorkoutIcons';
import { Display, Label } from './PosterText';
import { band, colors, display, label, leading, rule, space, tracking } from '../theme';

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

export function ExerciseLogCard({ exerciseName, sets, weightUnit = 'lb' }: { exerciseName: string; sets: RepSetLog[]; weightUnit?: WeightUnit }) {
  const [expanded, setExpanded] = useState(false);

  const handleShare = () => {
    const lines = sets.map((s, i) => `Set ${i + 1}: ${s.reps} reps${s.weight != null ? ` @ ${s.weight} ${weightUnit}` : ''}`);
    Share.share({ message: `${exerciseName}\n${lines.join('\n')}` }).catch(() => {});
  };

  return (
    <View style={styles.logCard}>
      <Pressable
        style={styles.logCardHeader}
        onPress={() => setExpanded(e => !e)}
        accessibilityRole="button"
        accessibilityLabel={`Toggle log for ${exerciseName}`}
      >
        <Display style={styles.logExerciseName} numberOfLines={1}>{exerciseName}</Display>
        <View style={styles.logDisclosureGroup}>
          <Label style={styles.logDisclosure}>{expanded ? 'Hide' : 'Sets'}</Label>
          <ChevronIcon color={colors.ink} size={12} direction={expanded ? 'up' : 'down'} />
        </View>
      </Pressable>
      {expanded && (
        <View style={styles.logDetail}>
          {sets.map((s, i) => (
            <View key={i} style={styles.logRow}>
              <Label style={styles.logRowLabel}>Set {i + 1}</Label>
              <Label style={styles.logRowValue}>
                {s.reps} reps{s.weight != null ? ` @ ${s.weight} ${weightUnit}` : ''}
              </Label>
            </View>
          ))}
          <Pressable
            style={({ pressed }) => [styles.shareButton, pressed && styles.shareButtonPressed]}
            onPress={handleShare}
            accessibilityRole="button"
          >
            <Label style={styles.shareButtonText}>Share as text</Label>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  logCard: {
    borderWidth: rule.heavy,
    borderColor: colors.ink,
  },
  logCardHeader: {
    minHeight: band.control,
    paddingHorizontal: space.row,
    paddingVertical: space.tight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.row,
  },
  logExerciseName: {
    flex: 1,
    fontSize: display.wordmark,
    lineHeight: display.wordmark * leading.snug,
  },
  logDisclosureGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.hair + 2,
  },
  logDisclosure: {
    fontSize: label.micro,
  },
  logDetail: {
    paddingHorizontal: space.row,
    paddingBottom: space.row,
    gap: space.tight,
    borderTopWidth: rule.thin,
    borderTopColor: colors.ink,
  },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: space.tight,
  },
  logRowLabel: {
    fontSize: label.micro,
    color: colors.inkMuted,
  },
  logRowValue: {
    fontSize: label.small,
    fontVariant: ['tabular-nums'],
  },
  shareButton: {
    marginTop: space.hair,
    minHeight: band.control,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonPressed: {
    backgroundColor: colors.rowPress,
  },
  shareButtonText: {
    fontSize: label.micro,
    letterSpacing: tracking.wide,
  },
});
