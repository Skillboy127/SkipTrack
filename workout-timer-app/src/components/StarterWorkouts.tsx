import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { BUILT_IN_WORKOUTS, BuiltInWorkout, builtInSummary } from '../programs/builtInWorkouts';
import { PlayIcon } from './WorkoutIcons';
import { Display, Label } from './PosterText';
import { band, colors, display, label, leading, rule, space, tracking } from '../theme';

type Props = {
  onOpen: (workout: BuiltInWorkout) => void;
  /** Hide the section heading when the screen already introduces the list. */
  showHeading?: boolean;
  /** Off when the surrounding list already draws the closing rule. */
  bottomRule?: boolean;
};

/** The built-in starter workouts as Library-style rows. Opening one never touches the server. */
export function StarterWorkouts({ onOpen, showHeading = true, bottomRule = true }: Props) {
  return (
    <View>
      {showHeading && (
        <View style={styles.heading}>
          <Label style={styles.headingLabel}>Starter workouts</Label>
          <Label style={styles.headingNote}>Free · No import used</Label>
        </View>
      )}
      <View style={bottomRule && styles.list}>
        {BUILT_IN_WORKOUTS.map(b => (
          <Pressable
            key={b.id}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => onOpen(b)}
            accessibilityRole="button"
            accessibilityLabel={`${b.name}. ${b.level}, ${b.equipment.toLowerCase()}, about ${b.minutes} minutes.`}
          >
            <View style={styles.rowBody}>
              <Display style={styles.rowTitle} numberOfLines={1}>{b.name}</Display>
              <Label style={styles.rowMeta} numberOfLines={1}>{builtInSummary(b)}</Label>
            </View>
            <View style={styles.playSquare}>
              <PlayIcon color={colors.ink} size={20} />
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    paddingHorizontal: space.gutter,
    paddingTop: space.block,
    paddingBottom: space.tight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headingLabel: {
    fontSize: label.micro,
  },
  headingNote: {
    fontSize: label.micro,
    color: colors.inkMuted,
  },
  list: {
    borderBottomWidth: rule.heavy,
    borderBottomColor: colors.ink,
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
  rowBody: {
    flex: 1,
    paddingVertical: space.tight,
    paddingHorizontal: space.gutter,
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
    letterSpacing: tracking.label,
  },
  playSquare: {
    width: band.play,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: rule.heavy,
    borderLeftColor: colors.ink,
  },
});
