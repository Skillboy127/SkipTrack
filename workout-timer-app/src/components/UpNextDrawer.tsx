import React, { useEffect, useRef } from 'react';
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Phase } from '../types';
import { CloseIcon } from './WorkoutIcons';
import { Display, Label, Body } from './PosterText';
import { band, colors, display, label, leading, rule, space, tracking } from '../theme';

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
              <Display style={styles.title}>Up Next</Display>
              <Pressable onPress={onRequestClose} hitSlop={8} accessibilityLabel="Close">
                <CloseIcon color={colors.ink} size={16} />
              </Pressable>
            </View>
          </View>
          {entries.length === 0 ? (
            <Body style={styles.emptyText}>That&apos;s the last exercise — almost done!</Body>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {entries.map((entry, index) => (
                <View key={index} style={[styles.row, index === 0 && styles.rowNext]}>
                  <View style={[styles.numberBadge, index === 0 && styles.numberBadgeNext]}>
                    <Label style={[styles.numberText, index === 0 && styles.numberTextNext]}>
                      {entry.exerciseNumber}
                    </Label>
                  </View>
                  <View style={styles.rowInfo}>
                    <Display style={styles.rowName} numberOfLines={1}>{entry.phase.exerciseName}</Display>
                    {index === 0 && <Label style={styles.rowNextLabel}>Up next</Label>}
                  </View>
                  <Label style={styles.rowDetail}>
                    {entry.phase.mode === 'reps'
                      ? `${entry.phase.reps} reps`
                      : `${Math.ceil(entry.phase.duration)}s`}
                  </Label>
                </View>
              ))}
            </ScrollView>
          )}
          <Label style={styles.footerHint}>
            {totalExerciseCount} exercise{totalExerciseCount === 1 ? '' : 's'} total in this workout
          </Label>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(14, 14, 14, 0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '70%',
    borderTopWidth: rule.heavy,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
    paddingHorizontal: space.gutter,
    paddingTop: space.tight,
    paddingBottom: space.block * 2,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: rule.heavy * 2,
    backgroundColor: colors.ink,
    marginBottom: space.row,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.row,
  },
  title: {
    fontSize: display.rowTitle,
    lineHeight: display.rowTitle * leading.snug,
  },
  emptyText: {
    color: colors.inkMuted,
    fontSize: label.base,
    lineHeight: label.base * 1.5,
    paddingVertical: space.block,
    textAlign: 'center',
  },
  // flex: 1 (rather than a fixed maxHeight) means the list always fills
  // exactly the space left over after the header and footer hint, so it can
  // always scroll all the way to the last row regardless of screen size.
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: space.tight,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.row,
    paddingVertical: space.row,
    borderTopWidth: rule.heavy,
    borderTopColor: colors.ink,
    minHeight: band.control,
  },
  rowNext: {
    borderTopWidth: 0,
  },
  numberBadge: {
    width: 30,
    height: 30,
    borderWidth: rule.thin,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberBadgeNext: {
    backgroundColor: colors.accent,
    borderWidth: rule.heavy,
  },
  numberText: {
    fontSize: label.small,
    fontVariant: ['tabular-nums'],
  },
  numberTextNext: {
    color: colors.ink,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: display.wordmark,
    lineHeight: display.wordmark * leading.snug,
  },
  rowNextLabel: {
    color: colors.accentDeep,
    fontSize: label.micro,
    letterSpacing: tracking.wide,
  },
  rowDetail: {
    fontSize: label.small,
    fontVariant: ['tabular-nums'],
  },
  footerHint: {
    color: colors.inkMuted,
    fontSize: label.micro,
    textAlign: 'center',
    marginTop: space.row,
  },
});
