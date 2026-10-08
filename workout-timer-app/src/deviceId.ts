import { Platform } from 'react-native';

/**
 * The Android ID, used (hashed server-side) to tie the monthly import limit to a
 * device so it survives clearing app data and reinstalling. Android only.
 *
 * expo-application is loaded lazily inside a try/catch because it's a native
 * module: a build that doesn't include it would otherwise crash at launch the
 * moment this file is imported. Returns null when no ID is available.
 */
export function getDeviceId(): string | null {
  if (Platform.OS !== 'android') return null;
  try {
    const Application = require('expo-application') as typeof import('expo-application');
    const id = Application.getAndroidId();
    return id ? id : null;
  } catch {
    return null;
  }
}
