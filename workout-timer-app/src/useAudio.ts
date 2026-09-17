import { useCallback, useEffect } from 'react';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';

// Require the asset directly. 
// We will create/download a beep.mp3 later.
const BEEP_ASSET = require('../assets/audio/beep.mp3');

export function useAudio() {
  const player = useAudioPlayer(BEEP_ASSET);

  useEffect(() => {
    async function configureAudio() {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          // Mix with others so background music (e.g. Spotify) isn't interrupted
          interruptionMode: 'mixWithOthers', 
        });
      } catch (e) {
        console.warn('Failed to configure audio mode', e);
      }
    }
    configureAudio();
  }, []);

  const playBeep = useCallback(() => {
    if (!player) return;
    (async () => {
      try {
        // Stop and rewind before replaying so rapid, back-to-back beeps
        // (e.g. the 3-2-1 countdown) don't race a still-playing instance
        // and get truncated or silently dropped.
        player.pause();
        await player.seekTo(0);
        player.play();
      } catch (e) {
        console.warn('Audio playback error silenced to prevent crash:', e);
      }
    })();
  }, [player]);

  return { playBeep };
}
