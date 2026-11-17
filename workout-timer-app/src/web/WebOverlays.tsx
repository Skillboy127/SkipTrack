// Web only. What the web version shows on top of the app's own screens:
// - short notices (e.g. "keep the screen on" when a workout starts), see notices.ts;
// - once, after onboarding, how to add Flex to the Home Screen (when it isn't installed yet).
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Body } from '../components/PosterText';
import { colors, label, rule, space } from '../theme';
import { dismissNotice, getNotice, subscribeNotices } from './notices';

const INSTALL_HINT_KEY = 'flex.web.installHintSeen';

export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS reports itself as a Mac, but with touch.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export const INSTALL_STEPS_IOS =
  'In Safari, tap the Share button (the square with an arrow), then "Add to Home Screen", then Add. Flex then opens full screen from its own icon, like an app.';
export const INSTALL_STEPS_OTHER =
  'Open your browser menu and choose "Add to Home screen" or "Install app". Flex then opens full screen from its own icon, like an app.';

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string) {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // private mode: it may show again next time, which is harmless
  }
}

function NoticeBanner() {
  const insets = useSafeAreaInsets();
  const notice = useSyncExternalStore(subscribeNotices, getNotice);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => dismissNotice(notice.id), notice.durationMs);
    return () => clearTimeout(id);
  }, [notice]);
  if (!notice) return null;
  return (
    <View pointerEvents="box-none" style={[styles.noticeWrap, { top: insets.top + space.row }]}>
      <Pressable
        style={styles.notice}
        onPress={() => dismissNotice(notice.id)}
        accessibilityRole="alert"
        accessibilityLabel={`${notice.message} Tap to dismiss.`}
      >
        <Body style={styles.noticeText}>{notice.message}</Body>
      </Pressable>
    </View>
  );
}

/** `onLibrary`: the Library is the current screen (the hint only appears there). */
export function WebOverlays({ onLibrary }: { onLibrary: boolean }) {
  const [installHint, setInstallHint] = useState(false);

  useEffect(() => {
    if (!onLibrary || isInstalledApp() || readFlag(INSTALL_HINT_KEY)) return;
    const id = setTimeout(() => setInstallHint(true), 1200);
    return () => clearTimeout(id);
  }, [onLibrary]);

  const closeInstallHint = () => {
    writeFlag(INSTALL_HINT_KEY);
    setInstallHint(false);
  };

  return (
    <>
      <NoticeBanner />
      <ConfirmDialog
        visible={installHint}
        title="Add Flex to your Home Screen"
        message={isIos() ? INSTALL_STEPS_IOS : INSTALL_STEPS_OTHER}
        onRequestClose={closeInstallHint}
        actions={[{ label: 'Got it', variant: 'primary', onPress: closeInstallHint }]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  noticeWrap: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    alignItems: 'center',
  },
  notice: {
    maxWidth: 440,
    backgroundColor: colors.paper,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    paddingHorizontal: space.row,
    paddingVertical: space.tight + 2,
  },
  noticeText: {
    fontSize: label.base,
    lineHeight: label.base * 1.45,
  },
});
