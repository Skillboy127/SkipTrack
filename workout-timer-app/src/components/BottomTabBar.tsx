import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Label } from './PosterText';
import { colors, band, label, tracking } from '../theme';

export type TabKey = 'workouts' | 'history' | 'settings';

const TABS: { key: TabKey; route: keyof RootStackParamList; title: string }[] = [
  { key: 'workouts', route: 'Library', title: 'Workouts' },
  { key: 'history', route: 'History', title: 'History' },
  { key: 'settings', route: 'Settings', title: 'Settings' },
];

/**
 * Presentational tab bar over the existing stack navigator — it changes no
 * navigation structure. `navigate` is used rather than `push` so returning to a
 * screen already in the stack pops back to it instead of stacking duplicates.
 */
export function BottomTabBar({ active }: { active: TabKey }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <View style={styles.bar}>
      {TABS.map(tab => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            style={({ pressed }) => [
              styles.tab,
              selected && styles.tabActive,
              pressed && !selected && styles.tabPressed,
            ]}
            onPress={() => {
              if (selected) return;
              navigation.navigate(tab.route as never);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.title}
          >
            <Label style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.title}</Label>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    height: band.tabBar,
    backgroundColor: colors.ink,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: colors.accent,
  },
  tabPressed: {
    backgroundColor: colors.inkPress,
  },
  tabLabel: {
    color: colors.onInk,
    fontSize: label.base,
    letterSpacing: tracking.wide,
  },
  tabLabelActive: {
    color: colors.ink,
  },
});
