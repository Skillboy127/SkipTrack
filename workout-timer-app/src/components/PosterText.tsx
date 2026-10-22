import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { colors, font, tracking, DISPLAY_MAX_SCALE } from '../theme';

/**
 * Anton display text. Font scaling is capped because the poster layouts set
 * very tight leading and fixed-height bands.
 */
export function Display({ style, maxFontSizeMultiplier, ...rest }: TextProps) {
  return (
    <Text
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? DISPLAY_MAX_SCALE}
      style={[styles.display, style]}
      {...rest}
    />
  );
}

/** Archivo label text: uppercase, wide tracking, normal system font scaling. */
export function Label({ style, ...rest }: TextProps) {
  return <Text style={[styles.label, style]} {...rest} />;
}

/** Archivo body copy, for sentences rather than labels. */
export function Body({ style, ...rest }: TextProps) {
  return <Text style={[styles.body, style]} {...rest} />;
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
