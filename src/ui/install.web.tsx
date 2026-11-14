import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

/*
 * "💻 PC 앱으로 설치" on the title screen (Edge / Chrome on Windows, Mac, Chromebook, Linux).
 * Installing puts Voxel Valley on the desktop and Start menu; it then opens in its own window
 * without the address bar or tabs, like a game. Hidden when it's already running as that app,
 * in the Mac app, and in browsers that can't install (Safari, Firefox, phones).
 */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

// The browser fires this once, often before the title screen mounts, so catch it right away.
let pending: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // our button instead of the browser's mini-infobar
    pending = e as InstallEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => { pending = null; listeners.forEach((f) => f()); });
}

const asApp = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches ||
    /VoxelValleyMac/.test(navigator.userAgent));

export function InstallButton() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  if (!pending || asApp()) return null;
  const install = async () => {
    const e = pending;
    if (!e) return;
    try {
      await e.prompt();
      await e.userChoice;
    } catch {}
    pending = null; // a prompt can only be shown once
    bump((n) => n + 1);
  };
  return (
    <Pressable testID="install-app" style={styles.btn} onPress={install}>
      <Text style={styles.text}>💻 PC 앱으로 설치</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { position: 'absolute', top: 16, left: 18, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  text: { color: 'white', fontSize: 14, fontWeight: '800' },
});
