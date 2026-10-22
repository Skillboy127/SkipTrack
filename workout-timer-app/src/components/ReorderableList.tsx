/* eslint-disable react-hooks/refs --
   This file is built around refs and imperative gesture handlers: they are only
   read from touch events, timers and layout effects, never to compute what renders. */
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  GestureResponderEvent,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme';

/** How long a finger must rest on a grab zone before the row lifts. */
const LONG_PRESS_MS = 220;
/** Moving further than this before the press is held means "scroll", not "grab". */
const MOVE_CANCEL_PX = 8;
/** Distance from the viewport edge at which dragging starts auto-scrolling. */
const EDGE_ZONE = 90;
const MAX_SCROLL_PER_TICK = 20;

const SPRING = { stiffness: 320, damping: 30, mass: 0.9 } as const;

function useReorderScrollState() {
  const scrollViewRef = useRef<ScrollView>(null);
  const viewportRef = useRef<View>(null);
  const offset = useRef(0);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const [dragging, setDragging] = useState(false);

  const scrollProps = {
    ref: scrollViewRef,
    scrollEnabled: !dragging,
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = e.nativeEvent.contentOffset.y;
    },
    onContentSizeChange: (_w: number, h: number) => {
      contentHeight.current = h;
    },
    onLayout: (e: LayoutChangeEvent) => {
      viewportHeight.current = e.nativeEvent.layout.height;
    },
  };

  return { scrollViewRef, viewportRef, offset, contentHeight, viewportHeight, setDragging, scrollProps };
}

type ReorderScroll = ReturnType<typeof useReorderScrollState>;

const ReorderScrollContext = createContext<ReorderScroll | null>(null);

/**
 * A ScrollView for screens that contain a ReorderableList. It tracks the scroll
 * offset and viewport so the list can auto-scroll when a row is dragged near an
 * edge, and it stops scrolling while a row is lifted so the two gestures never
 * fight. Use it exactly like a ScrollView; `style` sizes the wrapping viewport.
 */
export function ReorderScrollView({
  style,
  onScroll,
  onContentSizeChange,
  onLayout,
  children,
  ...rest
}: Omit<ScrollViewProps, 'scrollEnabled'>) {
  const scroll = useReorderScrollState();
  const { scrollProps } = scroll;

  return (
    <ReorderScrollContext.Provider value={scroll}>
      <View ref={scroll.viewportRef} style={style} collapsable={false}>
        <ScrollView
          {...rest}
          {...scrollProps}
          style={styles.fill}
          onScroll={e => {
            scrollProps.onScroll(e);
            onScroll?.(e);
          }}
          onContentSizeChange={(w, h) => {
            scrollProps.onContentSizeChange(w, h);
            onContentSizeChange?.(w, h);
          }}
          onLayout={e => {
            scrollProps.onLayout(e);
            onLayout?.(e);
          }}
        >
          {children}
        </ScrollView>
      </View>
    </ReorderScrollContext.Provider>
  );
}

