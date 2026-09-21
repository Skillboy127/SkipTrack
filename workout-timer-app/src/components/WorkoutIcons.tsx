import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

type IconProps = {
  color?: string;
  size?: number;
};

type DirectionalIconProps = IconProps & {
  direction?: 'left' | 'right' | 'up' | 'down';
};

/** Lightweight icons drawn from native views so they render consistently without an icon package. */
export function PencilIcon({ color = '#94A3B8', size = 20 }: IconProps) {
  const thickness = Math.max(3, Math.round(size * 0.22));
  const bodyLength = size * 0.6;

  return (
    <View style={[styles.iconBox, { width: size, height: size }]} accessible={false}>
      <View style={styles.pencilRotate}>
        <View
          style={{
            width: thickness * 0.78,
            height: thickness * 0.78,
            backgroundColor: color,
            borderRadius: 1.5,
            marginBottom: -thickness * 0.18,
            transform: [{ rotate: '45deg' }],
          }}
        />
        <View style={{ width: thickness, height: bodyLength, backgroundColor: color, borderRadius: thickness * 0.3 }} />
        <View
          style={{
            width: thickness,
            height: thickness * 0.55,
            backgroundColor: color,
            opacity: 0.55,
            borderBottomLeftRadius: thickness * 0.3,
            borderBottomRightRadius: thickness * 0.3,
          }}
        />
      </View>
    </View>
  );
}

export function TrashIcon({ color = '#475569', size = 18 }: IconProps) {
  const line = Math.max(1.3, Math.round(size * 0.09));

  return (
    <View style={[styles.trash, { width: size, height: size }]} accessible={false}>
      <View style={[styles.trashLid, { backgroundColor: color, height: line, width: size * 0.92, borderRadius: line / 2 }]} />
      <View style={[styles.trashHandle, { borderColor: color, borderWidth: line, width: size * 0.34, height: size * 0.22, top: -size * 0.03 }]} />
      <View style={[styles.trashBin, { borderColor: color, borderWidth: line, width: size * 0.66, height: size * 0.56, top: size * 0.34 }]}>
        <View style={{ width: line, height: '58%', backgroundColor: color, opacity: 0.6, borderRadius: line / 2 }} />
        <View style={{ width: line, height: '58%', backgroundColor: color, opacity: 0.6, borderRadius: line / 2 }} />
      </View>
    </View>
  );
}

export function DumbbellIcon({ color = '#94A3B8', size = 16 }: IconProps) {
  const barThickness = Math.max(2, Math.round(size * 0.18));
  const plateWidth = Math.max(2, Math.round(size * 0.2));

  return (
    <View style={[styles.dumbbell, { width: size, height: size }]} accessible={false}>
      <View style={[styles.dumbbellBar, { height: barThickness, borderRadius: barThickness / 2, backgroundColor: color, width: size * 0.56 }]} />
      <View style={[styles.dumbbellPlate, { left: 0, width: plateWidth, height: size * 0.72, borderColor: color, borderWidth: barThickness }]} />
      <View style={[styles.dumbbellPlate, { right: 0, width: plateWidth, height: size * 0.72, borderColor: color, borderWidth: barThickness }]} />
    </View>
  );
}

