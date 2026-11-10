// Kill switch for the background workout service (the lock-screen notification
// that keeps the timer and cues running with the screen off).
//
// JavaScript-only, so it can be flipped with an OTA update without a new build.
// When false, the app behaves as before this feature: the timer and cues run only
// while the app is open, and no notification permission is requested.
export const BACKGROUND_WORKOUT_SERVICE_ENABLED = true;

// The service stops itself after this long even if the workout hasn't ended (the
// native side caps it at 3 hours whatever this says). Long enough for any real
// session; short enough that a forgotten workout can't run the battery down.
export const BACKGROUND_SERVICE_MAX_HOURS = 3;
