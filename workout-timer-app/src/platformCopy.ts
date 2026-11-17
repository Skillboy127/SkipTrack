// Words and links that differ between the Android app and the web version. The web
// version's are in platformCopy.web.ts (no photo import, no ads, no server).

export type OnboardingSlide = {
  title: string;
  body: string;
  // Shows the countdown-sound and weight-unit pickers under the body text.
  preferences?: boolean;
  // Offers the built-in starter workouts under the body text.
  starters?: boolean;
};

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
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
    body: 'Flex is free to use and supported by ads. Free users get 7 imports each month. Building your own workouts and running sessions is always unlimited.',
    starters: true,
  },
];

export const LIBRARY_EMPTY_BODY = 'Start with a free starter workout, import one from a photo or text, or build your own.';
export const LIBRARY_IMPORT_LABEL = 'Import a workout from a photo or text';
export const PRIVACY_POLICY_URL = 'https://harshtalnikar.github.io/flex/privacy/';
