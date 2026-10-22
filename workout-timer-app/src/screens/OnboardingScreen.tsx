import React, { useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, StatusBar, useWindowDimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../types';
import { saveHasSeenOnboarding } from '../storage';
import { Display, Label, Body } from '../components/PosterText';
import { band, colors, display, label, leading, rule, space, tracking } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

type Slide = {
  title: string;
  body: string;
  // Display-only info cards shown under the body text. Not tappable.
  options?: { title: string; description: string }[];
};

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
    body: 'Pick how Flex guides you. You can switch any time from Settings or the speaker icon during a workout.',
    options: [
      { title: 'Spoken', description: 'Counts down out loud and announces your next exercise.' },
      { title: 'Beep', description: 'A short beep for the countdown and phase changes.' },
      { title: 'Silent', description: 'No sound, just the visual timer.' },
    ],
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
            contentContainerStyle={styles.slide}
            showsVerticalScrollIndicator={false}
          >
            <Label style={styles.slideNumber}>
              {String(slideIndex + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
            </Label>
            <Display style={styles.title} numberOfLines={3} adjustsFontSizeToFit>{slide.title}</Display>
            <Body style={styles.body}>{slide.body}</Body>
            {slide.options && (
              <View style={styles.options}>
                {slide.options.map(option => (
                  <View key={option.title} style={styles.optionCard}>
                    <Label style={styles.optionTitle}>{option.title}</Label>
                    <Body style={styles.optionDescription}>{option.description}</Body>
                  </View>
                ))}
              </View>
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
  options: {
    marginTop: space.block,
    gap: space.tight,
  },
  optionCard: {
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    padding: space.row,
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
