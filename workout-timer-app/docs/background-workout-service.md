# Background workout service (Android)

Branch: `feature/background-workout-service`. Native change: needs a new build (version 1.0.1, versionCode 2).

## What it does

While a workout runs, an Android foreground service shows an ongoing notification (also on the lock screen) with the current exercise, a live countdown and Back / Pause–Resume / Next buttons. The service keeps the app's timer and audio cues working when the screen is off or another app is in front. Tapping the notification returns to the workout.

- Foreground service type: `mediaPlayback`.
- Kill switch: `BACKGROUND_WORKOUT_SERVICE_ENABLED` in `src/background/config.ts` (JS only, so an OTA update can turn it off).
- Hard maximum: 3 hours, enforced natively (`WorkoutForegroundService.HARD_MAX_DURATION_MS`). JS asks for `BACKGROUND_SERVICE_MAX_HOURS`; the native side clamps.
- Permissions added: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `POST_NOTIFICATIONS` (`WAKE_LOCK` was already present).

## Play Console declaration (Policy → App content → Foreground service permissions)

**Foreground service type:** Media playback (`FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK`)

**Use case (preset):** Media Playback — continue audio playback from the background.

**Describe the app functionality that uses this foreground service type:**

> Flex is an interval and set timer for workouts. When the user starts a workout they choose audio cues: a spoken countdown ("three, two, one", exercise names, "rest") or beeps. These cues are the core of the product: users put the phone down or in a pocket and follow the workout by ear. The foreground service starts only when the user taps Start on a workout and runs only until the workout ends or the user leaves it. It keeps the user-initiated audio cues playing on time while the screen is off or another app (for example a music player) is in front, and shows the current exercise, a live countdown and Pause/Next/Back controls in an ongoing notification. Audio is mixed with other apps' audio and never auto-plays: nothing plays unless the user started a workout with cues enabled. The service stops itself when the workout finishes, when the user quits, when the app is swiped away, and in any case after 3 hours.

**What is the user impact if the task is deferred or interrupted by the system?**

> The user would miss the countdown and the "go" cue for the next exercise or rest period, so they would hold an exercise too long or start the next one late. For a timed workout this defeats the purpose of the app: the user has to pick the phone up and unlock it to see where they are. If the service is restarted, the timer resumes from its stored deadlines, but cues that fell in the gap are lost.

**Video link:** (record per the script below and paste the unlisted YouTube link)

**If asked why not another type:** the service's function is uninterrupted playback of user-initiated audio cues. It does not read sensors or health data (so `health` would be inaccurate), and media playback is the type Android documents for "continue audio playback from the background".

## Demo video script (60–90 seconds, screen recording plus phone camera, with sound)

1. Open Flex on the Library screen. Say or caption: "Flex is a workout timer with spoken or beeped cues."
2. Open a workout with at least a 30 s timed exercise and a 20 s rest. Tap Start.
3. The first time only: the dialog "Follow along with the screen off?" appears ("Allow notifications to see your exercise and countdown on the lock screen, with pause and skip buttons."). Tap Allow, then Allow on the system prompt. Caption: "The notification permission is asked once, when the first workout starts."
4. Let the get-ready countdown finish; the spoken "three, two, one" and the go beep are audible.
5. Press the power button to lock the phone. Film the locked screen: the Flex notification shows the exercise name and the countdown ticking. Caption: "Screen off: the timer keeps running and the cues keep playing."
6. Wait for the end-of-exercise cues ("three, two, one", go beep, then "Rest") to play with the screen locked.
7. On the lock screen, tap Pause in the notification; the countdown stops and the button changes to Resume. Tap Resume. Tap Next; the next exercise appears.
8. Unlock the phone and open a music app; start a song. Switch back to Flex, then press Home. Caption: "Cues mix over your own music."
9. Tap the Flex notification: the workout screen opens at the right place.
10. Finish the workout or tap the X and Quit. Pull down the notification shade: the notification is gone. Caption: "The notification disappears the moment the workout ends."

## Manual test list (device, not emulator; Android 13+ for the permission prompt)

| # | Test | Expect |
|---|---|---|
| 1 | Start a workout, lock the phone before the first exercise ends | Cues play at the right time; notification shows name and live countdown; display is correct on unlock |
| 2 | Lock for a whole exercise + rest + next exercise | Every 3-2-1 and go cue plays; "Rest" and "Up next" spoken (voice mode); phase changes on time |
| 3 | Switch to another app for 2 minutes | Same as 1–2; tapping the notification returns to the exact state |
| 4 | Notification Pause, then Resume, from the lock screen | Timer pauses/resumes; chronometer stops and restarts; label flips Pause/Resume |
| 5 | Notification Next and Back | Phase changes; no cue plays for a manual skip (same as on-screen buttons) |
| 6 | Rep set (auto-advance off) | Notification shows "tap Done in the app", no countdown, no Pause button |
| 7 | Rep set with auto-advance | Countdown and Pause shown; ends with one go cue |
| 8 | First workout: tap "Not now", or "Allow" then deny the system prompt | Workout starts and runs normally (cues keep playing when locked); no notification in the shade; no crash; the explanation never shows again |
| 9 | After 8, enable notifications for Flex in system Settings and start another workout | Notification appears |
| 10 | Kill the app from Recents mid-workout | Notification disappears immediately; nothing left in the shade; no battery drain |
| 11 | Finish a workout; quit a workout | Notification gone in both cases |
| 12 | Music playing from another app, phone speaker | Cues audible over the music at normal volume; music does not pause |
| 13 | Same with wired earphones and with Bluetooth earbuds | Same; a small constant Bluetooth delay is normal |
| 14 | Sound mode Silent | Notification and timer still work; nothing audible |
| 15 | Kill switch: set `BACKGROUND_WORKOUT_SERVICE_ENABLED = false`, reload | No permission prompt, no notification, timer runs only while the app is open (old behaviour) |
| 16 | Max duration: temporarily set `BACKGROUND_SERVICE_MAX_HOURS = 2/60` (2 minutes), start a long workout, lock | After 2 min the notification disappears, the workout is paused, and reopening shows the "Workout paused" dialog |
| 17 | Doze: lock the phone and run `adb shell dumpsys deviceidle force-idle`, wait 2 min, `unforce` | Cues may be late during forced Doze (documented limit); the display is correct afterwards and the service is still running |
| 18 | Samsung/Xiaomi device if available | Repeat 1–3 with the app NOT in the "never sleeping" list |

## Known limits

- **Deep Doze** (phone unplugged, screen off and *stationary* for a while) ignores wake locks and defers the exact alarm. A phone moving in a pocket does not enter deep Doze; a phone left on a bench during a long rest can. Cues then arrive late, together, when the device wakes; the display and the phase are still correct.
- **Manufacturer app killers** (Huawei, Xiaomi, OnePlus, some Samsung settings) can stop foreground services. The service is `START_NOT_STICKY` and `stopWithTask`, so after such a kill the notification is gone and cues stop; the timer resumes from its deadlines when the app is reopened, and the service is started again automatically when the app comes back on screen.
- **Notification permission denied:** the service still runs and the timer and cues still work, but the notification is only visible in the system's Task Manager, so there are no lock-screen controls.
- **Android 12+ background-start rule:** the service can only be started while the app is on screen. It always is at workout start; an automatic restart after a system kill waits until the app is next in front.
- **Pause and the chronometer:** the notification's chronometer cannot pause, so while paused the notification shows a static "Paused · m:ss left".
- **iOS:** not covered by this change (the service is Android-only; the module is skipped elsewhere).
