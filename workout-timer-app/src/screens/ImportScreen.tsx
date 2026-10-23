import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  Alert,
  ScrollView,
  Image,
  Platform,
  StatusBar,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { noteTransition } from '../ads/interstitialManager';
import { RootStackParamList } from '../types';
import {
  extractWorkoutFromImage,
  extractWorkoutFromText,
  fetchUsage,
  ImportLimitError,
  refreshUsage,
  RewardStartError,
  confirmReward,
  startReward,
} from '../api';
import { REWARDED_ADS_CONFIGURED, showRewardedAd } from '../rewardedAd';
import { getUsageSnapshot, patchUsage, subscribeUsage } from '../usageStore';
import { useUsage } from '../useUsage';
import { CloseIcon, CameraIcon, RotatingDumbbellIcon } from '../components/WorkoutIcons';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Display, Label, Body } from '../components/PosterText';
import { band, colors, display, font, label, leading, rule, space, tracking } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Import'>;
type Tab = 'image' | 'text';

const LOADING_MESSAGES: Record<Tab, string[]> = {
  image: ['Scanning the image...', 'Reading exercise names...', 'Extracting sets and reps...', 'Structuring your workout...'],
  text: ['Reading your workout...', 'Identifying exercises...', 'Structuring sets and reps...', 'Almost done...'],
};

const ERROR_TITLES: Record<Tab, string> = {
  image: "Couldn't read that image",
  text: "Couldn't understand that workout",
};

const ERROR_ALT_ACTION: Record<Tab, string | null> = {
  image: 'Or type it in as text instead',
  text: null,
};

const TABS: { key: Tab; title: string }[] = [
  { key: 'image', title: 'Image' },
  { key: 'text', title: 'Text' },
];

type ImportError = { tab: Tab; message: string };

// How long the "adding your imports" dialog stays open before the user is let go on
// while the confirmation keeps being awaited in the background.
const REWARD_FOREGROUND_WAIT_MS = 30_000;

