import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, StatusBar, useWindowDimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { CountdownSoundMode, RootStackParamList, WeightUnit } from '../types';
import {
  loadCountdownSoundMode,
  loadWeightUnitIfSet,
  saveCountdownSoundMode,
  saveHasSeenOnboarding,
  saveWeightUnit,
} from '../storage';
import { useAudio } from '../useAudio';
import { useSpeech } from '../useSpeech';
import { Display, Label, Body } from '../components/PosterText';
import { band, colors, display, label, leading, rule, space, tracking } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

type Slide = {
  title: string;
  body: string;
  // Shows the countdown-sound and weight-unit pickers under the body text.
  preferences?: boolean;
};

const SOUND_OPTIONS: { id: CountdownSoundMode; title: string; description: string }[] = [
  { id: 'speech', title: 'Spoken', description: 'Counts down out loud.' },
  { id: 'beep', title: 'Beep', description: 'A short beep for the countdown.' },
  { id: 'silent', title: 'Silent', description: 'Just the visual timer.' },
];

const UNIT_OPTIONS: { id: WeightUnit; title: string }[] = [
  { id: 'kg', title: 'KG' },
  { id: 'lb', title: 'LB' },
];

const SLIDES: Slide[] = [
  {
    title: 'Welcome to Flex',
    body: 'Your workout companion.',
  },
  {
    title: 'Import any workout',
    body: 'Snap a photo of a workout plan or card, or paste the exercises as text. Flex turns it into a timed routine you can start right away.',
  },
  {
    title: 'Build your own',
    body: 'Create a workout from scratch. Add exercises, set work and rest times, or use reps instead of a timer. Reorder and edit anytime.',
  },
  {
    title: 'Choose your countdown',
    body: 'Pick how Flex guides you.',
    preferences: true,
  },
  {
    title: 'Adjust on the fly',
    body: 'Edit any exercise, and drag its handle to reorder. During a rest, nudge the timer up or down by 5 seconds.',
  },
  {
    title: 'Free, with ads',
    body: 'Flex is free to use and supported by ads. Free users get 10 imports each month. Building your own workouts and running sessions is always unlimited.',
  },
];

