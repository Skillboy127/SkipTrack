import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, StatusBar, Alert, ActivityIndicator, ScrollView, Linking } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIAP } from 'react-native-iap';
import Constants from 'expo-constants';
import { RootStackParamList, CountdownSoundMode, WeightUnit } from '../types';
import { loadCountdownSoundMode, saveCountdownSoundMode, loadWeightUnit, saveWeightUnit, loadAdFreeStatus, saveAdFreeStatus } from '../storage';
import { ChevronIcon, CheckIcon } from '../components/WorkoutIcons';
import { BottomTabBar } from '../components/BottomTabBar';
import { Display, Label, Body } from '../components/PosterText';
import { band, colors, display, label, leading, rule, space, tracking } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

// TODO: replace with the real product ID once created in Play Console /
// App Store Connect — must match exactly on both, and on both platforms
// this needs to be configured as a one-time non-consumable product before a
// real purchase can succeed.
const REMOVE_ADS_SKU = 'remove_ads';

// TODO: swap for the real policy URL once one is published.
const PRIVACY_POLICY_URL = 'https://example.com/flex-privacy';

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

  // Fetch the store-listed price as soon as the store connection is ready, so
  // the button can show the localized price once it's known.
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

  const removeAdsPrice = products.find(p => p.id === REMOVE_ADS_SKU)?.displayPrice;

  const handlePurchaseRemoveAds = async () => {
    if (!connected) {
      Alert.alert('Store unavailable', 'Could not connect to the store right now. Please try again later.');
      return;
    }
    if (!products.some(p => p.id === REMOVE_ADS_SKU)) {
      Alert.alert('Not available right now', 'Remove Ads can\'t be purchased right now. Please try again later.');
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

  const openPrivacyPolicy = () => {
    Linking.openURL(PRIVACY_POLICY_URL).catch(() => {
      Alert.alert('Could not open link', 'The privacy policy could not be opened right now.');
    });
  };

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
      <View style={styles.statusBarSpacer} />

      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.square, pressed && styles.pressed]}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ChevronIcon color={colors.ink} size={18} direction="left" />
        </Pressable>
        <Display style={styles.hero} numberOfLines={1} adjustsFontSizeToFit>Settings</Display>
      </View>

      {loaded && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Label style={styles.sectionHeader}>Session countdown</Label>
          <View style={styles.card}>
            {SOUND_MODES.map((option, index) => {
              const selected = soundMode === option.id;
              return (
                <Pressable
                  key={option.id}
                  style={({ pressed }) => [styles.optionRow, index > 0 && styles.optionRowBorder, pressed && styles.pressed]}
                  onPress={() => handleSelect(option.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Use ${option.title.toLowerCase()} countdown`}
                >
                  <View style={[styles.marker, selected && styles.markerSelected]}>
                    {selected && <CheckIcon color={colors.onInk} size={12} />}
                  </View>
                  <View style={styles.optionInfo}>
                    <Label style={styles.optionTitle}>{option.title}</Label>
                    <Body style={styles.optionDescription}>{option.description}</Body>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Body style={styles.hint}>
            You can also tap the speaker icon during a workout to switch between these.
          </Body>

          <Label style={styles.sectionHeader}>Weight unit</Label>
          <View style={styles.card}>
            {WEIGHT_UNITS.map((option, index) => {
              const selected = weightUnit === option.id;
              return (
                <Pressable
                  key={option.id}
                  style={({ pressed }) => [styles.optionRow, index > 0 && styles.optionRowBorder, pressed && styles.pressed]}
                  onPress={() => handleSelectWeightUnit(option.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Use ${option.title}`}
                >
                  <View style={[styles.marker, selected && styles.markerSelected]}>
                    {selected && <CheckIcon color={colors.onInk} size={12} />}
                  </View>
                  <View style={styles.optionInfo}>
                    <Label style={styles.optionTitle}>{option.title}</Label>
                    <Body style={styles.optionDescription}>{option.description}</Body>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Label style={styles.sectionHeader}>Support Flex</Label>
          {adFree ? (
            <View style={[styles.card, styles.cardAccent]}>
              <View style={styles.adFreeRow}>
                <CheckIcon color={colors.ink} size={16} />
                <Label style={styles.adFreeText}>Ads removed — thank you</Label>
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              <Pressable
                style={({ pressed }) => [styles.purchaseRow, pressed && styles.pressed]}
                onPress={handlePurchaseRemoveAds}
                disabled={purchasing}
                accessibilityRole="button"
                accessibilityLabel="Remove ads"
              >
                <View style={styles.optionInfo}>
                  <Display style={styles.purchaseTitle}>
                    {removeAdsPrice ? `Remove Ads - ${removeAdsPrice}` : 'Remove Ads'}
                  </Display>
                  <Body style={styles.optionDescription}>
                    One-time purchase. You won&apos;t see any ads, forever.
                  </Body>
                </View>
                {purchasing && <ActivityIndicator color={colors.ink} />}
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.linkRow, styles.optionRowBorder, pressed && styles.pressed]}
                onPress={handleRestorePurchases}
                accessibilityRole="button"
                accessibilityLabel="Restore purchases"
              >
                <Label style={styles.linkLabel}>Restore purchases</Label>
              </Pressable>
            </View>
          )}

          <Label style={styles.sectionHeader}>About</Label>
          <View style={styles.card}>
            <Pressable
              style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
              onPress={openPrivacyPolicy}
              accessibilityRole="link"
              accessibilityLabel="Open the privacy policy"
            >
              <Label style={styles.linkLabel}>Privacy policy</Label>
              <ChevronIcon color={colors.ink} size={12} direction="right" />
            </Pressable>
            <View style={[styles.linkRow, styles.optionRowBorder]}>
              <Label style={styles.linkLabel}>Version</Label>
              <Label style={styles.versionValue}>{version}</Label>
            </View>
          </View>
        </ScrollView>
      )}

      <BottomTabBar active="settings" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  statusBarSpacer: {
    height: band.statusBar,
  },
  header: {
    paddingHorizontal: space.gutter,
    paddingTop: space.tight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.row,
  },
  square: {
    width: band.control,
    height: band.control,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: colors.rowPress,
  },
  hero: {
    flex: 1,
    fontSize: display.hero,
    lineHeight: Math.round(display.hero * leading.display),
    letterSpacing: tracking.display,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space.gutter,
    paddingTop: space.block,
    paddingBottom: space.block * 2,
  },
  sectionHeader: {
    fontSize: label.micro,
    color: colors.inkMuted,
    marginTop: space.block,
    marginBottom: space.tight,
  },
  card: {
    borderWidth: rule.heavy,
    borderColor: colors.ink,
  },
  cardAccent: {
    backgroundColor: colors.accent,
  },
  optionRow: {
    minHeight: band.control,
    padding: space.row,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.row,
  },
  optionRowBorder: {
    borderTopWidth: rule.heavy,
    borderTopColor: colors.ink,
  },
  marker: {
    width: 22,
    height: 22,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  markerSelected: {
    backgroundColor: colors.ink,
  },
  optionInfo: {
    flex: 1,
    gap: space.hair,
  },
  optionTitle: {
    fontSize: label.base,
  },
  optionDescription: {
    fontSize: label.micro,
    lineHeight: label.micro * 1.5,
    color: colors.inkMuted,
  },
  hint: {
    marginTop: space.tight,
    fontSize: label.micro,
    lineHeight: label.micro * 1.5,
    color: colors.inkMuted,
  },
  purchaseRow: {
    minHeight: band.control,
    padding: space.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.row,
  },
  purchaseTitle: {
    fontSize: display.entryTitle,
    lineHeight: display.entryTitle * leading.snug,
  },
  linkRow: {
    minHeight: band.control,
    paddingHorizontal: space.row,
    paddingVertical: space.tight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  linkLabel: {
    fontSize: label.small,
    letterSpacing: tracking.label,
  },
  versionValue: {
    fontSize: label.small,
    color: colors.inkMuted,
    fontVariant: ['tabular-nums'],
  },
  adFreeRow: {
    padding: space.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
  },
  adFreeText: {
    flex: 1,
    fontSize: label.base,
  },
});