/** A checkmark drawn from a rotated corner box — crisp at any size, no font-glyph misalignment. */
export function CheckIcon({ color = '#09090A', size = 20 }: IconProps) {
  const thickness = Math.max(2, Math.round(size * 0.14));

  return (
    <View style={[styles.iconBox, { width: size, height: size }]} accessible={false}>
      <View
        style={{
          width: size * 0.46,
          height: size * 0.82,
          marginTop: -size * 0.08,
          borderBottomWidth: thickness,
          borderRightWidth: thickness,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

/** A "sliders" glyph (three tracks with offset knobs) used for the Settings entry point. */
export function SettingsIcon({ color = '#94A3B8', size = 18 }: IconProps) {
  const lineHeight = Math.max(1.4, size * 0.1);
  const knobSize = size * 0.26;
  const knobPositions = [0.12, 0.5, 0.28];

  return (
    <View style={[styles.iconBox, { width: size, height: size, justifyContent: 'space-between' }]} accessible={false}>
      {knobPositions.map((position, index) => (
        <View key={index} style={{ width: size, height: knobSize, justifyContent: 'center' }}>
          <View style={{ height: lineHeight, backgroundColor: color, opacity: 0.45, borderRadius: lineHeight / 2 }} />
          <View
            style={{
              position: 'absolute',
              left: size * position,
              width: knobSize,
              height: knobSize,
              borderRadius: knobSize / 2,
              backgroundColor: color,
            }}
          />
        </View>
      ))}
    </View>
  );
}

export function SearchIcon({ color = '#94A3B8', size = 18 }: IconProps) {
  const ringSize = size * 0.66;
  const border = Math.max(1.4, size * 0.12);
  const handleLength = size * 0.36;

  return (
    <View style={[styles.iconBox, { width: size, height: size }]} accessible={false}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: border,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: border,
          height: handleLength,
          borderRadius: border / 2,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  );
}

export function CloseIcon({ color = '#94A3B8', size = 18 }: IconProps) {
  const thickness = Math.max(2, Math.round(size * 0.12));
  const barLength = size * 0.72;

  return (
    <View style={[styles.iconBox, { width: size, height: size }]} accessible={false}>
      <View style={{ position: 'absolute', width: barLength, height: thickness, backgroundColor: color, borderRadius: thickness / 2, transform: [{ rotate: '45deg' }] }} />
      <View style={{ position: 'absolute', width: barLength, height: thickness, backgroundColor: color, borderRadius: thickness / 2, transform: [{ rotate: '-45deg' }] }} />
    </View>
  );
}

const CHEVRON_ROTATION: Record<NonNullable<DirectionalIconProps['direction']>, string> = {
  right: '45deg',
  left: '225deg',
  up: '-45deg',
  down: '135deg',
};

/** A corner-box chevron/caret. Also doubles as a disclosure arrow via direction="up"/"down". */
export function ChevronIcon({ color = '#94A3B8', size = 16, direction = 'right' }: DirectionalIconProps) {
  const thickness = Math.max(1.4, Math.round(size * 0.16));

  return (
    <View style={[styles.iconBox, { width: size, height: size }]} accessible={false}>
      <View
        style={{
          width: size * 0.46,
          height: size * 0.46,
          borderTopWidth: thickness,
          borderRightWidth: thickness,
          borderColor: color,
          transform: [{ rotate: CHEVRON_ROTATION[direction] }],
        }}
      />
    </View>
  );
}

export function PlayIcon({ color = '#09090A', size = 20 }: IconProps) {
  const triangleHeight = size * 0.62;

  return (
    <View style={[styles.iconBox, { width: size, height: size }]} accessible={false}>
      <View
        style={{
          width: 0,
          height: 0,
          marginLeft: size * 0.08,
          borderTopWidth: triangleHeight / 2,
          borderBottomWidth: triangleHeight / 2,
          borderLeftWidth: triangleHeight * 0.82,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: color,
        }}
      />
    </View>
  );
}

/**
 * Speaker/countdown-sound glyph. Hand-drawn border-trick shapes couldn't reliably
 * reproduce a real speaker cone at icon sizes (subpixel seams, wrong proportions), so
 * this uses Expo's bundled Ionicons font instead — it ships inside Expo Go already, no
 * native rebuild needed.
 */
export function SpeakerIcon({ color = '#94A3B8', size = 22, muted = false }: IconProps & { muted?: boolean }) {
  return (
    <View style={[styles.iconBox, { width: size, height: size }]} accessible={false}>
      <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={size} color={color} />
    </View>
  );
}

/** Two overlapping outlined squares — a "duplicate/copy" glyph. */
export function CopyIcon({ color = '#94A3B8', size = 18 }: IconProps) {
  const rectSize = size * 0.64;
  const border = Math.max(1.2, size * 0.09);

  return (
    <View style={[styles.iconBox, { width: size, height: size }]} accessible={false}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: rectSize,
          height: rectSize,
          borderWidth: border,
          borderColor: color,
          borderRadius: 3,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: rectSize,
          height: rectSize,
          borderWidth: border,
          borderColor: color,
          borderRadius: 3,
        }}
      />
    </View>
  );
}

export function PauseIcon({ color = '#09090A', size = 20 }: IconProps) {
  const barWidth = Math.max(2, size * 0.16);
  const barHeight = size * 0.58;

  return (
    <View style={[styles.iconBox, styles.pauseRow, { width: size, height: size, gap: size * 0.16 }]} accessible={false}>
      <View style={{ width: barWidth, height: barHeight, backgroundColor: color, borderRadius: barWidth / 2 }} />
      <View style={{ width: barWidth, height: barHeight, backgroundColor: color, borderRadius: barWidth / 2 }} />
    </View>
  );
}

/** A triangle-plus-bar "skip to next/previous" glyph, matching standard media-control iconography. */
export function SkipIcon({ color = '#FFFFFF', size = 18, direction = 'right' }: DirectionalIconProps) {
  const triangleHeight = size * 0.56;
  const barWidth = Math.max(1.6, size * 0.12);
  const isForward = direction !== 'left';

  const triangle = (
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: triangleHeight / 2,
        borderBottomWidth: triangleHeight / 2,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        ...(isForward
          ? { borderLeftWidth: triangleHeight * 0.82, borderLeftColor: color }
          : { borderRightWidth: triangleHeight * 0.82, borderRightColor: color }),
      }}
    />
  );
  const bar = <View style={{ width: barWidth, height: triangleHeight, backgroundColor: color, borderRadius: barWidth / 2 }} />;

  return (
    <View style={[styles.iconBox, styles.pauseRow, { width: size, height: size, gap: size * 0.1 }]} accessible={false}>
      {isForward ? (
        <>
          {triangle}
          {bar}
        </>
      ) : (
        <>
          {bar}
          {triangle}
        </>
      )}
    </View>
  );
}

