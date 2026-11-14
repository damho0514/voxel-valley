import React from 'react';
import { View } from 'react-native';
import { Gem } from '../game/treasure';

/** A drawn, faceted gem (emoji gems look different on every phone, and there's no ruby emoji). */
export function GemIcon({ gem, size = 22, dim = false }: { gem: Pick<Gem, 'color' | 'shine'>; size?: number; dim?: boolean }) {
  const s = size * 0.72;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity: dim ? 0.3 : 1 }}>
      <View style={{ width: s, height: s, transform: [{ rotate: '45deg' }], backgroundColor: gem.color, borderRadius: size * 0.12,
        borderWidth: Math.max(1, size * 0.06), borderColor: 'rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: 0, top: 0, width: s * 0.55, height: s * 0.55, backgroundColor: gem.shine, opacity: 0.7 }} />
        <View style={{ position: 'absolute', right: 0, bottom: 0, width: s * 0.45, height: s * 0.45, backgroundColor: 'rgba(0,0,0,0.18)' }} />
      </View>
    </View>
  );
}
