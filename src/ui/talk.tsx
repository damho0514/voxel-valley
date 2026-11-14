import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, TextInput, View } from 'react-native';
import { greetLine, Persona, replyTo, spoken } from '../game/people';

/*
 * Chatting with one of the valley's people (tap them). They answer out loud in their own voice
 * (text-to-speech with their pitch and speed); you talk back by voice (🎙️, speech recognition),
 * by a suggestion chip, or by typing. The microphone is never on while they're speaking, so they
 * don't answer themselves.
 *
 * This panel is where player-to-player voice chat (people you meet on a server) will live later.
 */

type Line = { who: 'them' | 'me'; text: string };
type Mic = 'idle' | 'listening' | 'unavailable' | 'denied';

export function TalkPanel({ persona, onClose, onSpeaking }: { persona: Persona; onClose: () => void; onSpeaking: (on: boolean) => void }) {
  const [log, setLog] = useState<Line[]>([]);
  const [mic, setMic] = useState<Mic>('idle');
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);
  const alive = useRef(true);
  const speakingRef = useRef(onSpeaking);
  useEffect(() => { speakingRef.current = onSpeaking; }, [onSpeaking]);

  const say = (text: string) => {
    setLog((l) => [...l, { who: 'them', text }]);
    Speech.stop();
    speakingRef.current(true);
    const done = () => { if (alive.current) speakingRef.current(false); };
    Speech.speak(spoken(text), { language: 'ko-KR', pitch: persona.voice.pitch, rate: persona.voice.rate, onDone: done, onStopped: done, onError: done });
  };
  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setLog((l) => [...l, { who: 'me', text: t }]);
    setTimeout(() => { if (alive.current) say(replyTo(persona, t)); }, 450);
  };

  useEffect(() => {
    alive.current = true;
    const t = setTimeout(() => say(greetLine(persona)), 250);
    return () => {
      alive.current = false;
      clearTimeout(t);
      Speech.stop();
      try { ExpoSpeechRecognitionModule.abort(); } catch {}
      speakingRef.current(false);
    };
    // Greets once when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript ?? '';
    setHeard(text);
    if (e.isFinal) {
      setHeard('');
      setMic('idle');
      send(text);
    }
  });
  useSpeechRecognitionEvent('end', () => setMic((m) => (m === 'listening' ? 'idle' : m)));
  useSpeechRecognitionEvent('error', (e) => {
    setHeard('');
    setMic(e.error === 'not-allowed' ? 'denied' : 'idle');
  });

  const listen = async () => {
    if (mic === 'listening') {
      try { ExpoSpeechRecognitionModule.stop(); } catch {}
      return;
    }
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) { setMic('unavailable'); return; }
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) { setMic('denied'); return; }
      Speech.stop(); // never listen while they talk
      setMic('listening');
      ExpoSpeechRecognitionModule.start({
        lang: 'ko-KR',
        interimResults: true,
        continuous: false,
        // Keep the game's music and sounds playing through the speaker while the mic is on.
        iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth', 'mixWithOthers'], mode: 'default' },
      });
    } catch {
      setMic('unavailable');
    }
  };

  const micNote = mic === 'denied' ? '마이크 권한이 꺼져 있어요 · 설정에서 켜 주세요'
    : mic === 'unavailable' ? '이 기기에선 음성 인식을 못 써요 · 아래 말풍선이나 입력을 써 주세요'
      : mic === 'listening' ? (heard || '듣고 있어요… 말해 보세요') : null;

  return (
    <View style={styles.panel} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.face}>{persona.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{persona.name}</Text>
            <Text style={styles.about} numberOfLines={1}>{persona.about}</Text>
          </View>
          <Pressable testID="talk-close" onPress={onClose} hitSlop={12} style={styles.close}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <ScrollView ref={scroll} style={styles.log} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {log.map((l, i) => (
            <View key={i} style={[styles.bubble, l.who === 'me' ? styles.mine : styles.theirs]}>
              <Text style={[styles.bubbleText, l.who === 'me' && styles.mineText]}>{l.text}</Text>
            </View>
          ))}
        </ScrollView>
        {micNote && <Text style={styles.note}>{micNote}</Text>}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.chips}>
          {persona.chips.map((c) => (
            <Pressable key={c} onPress={() => send(c)} style={styles.chip}><Text style={styles.chipText}>{c}</Text></Pressable>
          ))}
        </ScrollView>
        <View style={styles.inputRow}>
          <TextInput testID="talk-input" value={typed} onChangeText={setTyped} placeholder="말 걸기…" placeholderTextColor="#8a93a6"
            style={styles.input} returnKeyType="send" onSubmitEditing={() => { send(typed); setTyped(''); }} />
          <Pressable testID="talk-mic" onPress={listen} style={[styles.mic, mic === 'listening' && styles.micOn]}>
            <Text style={styles.micText}>{mic === 'listening' ? '■' : '🎙️'}</Text>
          </Pressable>
        </View>
        <Text style={styles.soon}>곧: 서버에서 만난 친구와 음성 대화</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // On the right, so the person you're talking to stays in view on the left.
  panel: { position: 'absolute', top: 58, right: 12, bottom: 12, width: '46%', maxWidth: 440, justifyContent: 'flex-end' },
  card: { flex: 1, borderRadius: 20, backgroundColor: 'rgba(16,20,32,0.94)', padding: 12, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  face: { fontSize: 30 },
  name: { color: 'white', fontSize: 16, fontWeight: '900' },
  about: { color: '#a9b2c3', fontSize: 12 },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#384156' },
  closeText: { color: 'white', fontWeight: '900' },
  log: { flex: 1 },
  bubble: { maxWidth: '86%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#2a3246', borderTopLeftRadius: 4 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#ffd36a', borderTopRightRadius: 4 },
  bubbleText: { color: 'white', fontSize: 14, lineHeight: 19 },
  mineText: { color: '#2a1b00', fontWeight: '700' },
  note: { color: '#ffd36a', fontSize: 12, fontWeight: '700' },
  chips: { gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#2a3246' },
  chipText: { color: 'white', fontSize: 13, fontWeight: '700' },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, height: 40, borderRadius: 20, paddingHorizontal: 14, backgroundColor: '#232a3b', color: 'white', fontSize: 14 },
  mic: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffd36a' },
  micOn: { backgroundColor: '#ff6b6b' },
  micText: { fontSize: 20 },
  soon: { color: '#6f7a90', fontSize: 11, textAlign: 'center' },
});
