# Poster redesign — notes

Branch: `poster-ui`. `main` is untouched and was never merged into.

Everything here implements the **Poster** direction (`Flex C Poster.dc.html`) and the
**Flex 2B** logo from the *Flex UI Reimagine* design project. The other three directions
and the other two logos were ignored.

All colour, type, spacing and rule values come from `workout-timer-app/src/theme.ts`.
No screen hardcodes a colour.

---

## 1. Decisions I made without you

### Palette additions
The Poster direction defines only paper, ink, accent, a row-press tint and an ad strip
tone. Three tokens were missing for a working app, so I added them:

| Token | Value | Why |
|---|---|---|
| `inkMuted` | `#5A554B` | Secondary text. 6.9:1 on paper, so it passes AA. |
| `placeholder` | `#7A7466` | Input placeholders. 4.8:1 on paper. |
| `danger` | `#B3261E` | Destructive actions (delete backdrop, delete buttons). The direction has no destructive colour, and accent orange is already the primary accent. |

`accentDeep` (`#C2390F`) is used only where accent-coloured text must sit on paper — in
practice just the "UP NEXT" label in the Up Next drawer. Plain `accent` on paper is
2.8:1 and fails AA, so it is never used as text on paper.

### Work vs rest (the design shows only the work state)
Work phases run on the **orange field with ink type** exactly as drawn. Rest **inverts to
an ink field with paper type**. The design never showed a rest screen, and an inverted
field means a glance tells you which state you are in without reading. Ink on orange is
5.9:1 and paper on ink is ~17:1, so both pass AA.

### Library row details
- The row numeral is **ink**, per your decision, not the accent used in the mock.
- The play square is **outlined on every row**. The mock fills the first row's square in
  orange, which reads as arbitrary once the list is dynamic and re-sorts.
- **Edit moved into the long-press menu** (Edit / Duplicate / Delete). The poster row has
  room for one trailing square and the design uses it for play. Nothing was lost — long
  press already existed for Duplicate and Delete.
- **Sort** became a small "Sort: Recent" toggle on the section line, because the design's
  filter bar has exactly three segments plus one square and no room for a fourth control.
- **Search** is the square in the filter bar; tapping it reveals a bordered field.

### Ad placement
The banner sits in **its own strip with heavy rules above and below plus 8px of internal
padding**, directly above the tab bar on Library and History, and above the footer on
Completion. It is never flush against a tappable control, which is what the AdMob
accidental-click policy is about. You asked for either "top of Library" or "a clear gap
and separator" — this is the second option, and it matches where the design puts the
strip. The banner still collapses to zero height when no ad loads, and Remove Ads still
hides it everywhere.

### Tab bar
Presentational only, over the existing stack navigator — no navigator was restructured.
Switching tabs uses `navigate`, never `push`, so returning to a screen already in the
stack pops back to it. Stack depth stays bounded at three. It respects the bottom
safe-area inset, which fixes the Android gesture bar overlapping the labels.

### Onboarding
Slides are now typographic — an `NN / NN` counter, an Anton headline, Archivo body —
rather than a centred icon in a circle. The circled icons were a leftover from the dark
UI and read as generic; the poster direction is built on type. All six slides, their
copy, the countdown option cards, Skip and the seen-once flag are unchanged.

### Other
- `expo-splash-screen` was installed to configure a splash (there was none). This is a
  **new native dependency**.
- The Android adaptive icon now uses a solid ink `backgroundColor` instead of the old
  pale `backgroundImage`. `assets/android-icon-background.png` is now unreferenced; I
  left the file in place rather than delete something you may want.
- `YouTubePlayIcon` was deleted — dead code since video import was removed, and the only
  remaining source of non-theme colour literals.
- Fonts are Anton + Archivo via `@expo-google-fonts/*`, loaded with `expo-font`. Nothing
  renders until they load, so there is no flash of system font.

---

## 2. Screens extrapolated (not in the design)

The Poster direction contains only Home, Active session and History. These six were
designed from its vocabulary — heavy 2.5px rules, square corners, Anton headlines,
uppercase Archivo labels:

