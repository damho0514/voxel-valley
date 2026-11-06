"""Synthesises every sound in assets/sounds/ from scratch: no samples, so no third-party rights.

    python3 tools/gen_sounds.py

Pure standard library. Re-run after tweaking a sound.
"""
import array
import math
import os
import random
import wave

RATE = 22050
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'sounds')


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def env(t, length, attack=0.004, release=0.04):
    a = min(1.0, t / attack) if attack else 1.0
    r = min(1.0, max(0.0, (length - t) / release)) if release else 1.0
    return a * r


def tone(buf, start, length, freq, vol=0.3, freq_end=None, decay=None, kind='sine', attack=0.004, release=0.04):
    i0, n, phase = int(start * RATE), int(length * RATE), 0.0
    for i in range(n):
        t = i / RATE
        f = freq if freq_end is None else freq * (freq_end / freq) ** (t / length)
        phase += f / RATE
        p = phase % 1.0
        s = math.sin(2 * math.pi * p) if kind == 'sine' else (4 * abs(p - 0.5) - 1)
        level = env(t, length, attack, release) * (math.exp(-t / decay) if decay else 1.0)
        j = i0 + i
        if j < len(buf):
            buf[j] += vol * level * s


def noise(buf, start, length, vol=0.2, smooth=0.5, decay=None, seed=1, attack=0.002, release=0.03, sweep=None):
    """Low-passed white noise. `sweep` moves the smoothing from smooth to sweep over the sound."""
    rng = random.Random(seed)
    i0, n, y = int(start * RATE), int(length * RATE), 0.0
    for i in range(n):
        t = i / RATE
        k = smooth if sweep is None else smooth + (sweep - smooth) * t / length
        y += (1 - k) * (rng.uniform(-1, 1) - y)
        level = env(t, length, attack, release) * (math.exp(-t / decay) if decay else 1.0)
        j = i0 + i
        if j < len(buf):
            buf[j] += vol * level * y


def save(name, buf, peak=0.85):
    m = max(1e-9, max(abs(v) for v in buf))
    scale = min(1.0, peak / m) * 32767
    data = array.array('h', (int(max(-1, min(1, v * scale / 32767)) * 32767) for v in buf))
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data.tobytes())
    print(f'{name}: {len(buf) / RATE:.2f}s')


def blank(seconds):
    return [0.0] * int(seconds * RATE)


def main():
    os.makedirs(OUT, exist_ok=True)

    b = blank(0.09)  # one scrape while digging
    noise(b, 0, 0.09, vol=0.5, smooth=0.55, decay=0.03, seed=3)
    tone(b, 0, 0.05, 180, vol=0.25, freq_end=120, decay=0.02)
    save('dig.wav', b, peak=0.6)

    b = blank(0.28)  # block breaks
    noise(b, 0, 0.26, vol=0.6, smooth=0.45, decay=0.07, seed=5, sweep=0.8)
    tone(b, 0, 0.12, 260, vol=0.35, freq_end=90, decay=0.05)
    save('break.wav', b, peak=0.75)

    b = blank(0.14)  # soft "thock" when placing
    tone(b, 0, 0.12, 210, vol=0.6, freq_end=140, decay=0.03, kind='tri')
    noise(b, 0, 0.04, vol=0.25, smooth=0.3, decay=0.01, seed=7)
    save('place.wav', b, peak=0.7)

    for i, seed in enumerate((11, 12)):  # two footsteps so walking doesn't sound mechanical
        b = blank(0.08)
        noise(b, 0, 0.08, vol=0.5, smooth=0.75, decay=0.018, seed=seed)
        tone(b, 0, 0.05, 95 + 12 * i, vol=0.3, decay=0.015)
        save(f'step{i + 1}.wav', b, peak=0.4)

    b = blank(0.2)  # jump: a little upward whoosh
    noise(b, 0, 0.2, vol=0.3, smooth=0.9, sweep=0.5, release=0.08)
    tone(b, 0, 0.16, 300, vol=0.15, freq_end=520, release=0.06)
    save('jump.wav', b, peak=0.4)

    b = blank(0.45)  # splash
    noise(b, 0, 0.45, vol=0.7, smooth=0.2, decay=0.12, seed=21, sweep=0.85)
    for k in range(5):
        tone(b, 0.03 + k * 0.06, 0.06, 700 + 180 * k, vol=0.08, freq_end=1200 + 150 * k, decay=0.02)
    save('splash.wav', b, peak=0.55)

    b = blank(0.6)  # someone joined: two-note chime
    tone(b, 0.0, 0.35, midi(76), vol=0.3, decay=0.15)
    tone(b, 0.12, 0.45, midi(83), vol=0.3, decay=0.2)
    save('join.wav', b, peak=0.5)

    b = blank(0.5)  # someone left: falling chime
    tone(b, 0.0, 0.3, midi(79), vol=0.3, decay=0.12)
    tone(b, 0.12, 0.38, midi(72), vol=0.3, decay=0.16)
    save('leave.wav', b, peak=0.45)

    b = blank(0.12)  # UI tap
    tone(b, 0, 0.1, midi(84), vol=0.3, decay=0.03)
    save('tap.wav', b, peak=0.35)

    # Background music: a calm 16-bar loop in a pentatonic scale, soft pads + a plucked melody.
    bpm, bars = 84, 16
    beat = 60 / bpm
    length = bars * 4 * beat
    b = blank(length)
    chords = [(57, 64, 69), (53, 60, 65), (48, 55, 64), (55, 62, 67)]  # Am  F  C  G
    for bar in range(bars):
        root = chords[bar % 4]
        for n in root:
            tone(b, bar * 4 * beat, 4 * beat, midi(n), vol=0.05, attack=0.6, release=0.8)
        tone(b, bar * 4 * beat, 2 * beat, midi(root[0] - 12), vol=0.08, decay=1.2, release=0.3)
    rng = random.Random(42)
    scale = [69, 72, 74, 76, 79, 81, 84]
    note = 3
    for step in range(bars * 8):
        if rng.random() < 0.42:
            continue
        note = max(0, min(len(scale) - 1, note + rng.choice((-2, -1, -1, 1, 1, 2))))
        tone(b, step * beat / 2, beat * 0.9, midi(scale[note]), vol=0.09, decay=0.35, kind='tri', release=0.1)
    # Crossfade the tail into the head so the loop is seamless.
    fade = int(0.5 * RATE)
    for i in range(fade):
        w = i / fade
        b[i] = b[i] * w + b[len(b) - fade + i] * (1 - w)
    save('music.wav', b[: len(b) - fade], peak=0.5)


if __name__ == '__main__':
    main()
