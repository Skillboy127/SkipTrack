// The web version's words and links (see platformCopy.ts for the Android app's).
// No photo import, no ads, no server: workouts come from the starters, the user's
// own AI, or the editor, and everything stays in this browser.

export type OnboardingSlide = {
  title: string;
  body: string;
  preferences?: boolean;
  starters?: boolean;
};

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    title: 'Welcome to Flex',
    body: 'Your workout companion.',
  },
  {
    title: 'Plan it with your AI',
    body: 'Ask ChatGPT, Claude or Gemini for a workout, then paste its answer into Import. Flex turns it into a timed routine you can start right away.',
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
    title: 'Private by design',
    body: 'No account, no ads, nothing collected: your workouts stay in this browser. To use Flex like an app, tap Share, then Add to Home Screen.',
    starters: true,
  },
];

export const LIBRARY_EMPTY_BODY = 'Start with a free starter workout, paste a plan from your own AI, or build your own.';
export const LIBRARY_IMPORT_LABEL = 'Import a workout from your own AI';
export const PRIVACY_POLICY_URL = '/privacy.html';
