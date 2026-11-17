// Web version of PosterText.tsx: the same three text styles, plus two fixes for
// where a browser lays text out differently from the app (Yoga):
//
// 1. Shrinking in columns. In the app a text never gets squeezed below its own
//    height in a column (Yoga's flexShrink defaults to 0). In a browser it can, and
//    a squeezed one-line heading is then clipped through its letters (seen on the
//    Import screen's "IMPORT"). Text in a column therefore doesn't shrink unless its
//    style says so; text in a row still can (that is how it wraps beside a button).
//
// 2. `adjustsFontSizeToFit`, which the app does natively but react-native-web
//    ignores, so the big headings (workout names, the timer) would be cut off on a
//    narrow iPhone. The text is measured in the page and its font size (and line
//    height and letter spacing) scaled down until it fits its lines.
//    Also, web only: a one-line label a few pixels too long (e.g. "Intermediate ·
//    No equipment · ~25 min" on an iPhone SE) shrinks up to 15% before it is cut
//    off with an ellipsis.
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Text, TextProps, StyleSheet, TextStyle } from 'react-native';
import { colors, font, tracking } from '../theme';

const LABEL_MIN_SCALE = 0.85;
// Sub-pixel rounding can still tip a fitted size over the edge; keep a little spare.
const SAFETY = 0.97;

type Props = TextProps & { baseStyle: TextStyle; fit: boolean };

/** Fix 1: in a column, don't shrink (as Yoga), unless the style asks for flex/flexShrink. */
function useNoShrinkInColumn(ref: React.MutableRefObject<HTMLElement | null>, flat: TextStyle) {
  const explicit = flat.flex !== undefined || flat.flexShrink !== undefined;
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent || explicit) return;
    if (getComputedStyle(parent).flexDirection.startsWith('column')) el.style.flexShrink = '0';
  }, [ref, explicit]);
}

// Width is strict: WebKit adds an ellipsis for even 1px of overflow. Height only
// matters for multi-line text, and only when a real line is hidden: the poster
// type's leading is deliberately tighter than its glyphs, so a line always pokes
// out a little, exactly as it does in the app.
function overflows(el: HTMLElement, lines: number | undefined, lineHeightPx: number): boolean {
  if (el.scrollWidth > el.clientWidth) return true;
  if (!lines || lines <= 1) return false;
  return el.scrollHeight > el.clientHeight + lineHeightPx * 0.5;
}

function PosterTextWeb({
  baseStyle,
  fit,
  style,
  minimumFontScale,
  adjustsFontSizeToFit: _a,
  maxFontSizeMultiplier: _m,
  ...rest
}: Props) {
  const ref = useRef<HTMLElement | null>(null);
  const flat = (StyleSheet.flatten([baseStyle, style]) ?? {}) as TextStyle;
  useNoShrinkInColumn(ref, flat);

  const fontSize = typeof flat.fontSize === 'number' ? flat.fontSize : 14;
  const lineHeight = typeof flat.lineHeight === 'number' ? flat.lineHeight : undefined;
  const letterSpacing = typeof flat.letterSpacing === 'number' ? flat.letterSpacing : undefined;
  const minScale = minimumFontScale && minimumFontScale > 0 ? minimumFontScale : 0.3;
  const lines = rest.numberOfLines;
  const [scale, setScale] = useState(1);

  const fitNow = useCallback(() => {
    const el = ref.current;
    if (!el || !fit) return;
    // Never break inside a word (react-native-web allows it): a word that is too
    // wide then overflows, which the check below sees, and the text shrinks instead.
    el.style.overflowWrap = 'normal';
    el.style.wordBreak = 'normal';
    const apply = (s: number) => {
      el.style.fontSize = `${fontSize * s}px`;
      if (lineHeight !== undefined) el.style.lineHeight = `${lineHeight * s}px`;
      if (letterSpacing !== undefined) el.style.letterSpacing = `${letterSpacing * s}px`;
    };
    const tooBig = (s: number) => overflows(el, lines, (lineHeight ?? fontSize * 1.2) * s);
    apply(1);
    if (!tooBig(1)) {
      setScale(1);
      return;
    }
    let lo = minScale;
    let hi = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      apply(mid);
      if (tooBig(mid)) hi = mid;
      else lo = mid;
    }
    const final = Math.max(minScale, lo * SAFETY);
    apply(final);
    setScale(final);
  }, [fit, fontSize, lineHeight, letterSpacing, minScale, lines]);

  useLayoutEffect(() => {
    fitNow();
  }, [fitNow, rest.children]);

  // Fit again when the room changes: the box or its parent is resized (rotation, a
  // row finishing its layout after this text), or the web fonts finish loading.
  // Only width changes count, so the text's own resizing can't loop.
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!fit || !el || !parent) return;
    let cancelled = false;
    const widths = () => `${el.clientWidth}:${parent.clientWidth}`;
    let last = widths();
    const refit = () => {
      if (cancelled) return;
      fitNow();
      last = widths();
    };
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (widths() !== last) refit();
      });
      observer.observe(el);
      observer.observe(parent);
    }
    document.fonts?.ready.then(refit).catch(() => {});
    const frame = requestAnimationFrame(refit);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [fit, fitNow]);

  const scaled: TextStyle | null =
    fit && scale !== 1
      ? {
          fontSize: fontSize * scale,
          ...(lineHeight !== undefined ? { lineHeight: lineHeight * scale } : null),
          ...(letterSpacing !== undefined ? { letterSpacing: letterSpacing * scale } : null),
        }
      : null;

  return <Text ref={ref as never} style={[baseStyle, style, scaled]} {...rest} />;
}

/** Anton display text. */
export function Display(props: TextProps) {
  return <PosterTextWeb baseStyle={styles.display} fit={!!props.adjustsFontSizeToFit} {...props} />;
}

/** Archivo label text: uppercase, wide tracking. */
export function Label(props: TextProps) {
  const oneLineFit = !props.adjustsFontSizeToFit && props.numberOfLines === 1;
  return (
    <PosterTextWeb
      baseStyle={styles.label}
      fit={!!props.adjustsFontSizeToFit || oneLineFit}
      {...props}
      minimumFontScale={oneLineFit ? LABEL_MIN_SCALE : props.minimumFontScale}
    />
  );
}

/** Archivo body copy, for sentences rather than labels. */
export function Body(props: TextProps) {
  return <PosterTextWeb baseStyle={styles.body} fit={!!props.adjustsFontSizeToFit} {...props} />;
}

const styles = StyleSheet.create({
  display: {
    fontFamily: font.display,
    color: colors.ink,
    textTransform: 'uppercase',
  },
  label: {
    fontFamily: font.black,
    color: colors.ink,
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
  },
  body: {
    fontFamily: font.medium,
    color: colors.ink,
  },
});
