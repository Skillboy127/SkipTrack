import * as Updates from 'expo-updates';

/**
 * True in dev builds and in builds on the "preview" EAS channel (what you install
 * for testing); false in a production build. Gates the debug tools in Settings so
 * they never appear for real users.
 */
export const IS_PREVIEW_BUILD = __DEV__ || Updates.channel === 'preview';
