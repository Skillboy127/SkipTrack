import React, { useEffect, useRef } from 'react';
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

const DRAG_DISMISS_THRESHOLD = 110;
const DRAG_VELOCITY_THRESHOLD = 1.2;

/** A draggable bottom-sheet-style drawer listing every exercise still to come, scrollable for long workouts. */
export function UpNextDrawer({ visible, onRequestClose, entries, totalExerciseCount }: UpNextDrawerProps) {
  // Tracks the sheet's vertical offset while dragging so it follows the
  // finger in real time, rather than only playing a fixed open/close
  // animation. Only the handle/header area is draggable — the list below
  // keeps its own independent scroll gesture.
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  const dragResponder = useRef(
    PanResponder.create({
      // Only claim the gesture once there's real vertical movement — never on
      // a bare touch-start, otherwise the nested Close button's own tap would
      // never get a chance to fire.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderMove: (_, gesture) => {
        // Only follow downward drags — the sheet is already fully open, so
        // there's nowhere for it to go upward.
        translateY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > DRAG_DISMISS_THRESHOLD || gesture.vy > DRAG_VELOCITY_THRESHOLD) {
          onRequestClose();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onRequestClose}>
      {/* The dimmed backdrop and the sheet are siblings, not parent/child —
          nesting the ScrollView inside a Pressable (the previous approach,
          used to stop taps on the sheet from bubbling up and closing it)
          made the two compete for the touch responder, which is exactly why
          scrolling worked "sometimes" and not others. As siblings, whichever
          one is actually under the finger just handles the touch directly:
          the sheet (rendered on top) for touches on it, the backdrop
          underneath for everything else. No responder-swallowing needed. */}
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onRequestClose} accessibilityLabel="Close drawer" />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View {...dragResponder.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Up Next</Text>
              <Pressable onPress={onRequestClose} hitSlop={8} accessibilityLabel="Close">
                <CloseIcon color="#94A3B8" size={16} />
              </Pressable>
            </View>
          </View>
          {entries.length === 0 ? (
            <Text style={styles.emptyText}>That's the last exercise — almost done!</Text>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
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
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '70%',
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
  // flex: 1 (rather than a fixed maxHeight) means the list always fills
  // exactly the space left over after the header and footer hint, so it can
  // always scroll all the way to the last row regardless of screen size.
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 8,
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
