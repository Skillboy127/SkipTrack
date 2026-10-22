import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
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

/** A centered, app-themed confirmation dialog — replaces the default OS Alert.alert look. Also doubles as a plain action menu (e.g. for long-press) when `message` is omitted. */
export function ConfirmDialog({ visible, title, message, actions, onRequestClose }: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <Pressable style={styles.backdrop} onPress={onRequestClose}>
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
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(14, 14, 14, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
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
    height: band.actionHeight,
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
  },
  actionTextPrimary: {
    color: colors.onInk,
  },
  actionTextDestructive: {
    color: colors.onInk,
  },
});
