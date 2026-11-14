import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { Store, THEME, useStore } from './hud';

/*
 * One action button for the touch screen, in place of a row of icons.
 *
 *  - Tap: the obvious thing right now — 💥 break what's marked while drawing, 🧞 land while flying,
 *    otherwise ✏️ start drawing.
 *  - Hold (or start sliding): a ring of choices fans out up and to the left. Slide the finger onto
 *    one and let go to do it; let go back on the button to cancel. One thumb, no hunting.
 */

export type DialItem = { id: string; icon: string; label: string; needsMarks?: boolean };
export type DialPrimary = 'cast' | 'land' | 'draw';

const HOLD_MS = 240;
const SLIDE_OPEN = 18;
const RADIUS = 128;
/** Room the ring needs above and to the left of the button. */
const W = 320, H = 290;

const PRIMARY: Record<DialPrimary, { icon: string; label: string }> = {
  cast: { icon: '💥', label: '부수기' },
  land: { icon: '🧞', label: '착륙' },
  draw: { icon: '✏️', label: '그리기' },
};

export function ActionDial({ items, primary, marks, size, right, bottom, onPrimary, onPick, onHover }: {
  items: DialItem[]; primary: DialPrimary; marks: Store<{ count: number; cap: number }>; size: number; right: number; bottom: number;
  onPrimary: () => void; onPick: (id: string) => void; onHover?: () => void;
}) {
  const { count } = useStore(marks);
  const shown = items.filter((it) => !it.needsMarks || count > 0);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(-1);
  const [held, setHeld] = useState(false);
  const st = useRef({ x: 0, y: 0, open: false, hover: -1, timer: 0 as unknown as ReturnType<typeof setTimeout> });

  const n = shown.length;
  // A fan from just right of straight up round to just above straight left (never off the bottom).
  const angles = shown.map((_, i) => (-72 - (n <= 1 ? 0 : (i * 98) / (n - 1))) * (Math.PI / 180));
  const cx = W - size / 2, cy = H - size / 2;

  const openRing = () => {
    if (st.current.open) return;
    st.current.open = true;
    setOpen(true);
    onHover?.();
  };
  const pan = usePanGesture({
    minDistance: 0,
    runOnJS: true,
    onBegin: (e) => {
      st.current.x = e.x; st.current.y = e.y; st.current.open = false; st.current.hover = -1;
      setHeld(true); setHover(-1);
      clearTimeout(st.current.timer);
      st.current.timer = setTimeout(openRing, HOLD_MS);
    },
    onUpdate: (e) => {
      const dx = e.x - st.current.x, dy = e.y - st.current.y;
      if (!st.current.open && Math.hypot(dx, dy) > SLIDE_OPEN) openRing();
      if (!st.current.open) return;
      // The choice nearest the finger's direction, once it's well away from the button.
      let best = -1;
      if (Math.hypot(dx, dy) > 44) {
        const a = Math.atan2(dy, dx);
        let bd = Infinity;
        angles.forEach((t, i) => {
          const d = Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t)));
          if (d < bd) { bd = d; best = i; }
        });
        if (bd > 0.6) best = -1;
      }
      if (best !== st.current.hover) {
        st.current.hover = best;
        setHover(best);
        if (best >= 0) onHover?.();
      }
    },
    onFinalize: () => {
      clearTimeout(st.current.timer);
      const { open: wasOpen, hover: h } = st.current;
      st.current.open = false; st.current.hover = -1;
      setOpen(false); setHover(-1); setHeld(false);
      if (!wasOpen) onPrimary();
      else if (h >= 0 && shown[h]) onPick(shown[h].id);
    },
  });

  const p = PRIMARY[primary];
  const ready = primary !== 'cast' || count > 0;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { right, bottom }]}>
      {open && (
        <>
          <View pointerEvents="none" style={[styles.scrim, { left: cx - RADIUS - 46, top: cy - RADIUS - 46, width: (RADIUS + 46) * 2, height: (RADIUS + 46) * 2, borderRadius: RADIUS + 46 }]} />
          {shown.map((it, i) => {
            const x = cx + Math.cos(angles[i]) * RADIUS, y = cy + Math.sin(angles[i]) * RADIUS;
            const on = i === hover;
            return (
              <View key={it.id} pointerEvents="none" testID={`dial-${it.id}`}
                style={[styles.item, on && styles.itemOn, { left: x - 29, top: y - 29 }]}>
                <Text style={styles.itemIcon}>{it.icon}</Text>
                <Text style={[styles.itemLabel, on && styles.itemLabelOn]} numberOfLines={1}>{it.label}</Text>
              </View>
            );
          })}
        </>
      )}
      <GestureDetector gesture={pan}>
        <View testID="action" style={[styles.button, { width: size, height: size, borderRadius: size / 2 },
          primary === 'cast' && ready && styles.buttonGold, held && { transform: [{ scale: 0.93 }] }]}>
          <Text style={{ fontSize: size * 0.32 }}>{open ? '✦' : p.icon}</Text>
          <Text style={[styles.sub, primary === 'cast' && ready && { color: '#3a2600' }]} numberOfLines={1}>
            {open ? (hover >= 0 ? shown[hover]?.label : '밀어서 선택') : primary === 'cast' && count > 0 ? `${p.label} ${count}` : p.label}
          </Text>
          {/* Three dots on the rim: there's more under a long press. */}
          {!open && <View pointerEvents="none" style={styles.more}>{[0, 1, 2].map((k) => <View key={k} style={styles.dot} />)}</View>}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', width: W, height: H },
  scrim: { position: 'absolute', backgroundColor: 'rgba(8,12,24,0.45)' },
  button: {
    position: 'absolute', right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center',
    backgroundColor: THEME.glass, borderWidth: 1.5, borderColor: THEME.rimSoft,
  },
  buttonGold: { backgroundColor: 'rgba(242,195,91,0.95)', borderColor: '#fff3cf', borderWidth: 2 },
  sub: { color: THEME.inkSoft, fontSize: 12, fontWeight: '800', marginTop: -2, maxWidth: '86%' },
  more: { position: 'absolute', top: 7, flexDirection: 'row', gap: 3 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: THEME.rim },
  item: {
    position: 'absolute', width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center',
    backgroundColor: THEME.glassHi, borderWidth: 1.5, borderColor: THEME.rimSoft,
  },
  itemOn: { backgroundColor: 'rgba(242,195,91,0.95)', borderColor: '#fff3cf', transform: [{ scale: 1.18 }] },
  itemIcon: { fontSize: 22 },
  itemLabel: { position: 'absolute', bottom: -17, color: THEME.ink, fontSize: 11, fontWeight: '800', width: 80, textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3 },
  itemLabelOn: { color: THEME.gold },
});
