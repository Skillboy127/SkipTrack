import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Phase } from '../types';
import { CloseIcon } from './WorkoutIcons';

type UpcomingEntry = {
  phase: Phase;
  exerciseNumber: number;
};

type UpNextDrawerProps = {
  visible: boolean;
  onRequestClose: () => void;
  entries: UpcomingEntry[];
  totalExerciseCount: number;
};

/** A bottom-sheet-style drawer listing every exercise still to come, scrollable for long workouts. */
export function UpNextDrawer({ visible, onRequestClose, entries, totalExerciseCount }: UpNextDrawerProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onRequestClose}>
      <Pressable style={styles.backdrop} onPress={onRequestClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Up Next</Text>
            <Pressable onPress={onRequestClose} hitSlop={8} accessibilityLabel="Close">
              <CloseIcon color="#94A3B8" size={16} />
            </Pressable>
          </View>
          {entries.length === 0 ? (
            <Text style={styles.emptyText}>That's the last exercise — almost done!</Text>
          ) : (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {entries.map((entry, index) => (
                <View key={index} style={[styles.row, index === 0 && styles.rowNext]}>
                  <View style={[styles.numberBadge, index === 0 && styles.numberBadgeNext]}>
                    <Text style={[styles.numberText, index === 0 && styles.numberTextNext]}>
                      {entry.exerciseNumber}
                    </Text>
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName} numberOfLines={1}>{entry.phase.exerciseName}</Text>
                    {index === 0 && <Text style={styles.rowNextLabel}>UP NEXT</Text>}
                  </View>
                  <Text style={styles.rowDetail}>
                    {entry.phase.mode === 'reps'
                      ? `${entry.phase.reps} reps`
                      : `${Math.ceil(entry.phase.duration)}s`}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}
          <Text style={styles.footerHint}>
            {totalExerciseCount} exercise{totalExerciseCount === 1 ? '' : 's'} total in this workout
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#1F1F24',
    backgroundColor: '#121214',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2A2A30',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 20,
    textAlign: 'center',
  },
  list: {
    maxHeight: 380,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1F1F24',
  },
  rowNext: {
    borderTopWidth: 0,
  },
  numberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1A1A1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberBadgeNext: {
    backgroundColor: '#CCFF00',
  },
  numberText: {
    color: '#94A3B8',
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
  },
  numberTextNext: {
    color: '#09090A',
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  rowNextLabel: {
    color: '#CCFF00',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  rowDetail: {
    color: '#94A3B8',
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '600',
  },
  footerHint: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 14,
  },
});
