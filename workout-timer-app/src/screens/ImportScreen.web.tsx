// Web version of ImportScreen.tsx. The web version never calls the Flex server, so
// the only import is "Use your own AI": the user's own ChatGPT, Claude or Gemini
// writes the plan in the Flex format, and it is read here, in the browser, by the
// same parser the app uses (import/ownAiFormat.ts). Layout and styles are the
// app's own (copied from ImportScreen.tsx).
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TextInput, Pressable, ScrollView, StatusBar } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList, Workout } from '../types';
import { MAX_PLAN_CHARS, OWN_AI_PROMPT, OwnAiPlan, parseOwnAiPlan } from '../import/ownAiFormat';
import { CloseIcon } from '../components/WorkoutIcons';
import { Display, Label, Body } from '../components/PosterText';
import { band, colors, display, font, label, leading, rule, space, tracking } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Import'>;

const generateId = () => Math.random().toString(36).substring(2, 9);

/** A parsed plan as an unsaved workout for the review-and-edit screen. */
function planToWorkout(plan: OwnAiPlan): Workout {
  return {
    id: generateId(),
    name: plan.name ?? 'My AI workout',
    exercises: plan.exercises.map(ex => ({ id: generateId(), ...ex })),
    rounds: plan.rounds,
    restBetweenRoundsSeconds: plan.restBetweenRoundsSeconds,
  };
}

/** Copy text in a browser: the Clipboard API, or the older select-and-copy for older Safari. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the older method
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function ImportScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const handleCopy = async () => {
    const ok = await copyText(OWN_AI_PROMPT);
    setCopied(ok ? 'copied' : 'failed');
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied('idle'), 3000);
  };

  const handleReview = () => {
    const result = parseOwnAiPlan(text);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    if (result.plan.notes.length > 0) window.alert(`Check your workout\n\n${result.plan.notes.join('\n\n')}`);
    navigation.replace('WorkoutEditor', { draftWorkout: planToWorkout(result.plan) });
  };

  const canReview = text.trim().length > 0;

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
      </View>

      <Display style={styles.hero} numberOfLines={1} adjustsFontSizeToFit>Import</Display>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Body style={styles.ownAiIntro}>
          Let ChatGPT, Claude or Gemini plan it. Your AI already knows your goals, equipment and limits. Flex reads its
          plan right here in your browser; nothing is sent anywhere.
        </Body>

        <Label style={styles.stepLabel}>1. Copy this prompt into your AI</Label>
        <ScrollView style={styles.promptBox} nestedScrollEnabled>
          <Body style={styles.promptText} selectable>{OWN_AI_PROMPT}</Body>
        </ScrollView>
        <Pressable
          style={({ pressed }) => [styles.ghostBar, styles.copyBar, pressed && styles.squarePressed]}
          onPress={handleCopy}
          accessibilityRole="button"
          accessibilityLabel="Copy the prompt"
        >
          <Label style={styles.ghostBarLabel}>
            {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Press and hold the prompt to copy it' : 'Copy prompt'}
          </Label>
        </Pressable>
        <Label style={styles.hint}>Then add what you want, e.g. 30 minutes, dumbbells, easy on my knees</Label>

        <Label style={styles.stepLabel}>2. Paste your AI&apos;s answer here</Label>
        <TextInput
          style={styles.textArea}
          placeholder={'WORKOUT: ...\n- Push-ups | 3 sets | 10 reps | rest 60s'}
          placeholderTextColor={colors.placeholder}
          value={text}
          onChangeText={next => {
            setText(next);
            if (error) setError(null);
          }}
          // One over the limit, so an oversized paste is reported instead of silently cut.
          maxLength={MAX_PLAN_CHARS + 1}
          multiline
          numberOfLines={8}
          textAlignVertical="top"
          autoCorrect={false}
          autoCapitalize="none"
        />

        {error && (
          <View style={styles.ownAiError} accessibilityLiveRegion="polite">
            <Body style={styles.errorMessage}>{error}</Body>
          </View>
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
          !canReview && styles.primaryBarDisabled,
          pressed && canReview && styles.primaryBarPressed,
        ]}
        onPress={handleReview}
        disabled={!canReview}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canReview }}
      >
        <Display style={[styles.primaryBarLabel, !canReview && styles.primaryBarLabelDisabled]}>Review workout</Display>
      </Pressable>
    </View>
  );
}

// Copied verbatim from ImportScreen.tsx (the entries this screen uses), so it looks the same.
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
  hero: {
    paddingHorizontal: space.gutter,
    paddingTop: space.tight,
    fontSize: display.hero,
    lineHeight: Math.round(display.hero * leading.display),
    letterSpacing: tracking.display,
  },
  scroll: {
    paddingHorizontal: space.gutter,
    paddingTop: space.block,
    paddingBottom: space.block,
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
  ownAiIntro: {
    fontSize: label.base,
    lineHeight: label.base * 1.5,
  },
  stepLabel: {
    marginTop: space.block,
    marginBottom: space.tight,
    fontSize: label.small,
    letterSpacing: tracking.wide,
  },
  promptBox: {
    maxHeight: 170,
    borderWidth: rule.thin,
    borderColor: colors.ink,
    padding: space.row,
  },
  promptText: {
    fontSize: label.small,
    lineHeight: label.small * 1.45,
    paddingBottom: space.row,
  },
  copyBar: {
    marginTop: space.tight,
  },
  ownAiError: {
    marginTop: space.row,
    gap: space.tight,
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
  errorMessage: {
    fontSize: label.base,
    lineHeight: label.base * 1.5,
    color: colors.inkMuted,
  },
});
