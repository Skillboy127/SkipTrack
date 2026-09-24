import { useCallback, useEffect } from 'react';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';

// A full-amplitude 1kHz tone, generated at full scale so it's as loud as the
// device volume allows — not dependent on ducking other apps, which only
// helps when something else happens to be playing.
const BEEP_ASSET = require('../assets/audio/beep-loud.wav');
// A distinct, higher-pitched (1.6kHz) full-amplitude tone for the "start of a
// new exercise" cue — a dedicated asset rather than pitch-shifting the beep
// at runtime, since that relies on native playbackRate/pitch-correction
// support that isn't guaranteed to do anything audible on every device.
const GO_BEEP_ASSET = require('../assets/audio/go-beep.wav');
// A 1-second track of true digital silence (all-zero PCM samples), used only
// to keep the audio route active in the background — see keepAlivePlayer below.
const SILENCE_ASSET = require('../assets/audio/silence.wav');

export function useAudio() {
  const player = useAudioPlayer(BEEP_ASSET);
  const goBeepPlayer = useAudioPlayer(GO_BEEP_ASSET);
  // A third, silent looping player. iOS (and Android's foreground playback
  // service) only keep the app alive in the background for as long as audio
  // is actively playing — brief, spaced-out beeps don't count as "active"
  // and the OS suspends the app between them once the screen locks. Looping
  // real silence (not a quiet beep — that's still audibly rhythmic) keeps
  // the audio route continuously active so the countdown timer and beeps
  // keep running without the user hearing anything extra.
  const keepAlivePlayer = useAudioPlayer(SILENCE_ASSET);

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

  const playFrom = (source: ReturnType<typeof useAudioPlayer>) => {
    if (!source) return;
    (async () => {
      try {
        // Stop and rewind before replaying so rapid, back-to-back beeps
        // (e.g. the 3-2-1 countdown) don't race a still-playing instance
        // and get truncated or silently dropped.
        source.pause();
        await source.seekTo(0);
        source.volume = 1.0;
        source.play();
      } catch (e) {
        console.warn('Audio playback error silenced to prevent crash:', e);
      }
    })();
  };

  const playBeep = useCallback(() => playFrom(player), [player]);
  const playGoBeep = useCallback(() => playFrom(goBeepPlayer), [goBeepPlayer]);

  return { playBeep, playGoBeep, startBackgroundKeepAlive, stopBackgroundKeepAlive };
}
