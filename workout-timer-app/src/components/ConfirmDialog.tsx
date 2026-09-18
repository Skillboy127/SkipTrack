import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export type ConfirmDialogAction = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'destructive' | 'neutral';
};

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  actions: ConfirmDialogAction[];
  onRequestClose?: () => void;
};

/** A centered, app-themed confirmation dialog — replaces the default OS Alert.alert look. */
export function ConfirmDialog({ visible, title, message, actions, onRequestClose }: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <Pressable style={styles.backdrop} onPress={onRequestClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
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
              >
                <Text
                  style={[
                    styles.actionText,
                    action.variant === 'primary' && styles.actionTextPrimary,
                    action.variant === 'destructive' && styles.actionTextDestructive,
                  ]}
                >
                  {action.label}
                </Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1F1F24',
    backgroundColor: '#121214',
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 16,
    gap: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 12,
  },
  actions: {
    gap: 8,
  },
  actionBtn: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F1F24',
    backgroundColor: '#1A1A1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPrimary: {
    borderColor: '#CCFF00',
    backgroundColor: '#CCFF00',
  },
  actionBtnDestructive: {
    borderColor: 'rgba(248, 113, 113, 0.4)',
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
  },
  actionBtnPressed: {
    opacity: 0.75,
  },
  actionText: {
    color: '#94A3B8',
    fontSize: 15,
    fontWeight: '700',
  },
  actionTextPrimary: {
    color: '#09090A',
  },
  actionTextDestructive: {
    color: '#F87171',
  },
});
