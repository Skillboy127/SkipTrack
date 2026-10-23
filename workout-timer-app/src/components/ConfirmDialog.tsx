import React, { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { Display, Body, Label } from './PosterText';
import { band, colors, display, label, leading, rule, space, tracking } from '../theme';

export type ConfirmDialogAction = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'destructive' | 'neutral';
};

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message?: string;
  actions: ConfirmDialogAction[];
  onRequestClose?: () => void;
};

/**
 * A centered, app-themed confirmation dialog — replaces the default OS Alert.alert
 * look. Also doubles as a plain action menu (e.g. for long-press) when `message`
 * is omitted.
 *
 * It is drawn as an overlay inside the screen rather than with React Native's
 * Modal. On Android a Modal builds a whole new native window each time it opens,
 * which is what made it appear a beat late; an in-tree overlay shows immediately.
 * It must therefore be rendered as the last child of a screen's root view.
 */
export function ConfirmDialog({ visible, title, message, actions, onRequestClose }: ConfirmDialogProps) {
  const [appear] = useState(() => new Animated.Value(0));
  const onRequestCloseRef = useRef(onRequestClose);
  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  });

  useEffect(() => {
    if (!visible) {
      appear.setValue(0);
      return;
    }
    Animated.timing(appear, { toValue: 1, duration: 120, useNativeDriver: true }).start();
    // The hardware back button closes the dialog instead of leaving the screen.
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestCloseRef.current?.();
      return true;
    });
    return () => subscription.remove();
  }, [visible, appear]);

  if (!visible) return null;

  const scale = appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });

  return (
    <Animated.View
      style={[styles.overlay, { opacity: appear }]}
      accessibilityViewIsModal
      importantForAccessibility="yes"
    >
      <Pressable style={styles.backdrop} onPress={onRequestClose}>
        <Animated.View style={[styles.cardWrap, { transform: [{ scale }] }]}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Display style={styles.title}>{title}</Display>
            {message ? <Body style={styles.message}>{message}</Body> : null}
            <View style={styles.actions}>
              {actions.map((action, index) => (
                <Pressable
                  key={index}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    action.variant === 'primary' && styles.actionBtnPrimary,
                    action.variant === 'destructive' && styles.actionBtnDestructive,
                    pressed && styles.actionBtnPressed,
                  ]}
                  onPress={action.onPress}
                  accessibilityRole="button"
                >
                  <Label
                    style={[
                      styles.actionText,
                      action.variant === 'primary' && styles.actionTextPrimary,
                      action.variant === 'destructive' && styles.actionTextDestructive,
                    ]}
                  >
                    {action.label}
                  </Label>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Sits above every other element on the screen, including elevated ones.
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    elevation: 1000,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(14, 14, 14, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 360,
  },
  card: {
    width: '100%',
    backgroundColor: colors.paper,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    paddingHorizontal: space.gutter,
    paddingTop: space.gutter,
    paddingBottom: space.block,
    gap: space.row,
  },
  title: {
    fontSize: display.cta,
    lineHeight: display.cta * leading.snug,
  },
  message: {
    fontSize: label.base,
    lineHeight: label.base * 1.5,
    color: colors.inkMuted,
  },
  actions: {
    gap: space.tight,
    marginTop: space.hair,
  },
  actionBtn: {
    // minHeight, not height, so a long label can wrap instead of being clipped.
    minHeight: band.actionHeight,
    paddingHorizontal: space.row,
    paddingVertical: space.hair,
    borderWidth: rule.heavy,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPrimary: {
    backgroundColor: colors.ink,
  },
  actionBtnDestructive: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  actionBtnPressed: {
    opacity: 0.75,
  },
  actionText: {
    color: colors.ink,
    fontSize: label.base,
    letterSpacing: tracking.wide,
    textAlign: 'center',
  },
  actionTextPrimary: {
    color: colors.onInk,
  },
  actionTextDestructive: {
    color: colors.onInk,
  },
});