export function ImportScreen({ navigation }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('image');
  const [loading, setLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [importError, setImportError] = useState<ImportError | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    noteTransition('import');
  }, []);

  // The import allowance lives on the server. Start from the last value we heard
  // (if any) and refresh it each time this screen opens; if that request fails we
  // keep the last known value, or show no counter at all if there isn't one.
  // The cached allowance shows straight away; `usageStatus` says whether the server
  // has confirmed it yet. Until it has (or 10 seconds pass), Import stays disabled.
  const { usage, status: usageStatus, settled: usageSettled, rewardPending } = useUsage();
  const [limitModalVisible, setLimitModalVisible] = useState(false);
  const [rewardPhase, setRewardPhase] = useState<'idle' | 'preparing' | 'confirming' | 'slow'>('idle');
  const [rewardNotice, setRewardNotice] = useState<{ title: string; message: string } | null>(null);
  const isFocused = useIsFocused();

  // An extraction can finish after the user has backed out of this screen; its
  // result is dropped in that case rather than navigating them somewhere unexpected.
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  useEffect(() => {
    if (!isFocused) return;
    refreshUsage().then(fresh => {
      if (!isMountedRef.current) return;
      if (fresh && fresh.remaining <= 0 && !getUsageSnapshot().rewardPending) setLimitModalVisible(true);
    });
  }, [isFocused]);

  /** Returns true if the import can proceed; otherwise shows the limit-reached modal. */
  const checkImportAllowed = (): boolean => {
    // Only a confirmed answer blocks here; otherwise the server decides.
    if (!rewardPending && usageStatus === 'fresh' && usage !== null && usage.remaining <= 0) {
      setLimitModalVisible(true);
      return false;
    }
    return true;
  };

  // Cycle through contextual status lines while extraction is underway
  useEffect(() => {
    if (!loading) {
      setLoadingMessageIndex(0);
      return;
    }
    const id = setInterval(() => setLoadingMessageIndex(current => current + 1), 1700);
    return () => clearInterval(id);
  }, [loading]);

  // Image tab state
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState('image/jpeg');

  // Text tab state
  const [workoutText, setWorkoutText] = useState('');

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handlePickImage = async () => {
    try {
      // On iOS, check and request permission if needed.
      // On modern Android (API 33+), the system Photo Picker runs in its own process and requires zero permissions.
      if (Platform.OS === 'ios') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Allow access to your photo library to import a workout image.');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.6,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setImageUri(asset.uri);
        setImageBase64(asset.base64 ?? null);
        const ext = asset.uri.split('.').pop()?.toLowerCase();
        setImageMime(ext === 'png' ? 'image/png' : 'image/jpeg');
      }
    } catch (e: any) {
      console.log('Error opening photo library:', e);
      Alert.alert('Error', e.message || 'Could not open photo library');
    }
  };

  const handleImageExtract = async () => {
    if (!imageBase64) {
      Alert.alert('No Image', 'Pick a workout image first.');
      return;
    }
    if (!checkImportAllowed()) return;
    setLoading(true);
    setImportError(null);
    try {
      const { workout } = await extractWorkoutFromImage(imageBase64, imageMime);
      if (!isMountedRef.current) return;
      navigation.replace('WorkoutEditor', { draftWorkout: workout });
    } catch (e: any) {
      if (e instanceof ImportLimitError) {
        if (isMountedRef.current) {
          setLimitModalVisible(true);
        }
        return;
      }
      setImportError({ tab: 'image', message: e.message || 'Something went wrong reading that image.' });
    } finally {
      setLoading(false);
    }
  };

  const handleTextExtract = async () => {
    if (!workoutText.trim()) {
      Alert.alert('Error', 'Paste or type a workout description first.');
      return;
    }
    if (!checkImportAllowed()) return;
    setLoading(true);
    setImportError(null);
    try {
      const { workout } = await extractWorkoutFromText(workoutText.trim());
      if (!isMountedRef.current) return;
      navigation.replace('WorkoutEditor', { draftWorkout: workout });
    } catch (e: any) {
      if (e instanceof ImportLimitError) {
        if (isMountedRef.current) {
          setLimitModalVisible(true);
        }
        return;
      }
      setImportError({ tab: 'text', message: e.message || 'Something went wrong reading that workout.' });
    } finally {
      setLoading(false);
    }
  };

  // ─── Rewarded video (+2 imports) ────────────────────────────────────────────
  // The server decides the reward: it issues a token, AdMob confirms the view to
  // the server, and the server adds the imports. This screen only asks, plays the
  // ad, and then reads the new allowance back; it never grants anything itself.

  const handleWatchVideo = async () => {
    if (rewardPhase !== 'idle') return;
    const remainingBefore = usage?.remaining ?? 0;
    setRewardNotice(null);
    setRewardPhase('preparing');

    let token: string;
    try {
      token = await startReward();
    } catch (e) {
      if (!isMountedRef.current) return;
      setRewardPhase('idle');
      if (e instanceof RewardStartError && e.kind === 'cap_reached') {
        patchUsage({ rewards_remaining: 0 });
        setLimitModalVisible(false);
        setRewardNotice({
          title: 'No more videos',
          message: "You've used all your bonus videos for this month. Your imports reset at the start of your next period.",
        });
      } else if (e instanceof RewardStartError && e.kind === 'not_needed') {
        setLimitModalVisible(false);
        fetchUsage().catch(() => {});
      } else {
        setRewardNotice({
          title: "Couldn't start the video",
          message: "We couldn't reach the server just now. Nothing was used. Please try again in a moment.",
        });
      }
      return;
    }

    const outcome = await showRewardedAd(token);
    if (!isMountedRef.current) return;

    if (outcome === 'failed') {
      setRewardPhase('idle');
      setRewardNotice({
        title: 'No video available',
        message: "We couldn't load a video right now. Nothing was used. Please try again in a bit.",
      });
      return;
    }
    if (outcome === 'closed') {
      // Closed before the reward was earned: back to the limit dialog.
      setRewardPhase('idle');
      return;
    }

    // Earned. The "limit reached" prompt is out of date from here on, whatever happens next.
    setLimitModalVisible(false);
    setRewardPhase('confirming');
    const watch = confirmReward(remainingBefore);
    // Success is announced by the store subscription below, whenever the server confirms.
    watch.then(confirmed => {
      if (confirmed || !isMountedRef.current) return;
      setRewardPhase('idle');
      setRewardNotice({
        title: "Couldn't confirm your video",
        message: "The server didn't confirm it in time. If your imports don't show up, try the video again.",
      });
    });
    // Wait a little with the dialog open; after that let the user carry on while the
    // confirmation keeps being awaited in the background.
    await Promise.race([watch, new Promise(resolve => setTimeout(resolve, REWARD_FOREGROUND_WAIT_MS))]);
    if (!isMountedRef.current) return;
    if (getUsageSnapshot().rewardPending) setRewardPhase(phase => (phase === 'confirming' ? 'slow' : phase));
  };

  // The server confirms a reward whenever AdMob's callback lands (seconds, or minutes).
  // This shows it once, at that moment, wherever the user is on this screen.
  const lastConfirmedRef = useRef(getUsageSnapshot().rewardConfirmed?.at ?? null);
  useEffect(
    () =>
      subscribeUsage(() => {
        const { rewardConfirmed, usage: latest } = getUsageSnapshot();
        if (!rewardConfirmed || rewardConfirmed.at === lastConfirmedRef.current) return;
        lastConfirmedRef.current = rewardConfirmed.at;
        const left = latest?.remaining ?? rewardConfirmed.added;
        setRewardPhase('idle');
        setLimitModalVisible(false);
        setRewardNotice({
          title: `+${rewardConfirmed.added} imports added`,
          message: `You have ${left} ${left === 1 ? 'import' : 'imports'} left.`,
        });
      }),
    [],
  );

  const dismissRewardNotice = () => {
    setRewardNotice(null);
    // Refresh so the counter is right; only an unconfirmed, empty allowance brings the limit prompt back.
    fetchUsage()
      .then(fresh => {
        if (!isMountedRef.current) return;
        if (fresh.remaining <= 0 && !getUsageSnapshot().rewardPending) setLimitModalVisible(true);
      })
      .catch(() => {});
  };

  const handleRetryImport = () => {
    if (!importError) return;
    if (importError.tab === 'image') handleImageExtract();
    else handleTextExtract();
  };

  const handleSwitchToTextFromError = () => {
    setImportError(null);
    setActiveTab('text');
  };

  // ─── Derived ────────────────────────────────────────────────────────────────

  const limitReached = !rewardPending && usageStatus === 'fresh' && usage !== null && usage.remaining <= 0;
  const resetDate = usage?.resets_at
    ? new Date(usage.resets_at.replace(/(\.\d{3})\d+/, '$1')).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const limitMessage = usage
    ? `You've used all ${usage.limit} imports for this month.${resetDate ? ` Your imports reset on ${resetDate}.` : ''}`
    : "You've used all your imports for this month.";
  // Offered whenever the server says a reward is still available; Remove Ads
  // doesn't affect it because the video is optional.
  const canWatchVideo = REWARDED_ADS_CONFIGURED && (usage?.rewards_remaining ?? 0) > 0;
  const closeLimitDialog = () => setLimitModalVisible(false);

  const closeSlowDialog = () => setRewardPhase('idle');

  // One dialog slot, whichever message is current: working, result, or the limit prompt.
  const dialog: Omit<React.ComponentProps<typeof ConfirmDialog>, 'visible'> =
    rewardPhase === 'slow'
      ? {
          title: 'Almost there',
          message: "Your video is still being confirmed. You can close this: your imports are added automatically as soon as it's done.",
          onRequestClose: closeSlowDialog,
          actions: [{ label: 'Close', variant: 'primary', onPress: closeSlowDialog }],
        }
      : rewardPhase !== 'idle'
      ? {
          title: rewardPhase === 'preparing' ? 'Getting your video ready' : 'Adding your imports',
          message:
            rewardPhase === 'preparing'
              ? 'Hang tight, this only takes a moment.'
              : 'Confirming your video with the server. This usually takes a few seconds.',
          actions: [],
        }
      : rewardNotice
        ? {
            title: rewardNotice.title,
            message: rewardNotice.message,
            onRequestClose: dismissRewardNotice,
            actions: [{ label: 'OK', variant: 'primary', onPress: dismissRewardNotice }],
          }
        : {
            title: 'Import limit reached',
            message: limitMessage,
            onRequestClose: closeLimitDialog,
            actions: [
              ...(canWatchVideo
                ? [{ label: 'Watch a video for +2 imports', variant: 'primary' as const, onPress: handleWatchVideo }]
                : []),
              { label: 'OK', variant: canWatchVideo ? ('neutral' as const) : ('primary' as const), onPress: closeLimitDialog },
            ],
          };
  const canImportText = workoutText.trim().length > 0 && !limitReached;
  const canImportImage = imageBase64 !== null && !limitReached;
  // Held back until the server has answered (or 10s have passed), so an import is
  // never started on a stale count. Building by hand is never held back.
  const canImport = (activeTab === 'image' ? canImportImage : canImportText) && usageSettled;
  const activeLoadingMessages = LOADING_MESSAGES[activeTab];
  const loadingMessage = activeLoadingMessages[loadingMessageIndex % activeLoadingMessages.length];
  const processingSource = activeTab === 'image' ? 'Workout image' : 'Workout description';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
      <View style={styles.statusBarSpacer} />

      <View style={styles.topBar}>
        <Pressable
          style={({ pressed }) => [styles.square, pressed && styles.squarePressed]}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Close import"
        >
          <CloseIcon color={colors.ink} size={16} />
        </Pressable>
        {usage !== null ? (
          <View style={styles.usageColumn}>
            <View style={styles.usageChip}>
              <View
                style={[
                  styles.usageDot,
                  limitReached && styles.usageDotEmpty,
                  usageStatus !== 'fresh' && styles.usageDotPending,
                ]}
              />
              <Label style={[styles.usageLabel, usageStatus !== 'fresh' && styles.usageLabelPending]}>
                {rewardPending
                  ? 'Confirming video…'
                  : limitReached
                    ? 'No imports left'
                    : `${usage.remaining} Imports left${usageStatus === 'checking' ? '…' : ''}`}
              </Label>
            </View>
            {usageStatus === 'failed' && <Label style={styles.usageNote}>May be out of date</Label>}
          </View>
        ) : usageStatus !== 'failed' ? (
          <View style={styles.usageChip}>
            <View style={[styles.usageDot, styles.usageDotPending]} />
            <Label style={[styles.usageLabel, styles.usageLabelPending]}>Checking…</Label>
          </View>
        ) : null}
      </View>

      <Display style={styles.hero} numberOfLines={1} adjustsFontSizeToFit>Import</Display>

      {loading ? (
        /* ── Loading ────────────────────────────────────────────────────────── */
        <View style={styles.statusBody}>
          <RotatingDumbbellIcon color={colors.ink} size={64} />
          <Display style={styles.statusTitle} numberOfLines={2}>{loadingMessage}</Display>
          <Label style={styles.statusMeta}>{processingSource}</Label>
          <View style={styles.note}>
            <Label style={styles.noteText}>You&apos;ll review and edit it next</Label>
          </View>
        </View>
      ) : importError ? (
        /* ── Error ──────────────────────────────────────────────────────────── */
        <View style={styles.statusBody}>
          <Display style={styles.errorTitle} numberOfLines={3}>{ERROR_TITLES[importError.tab]}</Display>
          <Body style={styles.errorMessage}>{importError.message}</Body>
          <Pressable
            style={({ pressed }) => [styles.primaryBar, pressed && styles.primaryBarPressed]}
            onPress={handleRetryImport}
            accessibilityRole="button"
          >
            <Display style={styles.primaryBarLabel}>Try again</Display>
          </Pressable>
          {ERROR_ALT_ACTION[importError.tab] && (
            <Pressable
              style={({ pressed }) => [styles.ghostBar, pressed && styles.squarePressed]}
              onPress={handleSwitchToTextFromError}
              accessibilityRole="button"
            >
              <Label style={styles.ghostBarLabel}>{ERROR_ALT_ACTION[importError.tab]}</Label>
            </Pressable>
          )}
        </View>
      ) : (
        /* ── Picker ─────────────────────────────────────────────────────────── */
        <>
          <View style={styles.tabBar}>
            {TABS.map((tab, index) => {
              const selected = tab.key === activeTab;
              return (
                <Pressable
                  key={tab.key}
                  style={[styles.tab, index > 0 && styles.tabDivider, selected && styles.tabActive]}
                  onPress={() => {
                    setImportError(null);
                    setActiveTab(tab.key);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Label style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.title}</Label>
                </Pressable>
              );
            })}
          </View>

          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {activeTab === 'image' ? (
              <>
                <Pressable
                  style={({ pressed }) => [styles.dropZone, pressed && styles.squarePressed]}
                  onPress={handlePickImage}
                  accessibilityRole="button"
                  accessibilityLabel="Choose a workout photo"
                >
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="contain" />
                  ) : (
                    <View style={styles.dropInner}>
                      <CameraIcon color={colors.ink} size={28} />
                      <Display style={styles.dropTitle}>Tap to choose{'\n'}a photo</Display>
                    </View>
                  )}
                </Pressable>
                <Label style={styles.hint}>A workout plan, a class card, a whiteboard</Label>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.textArea}
                  placeholder="Paste your workout here..."
                  placeholderTextColor={colors.placeholder}
                  value={workoutText}
                  onChangeText={setWorkoutText}
                  multiline
                  numberOfLines={8}
                  textAlignVertical="top"
                />
                <Label style={styles.hint}>Exercise names, times, reps and rest</Label>
              </>
            )}

            <View style={styles.divider} />
            <Label style={styles.orLabel}>Or start from scratch</Label>
            <Pressable
              style={({ pressed }) => [styles.ghostBar, pressed && styles.squarePressed]}
              onPress={() => navigation.replace('WorkoutEditor', {})}
              accessibilityRole="button"
              accessibilityLabel="Build a workout by hand"
            >
              <Label style={styles.ghostBarLabel}>+ Build it by hand</Label>
            </Pressable>
          </ScrollView>

          <Pressable
            style={({ pressed }) => [
              styles.primaryBar,
              styles.footerBar,
              { marginBottom: space.row + insets.bottom },
              !canImport && styles.primaryBarDisabled,
              pressed && canImport && styles.primaryBarPressed,
            ]}
            onPress={activeTab === 'image' ? handleImageExtract : handleTextExtract}
            disabled={!canImport}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canImport }}
          >
            <Display style={[styles.primaryBarLabel, !canImport && styles.primaryBarLabelDisabled]}>
              {rewardPending ? 'Confirming video…' : usageSettled ? 'Import' : 'Checking imports…'}
            </Display>
          </Pressable>
        </>
      )}

      <ConfirmDialog
        visible={limitModalVisible || rewardPhase !== 'idle' || rewardNotice !== null}
        {...dialog}
      />
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
  topBar: {
    paddingHorizontal: space.gutter,
    paddingTop: space.tight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  squarePressed: {
    backgroundColor: colors.rowPress,
  },
  usageColumn: {
    alignItems: 'flex-end',
    gap: space.hair,
  },
  usageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.hair + 2,
  },
  usageDot: {
    width: 10,
    height: 10,
    backgroundColor: colors.accent,
  },
  usageDotEmpty: {
    backgroundColor: colors.danger,
  },
  usageLabel: {
    fontSize: label.small,
  },
  // Cached count, not yet confirmed by the server: hollow dot and dimmed text.
  usageDotPending: {
    backgroundColor: 'transparent',
    borderWidth: rule.thin,
    borderColor: colors.inkMuted,
  },
  usageLabelPending: {
    color: colors.inkMuted,
  },
  usageNote: {
    fontSize: label.micro,
    color: colors.inkMuted,
  },
  hero: {
    paddingHorizontal: space.gutter,
    paddingTop: space.tight,
    fontSize: display.hero,
    lineHeight: Math.round(display.hero * leading.display),
    letterSpacing: tracking.display,
  },
  // ── Mode tabs ─────────────────────────────────────────────────────────────
  tabBar: {
    marginHorizontal: space.gutter,
    marginTop: space.block,
    flexDirection: 'row',
    borderWidth: rule.heavy,
    borderColor: colors.ink,
  },
  tab: {
    flex: 1,
    minHeight: band.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabDivider: {
    borderLeftWidth: rule.heavy,
    borderLeftColor: colors.ink,
  },
  tabActive: {
    backgroundColor: colors.ink,
  },
  tabLabel: {
    fontSize: label.base,
    letterSpacing: tracking.label,
  },
  tabLabelActive: {
    color: colors.onInk,
  },
  // ── Body ──────────────────────────────────────────────────────────────────
  scroll: {
    paddingHorizontal: space.gutter,
    paddingTop: space.block,
    paddingBottom: space.block,
  },
  dropZone: {
    height: 200,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dropInner: {
    alignItems: 'center',
    gap: space.row,
  },
  dropTitle: {
    fontSize: display.entryTitle,
    lineHeight: display.entryTitle * leading.snug,
    textAlign: 'center',
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  textArea: {
    height: 200,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    padding: space.row,
    color: colors.ink,
    fontFamily: font.medium,
    fontSize: label.cue,
    lineHeight: label.cue * 1.4,
  },
  hint: {
    marginTop: space.tight,
    fontSize: label.micro,
    color: colors.inkMuted,
  },
  divider: {
    height: rule.heavy,
    backgroundColor: colors.ink,
    marginTop: space.block,
  },
  orLabel: {
    marginTop: space.row,
    marginBottom: space.tight,
    fontSize: label.micro,
    color: colors.inkMuted,
  },
  // ── Bars ──────────────────────────────────────────────────────────────────
  primaryBar: {
    height: band.cta,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerBar: {
    marginHorizontal: space.gutter,
  },
  primaryBarPressed: {
    backgroundColor: colors.inkPress,
  },
  primaryBarDisabled: {
    backgroundColor: colors.paper,
    borderWidth: rule.heavy,
    borderColor: colors.inkMuted,
  },
  primaryBarLabel: {
    color: colors.onInk,
    fontSize: display.cta,
    lineHeight: display.cta * leading.snug,
    letterSpacing: 0.6,
  },
  primaryBarLabelDisabled: {
    color: colors.inkMuted,
  },
  ghostBar: {
    minHeight: band.control,
    paddingHorizontal: space.block,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBarLabel: {
    fontSize: label.small,
    letterSpacing: tracking.wide,
  },
  // ── Loading / error ───────────────────────────────────────────────────────
  statusBody: {
    flex: 1,
    paddingHorizontal: space.gutter,
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: space.block,
  },
  statusTitle: {
    fontSize: display.rowTitle,
    lineHeight: display.rowTitle * leading.snug,
  },
  statusMeta: {
    fontSize: label.micro,
    color: colors.inkMuted,
  },
  note: {
    borderWidth: rule.thin,
    borderColor: colors.ink,
    paddingHorizontal: space.row,
    paddingVertical: space.tight,
  },
  noteText: {
    fontSize: label.micro,
  },
  errorTitle: {
    fontSize: 48,
    lineHeight: 48 * leading.display,
    letterSpacing: tracking.display,
  },
  errorMessage: {
    fontSize: label.base,
    lineHeight: label.base * 1.5,
    color: colors.inkMuted,
  },
});
