import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Alert, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIAP } from 'react-native-iap';
import { RootStackParamList, CountdownSoundMode, WeightUnit } from '../types';
import { loadCountdownSoundMode, saveCountdownSoundMode, loadWeightUnit, saveWeightUnit, loadAdFreeStatus, saveAdFreeStatus } from '../storage';
import { ChevronIcon, CheckIcon } from '../components/WorkoutIcons';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

// TODO: replace with the real product ID once created in Play Console /
// App Store Connect — must match exactly on both, and on both platforms
// this needs to be configured as a one-time non-consumable product priced
// at $2.99 before a real purchase can succeed.
const REMOVE_ADS_SKU = 'remove_ads';
const REMOVE_ADS_FALLBACK_PRICE = '$2.99';

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

const WEIGHT_UNITS: { id: WeightUnit; title: string; description: string }[] = [
  {
    id: 'lb',
    title: 'Pounds (lb)',
    description: 'Logged weights are shown and entered in pounds.',
  },
  {
    id: 'kg',
    title: 'Kilograms (kg)',
    description: 'Logged weights are shown and entered in kilograms.',
  },
];

export function SettingsScreen({ navigation }: Props) {
  const [soundMode, setSoundMode] = useState<CountdownSoundMode>('speech');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('lb');
  const [loaded, setLoaded] = useState(false);
  const [adFree, setAdFree] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  useEffect(() => {
    Promise.all([loadCountdownSoundMode(), loadWeightUnit(), loadAdFreeStatus()]).then(([sound, unit, ads]) => {
      setSoundMode(sound);
      setWeightUnit(unit);
      setAdFree(ads);
      setLoaded(true);
    });
  }, []);

  const {
    connected,
    products,
    fetchProducts,
    requestPurchase,
    finishTransaction,
    restorePurchases,
    availablePurchases,
  } = useIAP({
    onPurchaseSuccess: async purchase => {
      if (purchase.productId !== REMOVE_ADS_SKU) return;
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch (e) {
        console.warn('Failed to finish Remove Ads transaction:', e);
      }
      await saveAdFreeStatus(true);
      setAdFree(true);
      setPurchasing(false);
    },
    onPurchaseError: error => {
      setPurchasing(false);
      if (error.code !== 'user-cancelled') {
        Alert.alert('Purchase failed', error.message || 'Something went wrong. Please try again.');
      }
    },
  });

  // Fetch the real store-listed price as soon as the store connection is
  // ready, so the button can show the actual localized price instead of
  // just the $2.99 fallback label.
  useEffect(() => {
    if (connected) fetchProducts({ skus: [REMOVE_ADS_SKU], type: 'in-app' }).catch(() => {});
  }, [connected, fetchProducts]);

  // Restoring purchases (or a purchase made on another device syncing in)
  // surfaces here — pick it up without requiring a manual "I already own
  // this" confirmation.
  useEffect(() => {
    const alreadyOwned = availablePurchases.some(p => p.productId === REMOVE_ADS_SKU);
    if (alreadyOwned && !adFree) {
      saveAdFreeStatus(true);
      setAdFree(true);
    }
  }, [availablePurchases]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeAdsPrice = products.find(p => p.id === REMOVE_ADS_SKU)?.displayPrice ?? REMOVE_ADS_FALLBACK_PRICE;

  const handlePurchaseRemoveAds = async () => {
    if (!connected) {
      Alert.alert('Store unavailable', 'Could not connect to the store right now. Please try again later.');
      return;
    }
    setPurchasing(true);
    try {
      await requestPurchase({
        request: { apple: { sku: REMOVE_ADS_SKU }, google: { skus: [REMOVE_ADS_SKU] } },
        type: 'in-app',
      });
    } catch (e: any) {
      setPurchasing(false);
      Alert.alert('Purchase failed', e?.message || 'Something went wrong. Please try again.');
    }
  };

  const handleRestorePurchases = async () => {
    try {
      await restorePurchases();
    } catch (e) {
      console.warn('Restore purchases failed:', e);
      Alert.alert('Restore failed', 'Could not restore purchases right now. Please try again later.');
    }
  };

  const handleSelect = (mode: CountdownSoundMode) => {
    setSoundMode(mode);
    saveCountdownSoundMode(mode);
  };

  const handleSelectWeightUnit = (unit: WeightUnit) => {
    setWeightUnit(unit);
    saveWeightUnit(unit);
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

          <Text style={styles.sectionHeader}>WEIGHT UNIT</Text>
          <View style={styles.card}>
            {WEIGHT_UNITS.map((option, index) => {
              const selected = weightUnit === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.optionRow, index > 0 && styles.optionRowBorder]}
                  onPress={() => handleSelectWeightUnit(option.id)}
                  accessibilityLabel={`Use ${option.title}`}
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

          <Text style={styles.sectionHeader}>SUPPORT FLEX</Text>
          {adFree ? (
            <View style={styles.card}>
              <View style={styles.adFreeConfirmedRow}>
                <CheckIcon color="#CCFF00" size={16} />
                <Text style={styles.adFreeConfirmedText}>Ads removed — thank you for supporting Flex!</Text>
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.removeAdsRow}
                onPress={handlePurchaseRemoveAds}
                disabled={purchasing}
                accessibilityLabel="Remove ads"
              >
                <View style={styles.optionInfo}>
                  <Text style={styles.optionTitle}>Remove Ads</Text>
                  <Text style={styles.optionDescription}>One-time purchase. Removes all banner ads, forever.</Text>
                </View>
                {purchasing ? (
                  <ActivityIndicator color="#CCFF00" />
                ) : (
                  <Text style={styles.removeAdsPrice}>{removeAdsPrice}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionRow, styles.optionRowBorder]}
                onPress={handleRestorePurchases}
                accessibilityLabel="Restore purchases"
              >
                <Text style={styles.restoreLink}>Restore Purchases</Text>
              </TouchableOpacity>
            </View>
          )}
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
  removeAdsRow: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  removeAdsPrice: {
    color: '#CCFF00',
    fontSize: 16,
    fontWeight: '800',
  },
  restoreLink: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  adFreeConfirmedRow: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  adFreeConfirmedText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
});
