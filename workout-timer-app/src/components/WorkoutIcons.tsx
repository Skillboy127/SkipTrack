import React from 'react';
import { StyleSheet, View } from 'react-native';

type IconProps = {
  color?: string;
  size?: number;
};

/** Lightweight icons drawn from native views so they render consistently without an icon package. */
export function PencilIcon({ color = '#94A3B8', size = 20 }: IconProps) {
  const thickness = Math.max(2, Math.round(size * 0.16));

  return (
    <View style={[styles.pencil, { width: size, height: size }]} accessible={false}>
      <View style={[styles.pencilBody, { backgroundColor: color, height: thickness, borderRadius: thickness, width: size * 0.72 }]} />
      <View style={[styles.pencilTip, { borderTopWidth: thickness / 1.5, borderBottomWidth: thickness / 1.5, borderRightWidth: size * 0.2, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: color }]} />
    </View>
  );
}

export function TrashIcon({ color = '#475569', size = 18 }: IconProps) {
  const line = Math.max(1, Math.round(size * 0.1));

  return (
    <View style={[styles.trash, { width: size, height: size }]} accessible={false}>
      <View style={[styles.trashLid, { backgroundColor: color, height: line, width: size * 0.9 }]} />
      <View style={[styles.trashHandle, { backgroundColor: color, height: line, width: size * 0.36, top: size * 0.02 }]} />
      <View style={[styles.trashBin, { borderColor: color, borderWidth: line, borderTopWidth: 0, width: size * 0.68, height: size * 0.55, top: size * 0.32 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  pencil: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    transform: [{ rotate: '-45deg' }],
  },
  pencilBody: {},
  pencilTip: {},
  trash: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  trashLid: {
    position: 'absolute',
    top: '22%',
    borderRadius: 4,
  },
  trashHandle: {
    position: 'absolute',
    borderRadius: 4,
  },
  trashBin: {
    position: 'absolute',
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
});
