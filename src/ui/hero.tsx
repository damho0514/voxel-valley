import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

/*
 * The player's character for the entry screen, drawn with plain views so the title screen doesn't
 * need three.js: the same smug, bald, big-headed figure as in the game (renderer.ts makeHead), with
 * the body in the player's colour. It breathes and glances, lit from the side by the moon.
 */

const SKIN = '#e9bf98';
const SKIN_SHADE = '#c99a76';
const INK = '#2a2230';

export function Hero({ color, size = 1 }: { color: string; size?: number }) {
  const [breathe] = useState(() => new Animated.Value(0));
  const [glance] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const b = Animated.loop(Animated.sequence([
      Animated.delay(2200),
      Animated.timing(glance, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(glance, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]));
    a.start();
    b.start();
    return () => { a.stop(); b.stop(); };
  }, [breathe, glance]);

  const bob = breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const belly = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const pupil = glance.interpolate({ inputRange: [0, 1], outputRange: [3, -3] });

  return (
    <View style={[styles.wrap, { transform: [{ scale: size }] }]}>
      <View style={styles.shadow} />
      {/* legs */}
      <View style={[styles.leg, { left: 50 }]} />
      <View style={[styles.leg, { left: 74 }]} />
      <Animated.View style={[styles.upper, { transform: [{ translateY: bob }] }]}>
        {/* body with a pot belly */}
        <Animated.View style={[styles.body, { backgroundColor: color, transform: [{ scaleX: belly }] }]}>
          <View style={styles.bodyShade} />
          <View style={styles.bellyBand} />
        </Animated.View>
        {/* turtle neck */}
        <View style={styles.neck} />
        {/* the big bald head */}
        <View style={styles.head}>
          <View style={styles.headShade} />
          <View style={styles.shine} />
          <View style={styles.glint} />
          {/* ears */}
          <View style={[styles.ear, { left: -7 }]} />
          <View style={[styles.ear, { right: -7 }]} />
          {/* brows: one cocked */}
          <View style={[styles.brow, { left: 24, top: 44, transform: [{ rotate: '-4deg' }] }]} />
          <View style={[styles.brow, { left: 62, top: 37, transform: [{ rotate: '-16deg' }] }]} />
          {/* half-lidded eyes glancing sideways */}
          {[26, 63].map((x) => (
            <View key={x} style={[styles.eye, { left: x }]}>
              <Animated.View style={[styles.pupil, { transform: [{ translateX: pupil }] }]} />
              <View style={styles.lid} />
            </View>
          ))}
          <View style={styles.nose} />
          <View style={styles.smirk} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 132, height: 190, alignItems: 'center' },
  shadow: { position: 'absolute', bottom: 0, width: 92, height: 14, borderRadius: 46, backgroundColor: 'rgba(0,0,0,0.45)' },
  leg: { position: 'absolute', bottom: 6, width: 18, height: 26, borderRadius: 5, backgroundColor: '#2c3140' },
  upper: { position: 'absolute', bottom: 26, width: 132, height: 164, alignItems: 'center' },
  body: { position: 'absolute', bottom: 0, width: 82, height: 62, borderTopLeftRadius: 30, borderTopRightRadius: 30,
    borderBottomLeftRadius: 34, borderBottomRightRadius: 34, overflow: 'hidden' },
  bodyShade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 30, backgroundColor: 'rgba(0,0,0,0.28)' },
  bellyBand: { position: 'absolute', left: 16, right: 16, bottom: 10, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.12)' },
  neck: { position: 'absolute', bottom: 56, width: 34, height: 16, borderRadius: 8, backgroundColor: SKIN_SHADE },
  head: { position: 'absolute', top: 0, width: 110, height: 98, borderRadius: 50, backgroundColor: SKIN },
  headShade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 40, borderTopRightRadius: 50, borderBottomRightRadius: 50,
    backgroundColor: 'rgba(40,30,60,0.32)' },
  shine: { position: 'absolute', left: 26, top: 9, width: 34, height: 15, borderRadius: 8, backgroundColor: 'rgba(255,255,245,0.55)',
    transform: [{ rotate: '-14deg' }] },
  glint: { position: 'absolute', left: 30, top: 10, width: 7, height: 7, borderRadius: 4, backgroundColor: 'white' },
  ear: { position: 'absolute', top: 46, width: 14, height: 20, borderRadius: 7, backgroundColor: SKIN_SHADE },
  brow: { position: 'absolute', width: 22, height: 5, borderRadius: 3, backgroundColor: INK },
  eye: { position: 'absolute', top: 52, width: 22, height: 13, borderRadius: 7, backgroundColor: 'white', overflow: 'hidden' },
  pupil: { position: 'absolute', left: 6, top: 4, width: 10, height: 10, borderRadius: 5, backgroundColor: INK },
  lid: { position: 'absolute', left: 0, right: 0, top: 0, height: 6, backgroundColor: SKIN_SHADE },
  nose: { position: 'absolute', left: 49, top: 60, width: 12, height: 20, borderRadius: 6, backgroundColor: SKIN_SHADE },
  smirk: { position: 'absolute', left: 44, top: 80, width: 30, height: 9, borderBottomWidth: 3, borderRightWidth: 2,
    borderColor: INK, borderBottomRightRadius: 12, borderBottomLeftRadius: 4, transform: [{ rotate: '-8deg' }] },
});
