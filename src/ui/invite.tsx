import React, { useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { inviteMessage, inviteUrl } from '../net/room';
import { THEME } from './hud';

/*
 * "친구 초대": the room's one-tap link. Whoever opens it lands in this same room on the same
 * server — in the app on Android if they have it, otherwise straight into the browser game
 * (nothing to install). Share opens the phone's share sheet (KakaoTalk, messages, copy); on a
 * computer the link can also be copied.
 */
export function InvitePanel({ code, name, online, onClose }: { code: string; name: string; online: boolean; onClose: () => void }) {
  const url = inviteUrl(code);
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const message = inviteMessage(code, name);
    try {
      if (Platform.OS === 'web') {
        const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
        if (nav.share) { await nav.share({ title: 'Voxel Valley 초대', text: message.split('\n')[0], url }); return; }
        await copy();
        return;
      }
      await Share.share({ message });
    } catch { /* dismissed */ }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteMessage(code, name));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* no clipboard: the link is on screen to select */ }
  };
  return (
    <Pressable style={styles.veil} onPress={onClose}>
      <Pressable style={styles.card} onPress={() => {}}>
        <Text style={styles.title}>👥 친구 초대</Text>
        <Text style={styles.sub}>{online ? '이 링크를 받은 사람은 누르기만 하면 설치 없이 지금 이 월드로 바로 들어와요.' : '방을 여는 중이에요… 잠시만요'}</Text>
        <Text selectable style={styles.link}>{url}</Text>
        <Text style={styles.code}>{`방 코드 ${code}`}</Text>
        <View style={styles.row}>
          <Pressable testID="invite-share" style={[styles.btn, styles.primary]} onPress={share}>
            <Text style={[styles.btnText, { color: '#2a1b00' }]}>📤 카톡 · 메시지로 보내기</Text>
          </Pressable>
          {Platform.OS === 'web' && (
            <Pressable testID="invite-copy" style={styles.btn} onPress={copy}>
              <Text style={styles.btnText}>{copied ? '✅ 복사됨' : '🔗 링크 복사'}</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.note}>아이폰 · 컴퓨터는 브라우저에서 바로, 안드로이드는 앱이 있으면 앱으로 열려요. 같은 서버의 같은 방이라 서로 보이고, 부수고 짓는 게 함께 반영돼요.</Text>
        <Pressable testID="invite-close" onPress={onClose} style={styles.close}><Text style={styles.closeText}>닫기</Text></Pressable>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  veil: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(6,10,20,0.55)', alignItems: 'center', justifyContent: 'center' },
  card: { width: 460, maxWidth: '92%', padding: 20, borderRadius: 20, backgroundColor: 'rgba(12,18,34,0.96)', borderWidth: 1, borderColor: THEME.rim, gap: 8 },
  title: { color: THEME.gold, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  sub: { color: THEME.ink, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  link: { color: THEME.ink, fontSize: 13, fontWeight: '700', textAlign: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10,
    backgroundColor: 'rgba(255,246,220,0.08)', borderWidth: 1, borderColor: THEME.rimSoft },
  code: { color: THEME.inkSoft, fontSize: 12, fontWeight: '800', textAlign: 'center', letterSpacing: 1 },
  row: { flexDirection: 'row', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
  btn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: THEME.glassHi, borderWidth: 1, borderColor: THEME.rimSoft },
  primary: { backgroundColor: 'rgba(242,195,91,0.95)', borderColor: '#fff3cf' },
  btnText: { color: THEME.ink, fontSize: 15, fontWeight: '900' },
  note: { color: THEME.inkSoft, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  close: { alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 6 },
  closeText: { color: THEME.inkSoft, fontSize: 14, fontWeight: '800' },
});
