import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, CountdownSoundMode } from '../types';
import { loadCountdownSoundMode, saveCountdownSoundMode } from '../storage';
import { ChevronIcon, CheckIcon } from '../components/WorkoutIcons';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const SOUND_MODES: { id: CountdownSoundMode; title: string; description: string }[] = [
  {
    id: 'speech',
    title: 'Spoken',
    description: '"Three, two, one" is announced out loud, and the next exercise (and how long/many) is called out during rest.',
  },
  {
    id: 'beep',
    title: 'Beep',
    description: 'A short beep plays for the countdown and phase transitions instead of speech.',
  },
  {
    id: 'silent',
    title: 'Silent',
    description: 'No countdown sound at all — just the visual timer.',
  },
];

export function SettingsScreen({ navigation }: Props) {
  const [soundMode, setSoundMode] = useState<CountdownSoundMode>('speech');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadCountdownSoundMode().then(value => {
      setSoundMode(value);
      setLoaded(true);
    });
  }, []);

  const handleSelect = (mode: CountdownSoundMode) => {
    setSoundMode(mode);
    saveCountdownSoundMode(mode);
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
          <Text style={styles.sectionHeader}>SESSION COUNTDOWN</Text>
          <View style={styles.card}>
            {SOUND_MODES.map((option, index) => {
              const selected = soundMode === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.optionRow, index > 0 && styles.optionRowBorder]}
                  onPress={() => handleSelect(option.id)}
                  accessibilityLabel={`Use ${option.title.toLowerCase()} countdown`}
                >
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected && <CheckIcon color="#09090A" size={12} />}
                  </View>
                  <View style={styles.optionInfo}>
                    <Text style={styles.optionTitle}>{option.title}</Text>
                    <Text style={styles.optionDescription}>{option.description}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.hint}>
            You can also tap the speaker icon during a workout to quickly switch between these.
          </Text>
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
    overflow: 'hidden',
  },
  optionRow: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  optionRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#1F1F24',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#1F1F24',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioSelected: {
    borderColor: '#CCFF00',
    backgroundColor: '#CCFF00',
  },
  optionInfo: { flex: 1, gap: 4 },
  optionTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  optionDescription: { color: '#94A3B8', fontSize: 12, lineHeight: 17 },
  hint: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 4,
  },
});