export function OnboardingScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  // The choices are saved the moment they are made, under the same settings the
  // Settings screen reads, so the two always agree. The defaults shown here are
  // saved too, so skipping past this slide still leaves the app matching the screen.
  const [soundMode, setSoundMode] = useState<CountdownSoundMode>('speech');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const soundTouchedRef = useRef(false);
  const unitTouchedRef = useRef(false);
  const { playBeep } = useAudio();
  const { speak } = useSpeech(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadCountdownSoundMode(), loadWeightUnitIfSet()]).then(([savedMode, savedUnit]) => {
      if (cancelled) return;
      if (!soundTouchedRef.current) setSoundMode(savedMode);
      if (unitTouchedRef.current) return;
      if (savedUnit) setWeightUnit(savedUnit);
      else void saveWeightUnit('kg'); // nothing chosen yet: make the KG default real
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A short preview of what was picked, using the same sounds a workout uses.
  const chooseSound = (mode: CountdownSoundMode) => {
    soundTouchedRef.current = true;
    setSoundMode(mode);
    void saveCountdownSoundMode(mode);
    Speech.stop();
    if (mode === 'speech') speak('three, two, one');
    else if (mode === 'beep') playBeep();
  };

  const chooseUnit = (unit: WeightUnit) => {
    unitTouchedRef.current = true;
    setWeightUnit(unit);
    void saveWeightUnit(unit);
  };

  const finish = async () => {
    await saveHasSeenOnboarding();
    navigation.reset({ index: 0, routes: [{ name: 'Library' }] });
  };

  const goToSlide = (next: number) => {
    setIndex(next);
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
  };

  const handleMomentumEnd = (offsetX: number) => {
    setIndex(Math.round(offsetX / width));
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
      <View style={styles.statusBarSpacer} />

      <View style={styles.topBar}>
        {!isLast ? (
          <Pressable
            style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
            onPress={finish}
            accessibilityRole="button"
            accessibilityLabel="Skip introduction"
          >
            <Label style={styles.skipLabel}>Skip</Label>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onMomentumScrollEnd={e => handleMomentumEnd(e.nativeEvent.contentOffset.x)}
        style={styles.pager}
      >
        {SLIDES.map((slide, slideIndex) => (
          <ScrollView
            key={slide.title}
            style={{ width }}
            contentContainerStyle={[styles.slide, slide.preferences && styles.slideCompact]}
            showsVerticalScrollIndicator={false}
          >
            <Label style={styles.slideNumber}>
              {String(slideIndex + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
            </Label>
            <Display
              style={[styles.title, slide.preferences && styles.titleCompact]}
              numberOfLines={3}
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.2}
            >
              {slide.title}
            </Display>
            <Body style={[styles.body, slide.preferences && styles.bodyCompact]}>{slide.body}</Body>
            {slide.preferences && (
              <>
                <View style={styles.options} accessibilityRole="radiogroup">
                  {SOUND_OPTIONS.map(option => {
                    const selected = soundMode === option.id;
                    return (
                      <Pressable
                        key={option.id}
                        style={({ pressed }) => [
                          styles.optionCard,
                          selected && styles.optionCardSelected,
                          pressed && !selected && styles.pressed,
                        ]}
                        onPress={() => chooseSound(option.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${option.title} countdown. ${option.description}`}
                      >
                        <View style={styles.optionText}>
                          <Label style={[styles.optionTitle, selected && styles.onInkText]}>{option.title}</Label>
                          <Body style={[styles.optionDescription, selected && styles.onInkText]}>
                            {option.description}
                          </Body>
                        </View>
                        <View style={[styles.marker, selected && styles.markerSelected]} />
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.unitRow}>
                  <Label style={styles.unitLabel}>Weight unit</Label>
                  <View style={styles.unitOptions} accessibilityRole="radiogroup">
                    {UNIT_OPTIONS.map(option => {
                      const selected = weightUnit === option.id;
                      return (
                        <Pressable
                          key={option.id}
                          style={({ pressed }) => [
                            styles.unitButton,
                            selected && styles.unitButtonSelected,
                            pressed && !selected && styles.pressed,
                          ]}
                          onPress={() => chooseUnit(option.id)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          accessibilityLabel={`Weight unit ${option.title}`}
                        >
                          <Label style={[styles.unitButtonLabel, selected && styles.onInkText]}>{option.title}</Label>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <Body style={styles.note}>You can change these anytime in Settings.</Body>
              </>
            )}
          </ScrollView>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: space.block + insets.bottom }]}>
        <View style={styles.dots}>
          {SLIDES.map((slide, i) => (
            <View key={slide.title} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          onPress={isLast ? finish : () => goToSlide(index + 1)}
          accessibilityRole="button"
          accessibilityLabel={isLast ? 'Get started' : 'Next'}
        >
          <Display style={styles.ctaLabel}>{isLast ? 'Get started' : 'Next'}</Display>
        </Pressable>
      </View>
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
    height: band.control,
    paddingHorizontal: space.gutter,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skip: {
    minHeight: band.control,
    paddingHorizontal: space.row,
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: colors.rowPress,
  },
  skipLabel: {
    fontSize: label.small,
    color: colors.inkMuted,
    letterSpacing: tracking.wide,
  },
  pager: {
    flex: 1,
  },
  slide: {
    flexGrow: 1,
    paddingHorizontal: space.gutter,
    paddingVertical: space.block,
    justifyContent: 'center',
  },
  slideNumber: {
    fontSize: label.micro,
    color: colors.inkMuted,
    marginBottom: space.row,
  },
  title: {
    fontSize: 64,
    lineHeight: Math.round(64 * leading.display),
    letterSpacing: tracking.display,
  },
  body: {
    marginTop: space.block,
    fontSize: label.cue,
    lineHeight: label.cue * 1.5,
    color: colors.inkMuted,
  },
  // This slide carries interactive controls, so it is tightened to fit a small
  // phone without scrolling.
  slideCompact: {
    paddingVertical: space.tight,
  },
  titleCompact: {
    fontSize: 44,
    lineHeight: Math.round(44 * leading.display),
  },
  bodyCompact: {
    marginTop: space.tight,
  },
  options: {
    marginTop: space.row,
    gap: space.hair,
  },
  optionCard: {
    minHeight: band.control + space.tight,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    paddingHorizontal: space.row,
    paddingVertical: space.tight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.row,
  },
  optionCardSelected: {
    backgroundColor: colors.ink,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: label.base,
    letterSpacing: tracking.wide,
  },
  optionDescription: {
    fontSize: label.micro,
    lineHeight: label.micro * 1.4,
    color: colors.inkMuted,
  },
  onInkText: {
    color: colors.onInk,
  },
  // Square marker: hollow when unselected, an orange block when selected.
  marker: {
    width: 16,
    height: 16,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
  },
  markerSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  unitRow: {
    marginTop: space.row,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.row,
  },
  unitLabel: {
    fontSize: label.base,
    letterSpacing: tracking.wide,
  },
  unitOptions: {
    flexDirection: 'row',
    gap: space.hair,
  },
  unitButton: {
    minWidth: 76,
    minHeight: band.control,
    paddingHorizontal: space.row,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitButtonSelected: {
    backgroundColor: colors.ink,
  },
  unitButtonLabel: {
    fontSize: label.base,
    letterSpacing: tracking.wide,
  },
  note: {
    marginTop: space.tight,
    fontSize: label.micro,
    lineHeight: label.micro * 1.4,
    color: colors.inkMuted,
  },
  footer: {
    paddingHorizontal: space.gutter,
    paddingTop: space.block,
    gap: space.block,
    borderTopWidth: rule.heavy,
    borderTopColor: colors.ink,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.tight,
  },
  dot: {
    width: 10,
    height: 10,
    backgroundColor: colors.paper,
    borderWidth: rule.thin,
    borderColor: colors.ink,
  },
  dotActive: {
    width: 28,
    backgroundColor: colors.accent,
    borderColor: colors.ink,
  },
  cta: {
    height: band.cta,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: {
    backgroundColor: colors.inkPress,
  },
  ctaLabel: {
    color: colors.onInk,
    fontSize: display.cta,
    lineHeight: display.cta * leading.snug,
    letterSpacing: 0.6,
  },
});