**Workout preview** — Back and Edit squares, the workout name as hero, a meta line with
exercise count, rounds and estimated minutes. Numbered rows carry work/rest/sets in small
outlined chips, with a black START WORKOUT bar and an accent play square.

**Import** — Close square and a live IMPORTS LEFT chip, IMPORT hero, an IMAGE/TEXT
segmented bar. Either a heavy-ruled drop zone that previews the chosen photo, or a
bordered text area; a divider separates a "build it by hand" route to the editor.

**Import loading / error** — Loading centres the rotating dumbbell with the existing
rotating status lines and the source. Errors show an Anton title, the server's own
message, a black TRY AGAIN bar and the fall-back-to-text link.

**Editor** — Re-skinned in place rather than restructured, because density matters more
than drama here. Heavy rules, square steppers and an ink list header replace the dark
cards; the ADDING/EDITING tag sits in accent and the title is typed in Anton.

**Completion** — The orange field carries over from the finished session: a DONE hero,
the workout name, total time in a ruled block, and a stat row for exercises, rounds and
sets logged, above the expandable set-log cards.

**Settings** — Poster cards with square selection markers for countdown mode and weight
unit, Remove Ads with the store's localized price, and a new About card holding the
privacy policy link and app version.

---

## 3. Not finished / things to check

- **Nothing has been run on a device.** Every screen is verified only by TypeScript and a
  successful Android + iOS bundle export. Layout, type sizes and the 2m readability of the
  countdown need your eyes.
- **Auto-fitting headlines** (`adjustsFontSizeToFit`) behave slightly differently on
  Android and iOS. The Library hero, the session countdown and the exercise name all rely
  on it. Worth a look on a small screen.
- **Three-digit countdowns** (a 120s rest) shrink via auto-fit rather than wrapping. Looks
  right in theory; unverified in practice.
- **Privacy policy URL is a placeholder** (`https://example.com/flex-privacy`), clearly
  marked with a TODO in `SettingsScreen.tsx`. Swap it when a real policy exists.
- **Remove Ads still cannot complete a purchase** — the `remove_ads` product does not
  exist in Play Console yet. Unchanged by this work.
- **Lint**: 32 errors remain, all pre-existing (`main` has 38). They are
  `react-hooks/refs` and `react-hooks/set-state-in-effect` on long-standing patterns —
  PanResponder and Animated values held in refs, and load-on-focus effects that setState.
  Fixing them means restructuring logic, which this visual pass deliberately avoided. The
  problems the redesign itself introduced are fixed.
- **iOS** was not specifically targeted, but nothing here is Android-only. The iOS AdMob
  App ID is still Google's sample.

---

## 4. Native rebuild

Shipped by EAS update (no build needed): every screen, the theme, the fonts, the tab bar
and the in-app logo mark.

**Requires a native rebuild** — these are build inputs and cannot go out over an update:

- `assets/icon.png` — app icon
- `assets/android-icon-foreground.png`, `assets/android-icon-monochrome.png` and the
  adaptive icon's new ink `backgroundColor`
- `assets/splash-icon.png` plus the new `expo-splash-screen` plugin config in `app.json`
- the `expo-splash-screen` native module itself

I did **not** start a build. To run it:

```bash
cd workout-timer-app
npx eas-cli build --platform android --profile preview
```

Or locally, if you prefer:

```bash
cd workout-timer-app
npx expo run:android
```

To regenerate the icon set after editing `assets/flex-2b.svg`:

```bash
cd workout-timer-app
python tools/render_flex_logo.py
```

---

## 5. Logo

The design project had no `.svg` file, but `Flex Directions.dc.html` contains option 2b as
inline SVG markup. That geometry was copied verbatim into
`workout-timer-app/assets/flex-2b.svg` — the open stopwatch arc, the crown, the dumbbell
rotated −42° as the hand, and the accent pivot dot.

There is no SVG rasteriser on this machine, so `tools/render_flex_logo.py` redraws the
same geometry with Pillow and exports the PNGs, including `assets/flex-2b-1024.png`. The
SVG is the source of truth; rerun the script after changing it.
