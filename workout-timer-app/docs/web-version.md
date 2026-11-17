# Flex on the web (iPhone Safari)

A private web version of Flex, built from the same code as the Android app with an
Expo web export (react-native-web). No accounts, ads, purchases or server calls;
workouts and settings are stored in the browser (localStorage).

## How it is put together

- Web-only files sit next to the app's own and replace them only in the web build
  (Metro picks `name.web.ts(x)` over `name.ts(x)` for web; Android never sees them):
  `App.web.tsx`, `ImportScreen.web.tsx` ("Use your own AI" only), `PosterText.web.tsx`,
  and stand-ins for ads, billing, the server API, usage, build info, the background
  service, the native cue sounds and speech.
- `src/web/`: the Web Audio engine, screen wake lock, on-screen notices, the
  Home Screen hint, and a stub for the ads SDK (wired in by `metro.config.js`, web only).
- `public/`: the HTML template (Apple home-screen tags, viewport, safe area), the web
  app manifest, icons made from `assets/icon.png`, and `privacy.html`.
- Shared files changed (no behaviour change on Android): `src/platformCopy.ts` holds
  the words/links that differ (onboarding slides, the Library's empty-state line, the
  privacy link), and `theme.ts` sets the status-bar band to 0 on web only.

## Vercel

| Setting | Value |
| --- | --- |
| Framework Preset | Other |
| Root Directory | `workout-timer-app` |
| Install Command | `npm install` (default) |
| Build Command | `npx expo export --platform web --output-dir dist-web` |
| Output Directory | `dist-web` |
| Environment variables | none |

HTTPS is on by default on Vercel; the screen wake lock and the clipboard need it.
Local preview: `npx expo export --platform web --output-dir dist-web`, then serve
`dist-web` (e.g. `npx serve dist-web`).

## Audio on iPhone

- The first tap anywhere unlocks audio (iOS requires a tap before any sound).
- Beeps, and the "3, 2, 1, go" clip in Beep mode, are scheduled on the AudioContext
  clock, so they are exactly 1 s apart.
- The ringer switch: iOS mutes web audio when it's on silent. Flex sets the page's
  audio session to "playback" (iOS 17+) and plays a silent looping audio element
  from the first tap (older iOS), which makes the beeps play regardless.
  To check: flip the switch to silent (orange showing), open Flex, tap once, start a
  workout in Beep mode. You should hear the countdown. If not, check the volume
  buttons (media volume, not ringer volume) and try again after one more tap.
- Spoken countdown uses the browser's speech. If the browser has none, the
  countdown beeps instead.

## Known limits

- Locking the phone or switching apps pauses the sounds (a web page can't run in the
  background on iPhone). The timer itself is deadline-based and is correct when you
  come back; passed beeps are skipped, not played late.
- The screen stays on with the Screen Wake Lock API (iOS 16.4+). In a Home Screen
  app it only works from iOS 18.4. If it doesn't, Flex shows a hint to set
  Auto-Lock to Never while training.
- Data lives only in this browser on this phone. Safari's "Clear History and Website
  Data", or deleting the Home Screen app, deletes it; Safari can also clear storage of
  sites not used for 7 days unless the site is added to the Home Screen.

## iPhone test checklist

1. Open the link in Safari. Flex loads with the paper background; onboarding shows
   "Welcome to Flex". Swipe or tap Next through all six slides: no text cut off; slide 2
   is "Plan it with your AI", slide 6 "Private by design".
2. On slide 6 tap "Beginner Full-Body": its preview opens.
3. Go back to the Library: after a moment a box explains Add to Home Screen. Tap Got it.
4. Add to Home Screen: Share → Add to Home Screen → Add. The icon is the Flex stopwatch.
   Open Flex from the icon: it opens full screen, without Safari's bars.
5. Settings: choose Beep. Flip the ringer switch to silent. Start "Core & Mobility".
   - A note says to keep the screen on.
   - The get-ready "3, 2, 1, go" plays, evenly spaced.
   - Wait through one exercise: the countdown beeps play at 3, 2, 1 and a higher beep
     at the change.
   - Don't touch the phone for 2+ minutes: the screen should stay on.
6. Lock the phone for ~20 s mid-exercise, unlock: the timer shows the right time left
   (it kept counting), and the next countdown beeps again.
7. Switch to another app for ~20 s and back: same as 6.
8. Settings: choose Spoken. Start a workout: "three, two, one" is spoken.
9. A rep exercise (Beginner Full-Body, after the warm-up): tap Done to move on. Turn on
   auto-advance in Settings and check a rep set moves on by itself.
10. Pause, Back, Skip and the ±5s rest buttons work.
11. Finish or quit a workout; it appears under History.
12. Edit a copy of a starter workout, rename it, save: it appears in the Library.
    Close Flex completely, open it again: it is still there.
13. Import → Copy prompt; paste into ChatGPT/Claude/Gemini with a request; copy the
    answer back into Flex and tap Review workout: the editor opens with the exercises.
    Paste random text instead: a clear message explains the format.
14. Settings → Privacy policy: the privacy page opens and says nothing is collected.
15. Turn the phone sideways and back: nothing breaks (Flex is designed for portrait).
