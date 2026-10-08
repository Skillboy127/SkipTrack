import { AppState } from 'react-native';

// TEMPORARY diagnostics for the screen-locked cue investigation. Read with:
//   adb logcat -s ReactNativeJS | findstr "[BG]"
// Delete this file and its callers once the background-cue bug is resolved.
export function bgLog(message: string) {
  console.log(`[BG] ${new Date().toISOString()} app=${AppState.currentState} ${message}`);
}