export function ClockIcon({ color = '#94A3B8', size = 16 }: IconProps) {
  const border = Math.max(1.2, size * 0.1);
  const handThickness = Math.max(1, size * 0.09);

  return (
    <View
      style={[
        styles.iconBox,
        { width: size, height: size, borderRadius: size / 2, borderWidth: border, borderColor: color },
      ]}
      accessible={false}
    >
      <View style={{ position: 'absolute', width: handThickness, height: size * 0.3, backgroundColor: color, borderRadius: handThickness / 2, bottom: '50%' }} />
      <View style={{ position: 'absolute', height: handThickness, width: size * 0.24, backgroundColor: color, borderRadius: handThickness / 2, left: '50%' }} />
    </View>
  );
}

export function DragHandleIcon({ color = '#475569', size = 18 }: IconProps) {
  const barHeight = Math.max(1.4, size * 0.1);
  const barWidth = size * 0.6;

  return (
    <View style={[styles.iconBox, { width: size, height: size, gap: barHeight * 1.4 }]} accessible={false}>
      <View style={{ width: barWidth, height: barHeight, backgroundColor: color, borderRadius: barHeight / 2 }} />
      <View style={{ width: barWidth, height: barHeight, backgroundColor: color, borderRadius: barHeight / 2 }} />
      <View style={{ width: barWidth, height: barHeight, backgroundColor: color, borderRadius: barHeight / 2 }} />
    </View>
  );
}

