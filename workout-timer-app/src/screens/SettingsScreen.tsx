import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Switch } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { loadTtsEnabled, saveTtsEnabled } from '../storage';
import { ChevronIcon } from '../components/WorkoutIcons';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadTtsEnabled().then(value => {
      setTtsEnabled(value);
      setLoaded(true);
    });
  }, []);

  const handleToggleTts = (value: boolean) => {
    setTtsEnabled(value);
    saveTtsEnabled(value);
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
        <Text style={styles.screenTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loaded && (
        <View style={styles.content}>
          <Text style={styles.sectionHeader}>SESSION AUDIO</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle}>Spoken Countdown</Text>
                <Text style={styles.rowDescription}>
                  Announce "3, 2, 1" out loud during work and rest phases, and say the next exercise's
                  name before rest ends. Turn off for a silent countdown instead.
                </Text>
              </View>
              <Switch
                value={ttsEnabled}
                onValueChange={handleToggleTts}
                trackColor={{ false: '#1F1F24', true: 'rgba(204, 255, 0, 0.5)' }}
                thumbColor={ttsEnabled ? '#CCFF00' : '#94A3B8'}
              />
            </View>
          </View>
        </View>
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
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 10 },
  sectionHeader: { color: '#94A3B8', fontSize: 11, fontWeight: '700', lineHeight: 14, textTransform: 'uppercase' },
  card: {
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 12,
    backgroundColor: '#121214',
  },
  row: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  rowInfo: { flex: 1, gap: 4 },
  rowTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  rowDescription: { color: '#94A3B8', fontSize: 12, lineHeight: 17 },
});
