import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, useWindowDimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { saveHasSeenOnboarding } from '../storage';
import { CameraIcon, SpeakerIcon, PencilIcon, CheckIcon, DumbbellIcon } from '../components/WorkoutIcons';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

type Slide = {
  title: string;
  body: string;
  icon: React.ReactNode;
};

const SLIDES: Slide[] = [
  {
    title: 'Welcome to Flex',
    body: 'Your workout companion.',
    icon: <DumbbellIcon color="#CCFF00" size={36} />,
  },
  {
    title: 'Import Any Workout',
    body: 'Snap a photo of a workout plan or card, or paste the exercises as text. Flex turns it into a timed routine you can start right away.',
    icon: <CameraIcon color="#CCFF00" size={36} />,
  },
  {
    title: 'Follow Along Hands-Free',
    body: 'Spoken countdowns and exercise announcements tell you what\'s next, so you can keep your eyes on the workout instead of your phone.',
    icon: <SpeakerIcon color="#CCFF00" size={36} />,
  },
  {
    title: 'Adjust On The Fly',
    body: 'Edit any exercise, and drag its handle to reorder. During a rest, nudge the timer up or down by 5 seconds.',
    icon: <PencilIcon color="#6B9EFA" size={36} />,
  },
  {
    title: "You're All Set",
    body: 'Build your first workout, import one, or start from a saved routine. Your progress and history will be right here.',
    icon: <CheckIcon color="#CCFF00" size={36} />,
  },
];

export function OnboardingScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
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
      <StatusBar barStyle="light-content" backgroundColor="#0B0B0B" />
      <View style={styles.statusBarSpacer} />

      <View style={styles.topBar}>
        {!isLast ? (
          <TouchableOpacity onPress={finish} hitSlop={12} accessibilityLabel="Skip introduction">
            <Text style={styles.skipLabel}>Skip</Text>
          </TouchableOpacity>
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
        {SLIDES.map(slide => (
          <View key={slide.title} style={[styles.slide, { width }]}>
            <View style={styles.card}>
              <View style={styles.iconCircle}>{slide.icon}</View>
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.body}>{slide.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((slide, i) => (
            <View key={slide.title} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={isLast ? finish : () => goToSlide(index + 1)}
          accessibilityLabel={isLast ? 'Get started' : 'Next'}
        >
          <Text style={styles.primaryLabel}>{isLast ? 'Get Started' : 'Next'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0B0B',
  },
  statusBarSpacer: {
    height: 44,
  },
  topBar: {
    height: 44,
    paddingHorizontal: 20,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skipLabel: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  pager: {
    flex: 1,
  },
  slide: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  card: {
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 16,
    backgroundColor: '#121214',
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 32,
    alignItems: 'center',
    gap: 16,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1,
    borderColor: '#1F1F24',
    backgroundColor: '#09090A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#FFFFFF',
    fontFamily: 'Geist',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 31,
    textAlign: 'center',
  },
  body: {
    color: '#94A3B8',
    fontFamily: 'Geist',
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 23,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 16,
    gap: 24,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1F1F24',
  },
  dotActive: {
    width: 24,
    backgroundColor: '#CCFF00',
  },
  primaryButton: {
    height: 54,
    borderRadius: 12,
    backgroundColor: '#CCFF00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    color: '#09090A',
    fontFamily: 'Geist',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
  },
});