export function LockIcon({ color = '#475569', size = 14 }: IconProps) {
  const bodyWidth = size * 0.72;
  const bodyHeight = size * 0.48;
  const shackleSize = size * 0.5;
  const shackleThickness = Math.max(1.2, size * 0.14);

  return (
    <View style={[styles.iconBox, { width: size, height: size }]} accessible={false}>
      <View
        style={{
          width: shackleSize,
          height: shackleSize,
          borderRadius: shackleSize / 2,
          borderWidth: shackleThickness,
          borderColor: color,
          borderBottomWidth: 0,
          marginBottom: -shackleSize * 0.26,
        }}
      />
      <View style={{ width: bodyWidth, height: bodyHeight, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

export function InfoIcon({ color = '#CCFF00', size = 16 }: IconProps) {
  const border = Math.max(1, size * 0.09);
  const dotSize = Math.max(1.6, size * 0.13);

  return (
    <View
      style={[
        styles.iconBox,
        { width: size, height: size, borderRadius: size / 2, borderWidth: border, borderColor: color, gap: size * 0.08 },
      ]}
      accessible={false}
    >
      <View style={{ width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: color }} />
      <View style={{ width: dotSize, height: size * 0.3, borderRadius: dotSize / 2, backgroundColor: color }} />
    </View>
  );
}

/** A shaft + arrowhead + tray, matching the "import/download" affordance used across the library screen. */
export function DownloadIcon({ color = '#09090A', size = 18 }: IconProps) {
  const shaftWidth = Math.max(1.6, size * 0.14);

  return (
    <View style={[styles.iconBox, { width: size, height: size }]} accessible={false}>
      <View style={{ width: shaftWidth, height: size * 0.46, backgroundColor: color, borderRadius: shaftWidth / 2, marginBottom: -size * 0.06 }} />
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.17,
          borderRightWidth: size * 0.17,
          borderTopWidth: size * 0.17,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
        }}
      />
      <View style={{ position: 'absolute', bottom: 0, width: size * 0.72, height: Math.max(1.4, size * 0.12), borderRadius: 2, backgroundColor: color }} />
    </View>
  );
}

export function PlusIcon({ color = '#09090A', size = 24 }: IconProps) {
  const thickness = Math.max(2, size * 0.12);

  return (
    <View style={[styles.iconBox, { width: size, height: size }]} accessible={false}>
      <View style={{ position: 'absolute', width: size * 0.68, height: thickness, backgroundColor: color, borderRadius: thickness / 2 }} />
      <View style={{ position: 'absolute', width: thickness, height: size * 0.68, backgroundColor: color, borderRadius: thickness / 2 }} />
    </View>
  );
}

export function CameraIcon({ color = '#CCFF00', size = 20 }: IconProps) {
  const border = Math.max(1.4, size * 0.09);

  return (
    <View
      style={[
        styles.iconBox,
        { width: size, height: size * 0.78, borderRadius: size * 0.16, borderWidth: border, borderColor: color },
      ]}
      accessible={false}
    >
      <View
        style={{
          position: 'absolute',
          top: -size * 0.14,
          left: size * 0.2,
          width: size * 0.3,
          height: size * 0.16,
          borderTopLeftRadius: 3,
          borderTopRightRadius: 3,
          backgroundColor: color,
        }}
      />
      <View style={{ width: size * 0.34, height: size * 0.34, borderRadius: size * 0.17, borderWidth: border, borderColor: color }} />
    </View>
  );
}

/** A branded YouTube "play" glyph (rounded red rect + white triangle) for the video-import affordances. */
export function YouTubePlayIcon({ size = 22 }: { size?: number }) {
  const triangleHeight = size * 0.42;

  return (
    <View
      style={{
        width: size,
        height: size * 0.72,
        borderRadius: size * 0.2,
        backgroundColor: '#FF0000',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessible={false}
    >
      <View
        style={{
          width: 0,
          height: 0,
          marginLeft: size * 0.05,
          borderTopWidth: triangleHeight / 2,
          borderBottomWidth: triangleHeight / 2,
          borderLeftWidth: triangleHeight * 0.85,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: '#FFFFFF',
        }}
      />
    </View>
  );
}

/** A continuously spinning dumbbell used as the app's shared loading indicator. */
export function RotatingDumbbellIcon({ color = '#CCFF00', size = 48 }: IconProps) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <DumbbellIcon color={color} size={size} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  iconBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseRow: {
    flexDirection: 'row',
  },
  pencilRotate: {
    alignItems: 'center',
    transform: [{ rotate: '45deg' }],
  },
  trash: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  trashLid: {
    position: 'absolute',
    top: '22%',
  },
  trashHandle: {
    position: 'absolute',
    borderRadius: 4,
  },
  trashBin: {
    position: 'absolute',
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  dumbbell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dumbbellBar: {},
  dumbbellPlate: {
    position: 'absolute',
    borderRadius: 3,
  },
});
