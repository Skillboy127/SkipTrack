import { useCallback, useEffect } from 'react';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';

// Require the asset directly. 
// We will create/download a beep.mp3 later.
const BEEP_ASSET = require('../assets/audio/beep.mp3');

export function useAudio() {
  const player = useAudioPlayer(BEEP_ASSET);
  // A second, near-silent looping player. iOS (and Android's foreground
  // playback service) only keep the app alive in the background for as long
  // as audio is actively playing — brief, spaced-out beeps don't count as
  // "active" and the OS suspends the app between them once the screen locks.
  // Looping a near-silent track for the whole session keeps the audio route
  // continuously active so the countdown timer and beeps keep running.
  const keepAlivePlayer = useAudioPlayer(BEEP_ASSET);

  useEffect(() => {
    async function configureAudio() {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          // Duck (temporarily lower) other apps' audio instead of just mixing
          // at equal level, so the countdown beep actually cuts through
          // background music instead of getting buried under it.
          interruptionMode: 'duckOthers',
        });
      } catch (e) {
        console.warn('Failed to configure audio mode', e);
      }
    }
    configureAudio();
  }, []);

  useEffect(() => {
    if (!keepAlivePlayer) return;
    keepAlivePlayer.loop = true;
    keepAlivePlayer.volume = 0.01;
  }, [keepAlivePlayer]);

  const startBackgroundKeepAlive = useCallback(() => {
    if (!keepAlivePlayer) return;
    try {
      keepAlivePlayer.play();
    } catch (e) {
      console.warn('Failed to start background keep-alive audio:', e);
    }
  }, [keepAlivePlayer]);

  const stopBackgroundKeepAlive = useCallback(() => {
    if (!keepAlivePlayer) return;
    try {
      keepAlivePlayer.pause();
    } catch (e) {
      console.warn('Failed to stop background keep-alive audio:', e);
    }
  }, [keepAlivePlayer]);

  const playBeep = useCallback((options?: { highPitch?: boolean }) => {
    if (!player) return;
    (async () => {
      try {
        // Stop and rewind before replaying so rapid, back-to-back beeps
        // (e.g. the 3-2-1 countdown) don't race a still-playing instance
        // and get truncated or silently dropped.
        player.pause();
        await player.seekTo(0);
        player.volume = 1.0;
        // The "start of a new exercise" cue reuses the same beep sample but
        // played back faster without pitch correction, which raises its
        // pitch — giving a distinct higher "go" note without a new asset.
        player.shouldCorrectPitch = !options?.highPitch;
        player.playbackRate = options?.highPitch ? 1.6 : 1.0;
        player.play();
      } catch (e) {
        console.warn('Audio playback error silenced to prevent crash:', e);
      }
    })();
  }, [player]);

  return { playBeep, startBackgroundKeepAlive, stopBackgroundKeepAlive };
}