type DragProps = {
  onTouchStart: (e: GestureResponderEvent) => void;
  onTouchMove: (e: GestureResponderEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
};

export type ReorderItemInfo<T> = {
  item: T;
  index: number;
  /** True while this row is the one being dragged. */
  active: boolean;
  /** Touch handlers for the zone that grabs the row; `delayMs` 0 lifts on touch. */
  dragProps: (delayMs?: number) => DragProps;
};

type Props<T> = {
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (info: ReorderItemInfo<T>) => React.ReactElement;
  /** Called once, on drop, with the old and new index. */
  onReorder: (from: number, to: number) => void;
  style?: StyleProp<ViewStyle>;
};

function ReorderItem({
  id,
  active,
  dragY,
  lift,
  register,
  setHeight,
  children,
}: {
  id: string;
  active: boolean;
  dragY: Animated.Value;
  lift: Animated.Value;
  register: (id: string, shift: Animated.Value | null) => void;
  setHeight: (id: string, height: number) => void;
  children: React.ReactNode;
}) {
  // Neighbours slide out of the way by animating this value.
  const [shift] = useState(() => new Animated.Value(0));

  useEffect(() => {
    register(id, shift);
    return () => register(id, null);
  }, [id, shift, register]);

  const scale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  return (
    <Animated.View
      onLayout={e => setHeight(id, e.nativeEvent.layout.height)}
      style={
        active
          ? [styles.lifted, { transform: [{ translateY: dragY }, { scale }] }]
          : { transform: [{ translateY: shift }] }
      }
    >
      {children}
    </Animated.View>
  );
}

/**
 * A vertical list whose rows can be picked up with a long press and dragged to a
 * new position. The lifted row follows the finger, neighbours spring aside to open
 * the slot, the list scrolls itself near the edges, and the row settles into place
 * on release. Built on Animated + PanResponder, so it needs no native module.
 */
export function ReorderableList<T>({ data, keyExtractor, renderItem, onReorder, style }: Props<T>) {
  const scroll = useContext(ReorderScrollContext) ?? undefined;
  const keys = data.map(keyExtractor);
  const keysRef = useRef(keys);
  const scrollRef = useRef(scroll);
  const onReorderRef = useRef(onReorder);
  useEffect(() => {
    keysRef.current = keys;
    scrollRef.current = scroll;
    onReorderRef.current = onReorder;
  });

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dragY] = useState(() => new Animated.Value(0));
  const [lift] = useState(() => new Animated.Value(0));

  const heights = useRef(new Map<string, number>());
  const shifts = useRef(new Map<string, Animated.Value>());
  const pendingReset = useRef(false);
  const touch = useRef<{ key: string; x: number; y: number } | null>(null);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const drag = useRef({
    active: false,
    from: 0,
    to: 0,
    startPageY: 0,
    fingerY: 0,
    startOffset: 0,
    viewportTop: 0,
    viewportBottom: 0,
  });

  const register = useCallback((id: string, shift: Animated.Value | null) => {
    if (shift) shifts.current.set(id, shift);
    else shifts.current.delete(id);
  }, []);
  const setHeight = useCallback((id: string, height: number) => {
    heights.current.set(id, height);
  }, []);

  const clearTouchTimer = () => {
    if (touchTimer.current) clearTimeout(touchTimer.current);
    touchTimer.current = null;
  };
  const stopScrollLoop = () => {
    if (scrollTimer.current) clearInterval(scrollTimer.current);
    scrollTimer.current = null;
  };

  const heightsInOrder = () => keysRef.current.map(k => heights.current.get(k) ?? 0);

  /** Re-derive the drop slot from where the lifted row currently sits. */
  const update = () => {
    const s = drag.current;
    if (!s.active) return;
    const offsetNow = scrollRef.current?.offset.current ?? 0;
    const dy = s.fingerY - s.startPageY + (offsetNow - s.startOffset);
    dragY.setValue(dy);

    const hs = heightsInOrder();
    const tops: number[] = [];
    let run = 0;
    for (const h of hs) {
      tops.push(run);
      run += h;
    }

    const from = s.from;
    const center = tops[from] + hs[from] / 2 + dy;
    let to = from;
    for (let j = from + 1; j < hs.length; j++) {
      if (center > tops[j] + hs[j] / 2) to = j;
      else break;
    }
    if (to === from) {
      for (let j = from - 1; j >= 0; j--) {
        if (center < tops[j] + hs[j] / 2) to = j;
        else break;
      }
    }

    if (to !== s.to) {
      s.to = to;
      Haptics.selectionAsync().catch(() => {});
      const activeHeight = hs[from];
      keysRef.current.forEach((k, j) => {
        if (j === from) return;
        const shift = shifts.current.get(k);
        if (!shift) return;
        let target = 0;
        if (to > from && j > from && j <= to) target = -activeHeight;
        else if (to < from && j < from && j >= to) target = activeHeight;
        Animated.spring(shift, { toValue: target, useNativeDriver: true, ...SPRING }).start();
      });
    }
  };

  const resetAll = () => {
    shifts.current.forEach(shift => shift.setValue(0));
    dragY.setValue(0);
    lift.setValue(0);
    pendingReset.current = false;
    setActiveKey(null);
    scrollRef.current?.setDragging(false);
  };

  const finish = () => {
    const s = drag.current;
    if (!s.active) return;
    s.active = false;
    stopScrollLoop();
    clearTouchTimer();

    const hs = heightsInOrder();
    const { from, to } = s;
    let startTop = 0;
    for (let k = 0; k < from; k++) startTop += hs[k];
    const rest = hs.filter((_, idx) => idx !== from);
    let slotTop = 0;
    for (let k = 0; k < to; k++) slotTop += rest[k];

    Animated.parallel([
      Animated.spring(dragY, { toValue: slotTop - startTop, useNativeDriver: true, ...SPRING }),
      Animated.spring(lift, { toValue: 0, useNativeDriver: true, ...SPRING }),
    ]).start(() => {
      if (from === to) {
        resetAll();
      } else {
        // Reset runs in the layout effect below, in the same commit as the new order.
        pendingReset.current = true;
        onReorderRef.current(from, to);
      }
    });
  };

  // Once the reordered data has rendered, clear the transforms in the same frame
  // so nothing jumps.
  const orderSignature = keys.join('|');
  useLayoutEffect(() => {
    if (pendingReset.current) resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderSignature]);

  useEffect(() => () => {
    clearTouchTimer();
    stopScrollLoop();
  }, []);

  const startScrollLoop = () => {
    stopScrollLoop();
    scrollTimer.current = setInterval(() => {
      const s = drag.current;
      const sc = scrollRef.current;
      if (!s.active || !sc || s.viewportBottom <= s.viewportTop) return;
      const y = s.fingerY;
      let speed = 0;
      if (y < s.viewportTop + EDGE_ZONE) {
        speed = -MAX_SCROLL_PER_TICK * Math.min(1, (s.viewportTop + EDGE_ZONE - y) / EDGE_ZONE);
      } else if (y > s.viewportBottom - EDGE_ZONE) {
        speed = MAX_SCROLL_PER_TICK * Math.min(1, (y - (s.viewportBottom - EDGE_ZONE)) / EDGE_ZONE);
      }
      if (speed === 0) return;
      const max = Math.max(0, sc.contentHeight.current - sc.viewportHeight.current);
      const next = Math.min(max, Math.max(0, sc.offset.current + speed));
      if (next === sc.offset.current) return;
      sc.offset.current = next;
      sc.scrollViewRef.current?.scrollTo({ y: next, animated: false });
      update();
    }, 16);
  };

  const activate = (key: string, pageY: number) => {
    const s = drag.current;
    if (s.active) return;
    const index = keysRef.current.indexOf(key);
    if (index < 0) return;

    s.active = true;
    s.from = index;
    s.to = index;
    s.startPageY = pageY;
    s.fingerY = pageY;
    s.startOffset = scrollRef.current?.offset.current ?? 0;
    s.viewportTop = 0;
    s.viewportBottom = 0;

    dragY.setValue(0);
    lift.setValue(0);
    Animated.spring(lift, { toValue: 1, useNativeDriver: true, ...SPRING }).start();
    setActiveKey(key);
    scrollRef.current?.setDragging(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    scrollRef.current?.viewportRef.current?.measureInWindow((_x, y, _w, h) => {
      s.viewportTop = y;
      s.viewportBottom = y + h;
    });
    startScrollLoop();
  };

  const dragProps = (key: string, delayMs: number = LONG_PRESS_MS): DragProps => ({
    onTouchStart: e => {
      if (drag.current.active) return;
      const { pageX, pageY } = e.nativeEvent;
      touch.current = { key, x: pageX, y: pageY };
      clearTouchTimer();
      if (delayMs <= 0) {
        activate(key, pageY);
        return;
      }
      touchTimer.current = setTimeout(() => {
        const t = touch.current;
        if (t) activate(t.key, t.y);
      }, delayMs);
    },
    onTouchMove: e => {
      const t = touch.current;
      if (!t || drag.current.active) return;
      const { pageX, pageY } = e.nativeEvent;
      if (Math.abs(pageY - t.y) > MOVE_CANCEL_PX || Math.abs(pageX - t.x) > MOVE_CANCEL_PX) {
        // Moved before the hold completed: the user is scrolling, not grabbing.
        clearTouchTimer();
        touch.current = null;
      }
    },
    // Lifted but never dragged: drop it back where it was.
    onTouchEnd: () => {
      clearTouchTimer();
      touch.current = null;
      finish();
    },
    onTouchCancel: () => {
      clearTouchTimer();
      touch.current = null;
      finish();
    },
  });

  // Claims the gesture once a row is lifted, so the ScrollView and any child
  // responders can't steal it mid-drag.
  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: () => drag.current.active,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        drag.current.fingerY = g.moveY;
        update();
      },
      onPanResponderRelease: () => finish(),
      onPanResponderTerminate: () => finish(),
    }),
  );

  return (
    <View style={style} {...pan.panHandlers}>
      {data.map((item, index) => {
        const key = keys[index];
        const active = key === activeKey;
        return (
          <ReorderItem
            key={key}
            id={key}
            active={active}
            dragY={dragY}
            lift={lift}
            register={register}
            setHeight={setHeight}
          >
            {renderItem({ item, index, active, dragProps: delayMs => dragProps(key, delayMs) })}
          </ReorderItem>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  lifted: {
    zIndex: 10,
    elevation: 12,
    backgroundColor: colors.paper,
    shadowColor: colors.ink,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
});
