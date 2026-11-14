"""Synthesises every sound in assets/sounds/ from scratch: no samples, so no third-party rights.

    python3 tools/gen_sounds.py

Pure standard library. Re-run after tweaking a sound.
"""
import array
import math
import os
import random
import sys
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
    if sys.argv[1:] == ['money']:  # just the money sounds (quick to iterate on)
        money_sounds()
        return
    if sys.argv[1:] == ['treasure']:  # just the treasure / chest sounds
        treasure_sounds()
        return
    if sys.argv[1:] == ['store']:  # just the 꿀알바 store street loop
        save('store.wav', store_music(), peak=0.45)
        return
    if sys.argv[1:] == ['intro']:  # just the launch intro stings
        intro_sounds()
        return
    if sys.argv[1:] == ['eerie']:  # just the 노란 방's small strange sounds
        eerie_sounds()
        return
    if sys.argv[1:] == ['places']:  # place music (maze, car park, castle) and the arrival stings
        place_sounds()
        return

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

    b = blank(1.6)  # gate: a rising shimmer that swells and fades
    for k, n in enumerate((60, 67, 72, 76, 79, 84)):
        tone(b, k * 0.07, 1.4 - k * 0.07, midi(n), vol=0.12, freq_end=midi(n + 12), attack=0.3, release=0.6)
    noise(b, 0, 1.5, vol=0.25, smooth=0.95, sweep=0.6, attack=0.4, release=0.8, seed=31)
    save('portal.wav', b, peak=0.6)

    b = blank(0.35)  # thruster puff in space
    noise(b, 0, 0.35, vol=0.5, smooth=0.9, sweep=0.97, attack=0.05, release=0.2, seed=41)
    save('thrust.wav', b, peak=0.35)

    b = blank(2.4)  # dragon roar: a growl whose pitch rises then falls, with rasp
    rng = random.Random(51)
    phase = 0.0
    for i in range(len(b)):
        t = i / RATE
        f = 70 + 90 * math.sin(math.pi * min(1, t / 2.2)) + 8 * math.sin(2 * math.pi * 23 * t)
        phase += f / RATE
        saw = 2 * (phase % 1.0) - 1
        level = min(1, t / 0.25) * max(0.0, min(1, (2.4 - t) / 0.8))
        b[i] += 0.5 * level * (saw * 0.7 + rng.uniform(-1, 1) * 0.35)
    # Smooth the rasp a little (one-pole low-pass).
    y = 0.0
    for i in range(len(b)):
        y += 0.25 * (b[i] - y)
        b[i] = y
    save('roar.wav', b, peak=0.8)

    b = blank(1.3)  # fire breath: a roaring whoosh
    noise(b, 0, 1.3, vol=0.8, smooth=0.6, sweep=0.85, attack=0.08, release=0.5, seed=61)
    noise(b, 0, 1.3, vol=0.3, smooth=0.97, attack=0.1, release=0.5, seed=62)
    save('fire.wav', b, peak=0.7)

    b = blank(1.4)  # explosion
    noise(b, 0, 1.4, vol=1.0, smooth=0.3, sweep=0.97, decay=0.35, seed=71)
    tone(b, 0, 0.9, 70, vol=0.6, freq_end=35, decay=0.3)
    save('boom.wav', b, peak=0.85)

    b = blank(3.0)  # earthquake rumble
    noise(b, 0, 3.0, vol=1.0, smooth=0.985, attack=0.4, release=1.2, seed=81)
    tone(b, 0, 3.0, 38, vol=0.4, attack=0.5, release=1.2)
    save('quake.wav', b, peak=0.8)

    b = blank(1.1)  # a flying car whooshing past: noise swelling and falling with a pitch drop
    noise(b, 0, 1.1, vol=0.8, smooth=0.75, sweep=0.93, attack=0.45, release=0.55, seed=91)
    tone(b, 0, 1.0, 420, vol=0.12, freq_end=180, attack=0.4, release=0.5)
    save('whoosh.wav', b, peak=0.6)

    b = blank(0.25)  # weapon swing: a quick bright swish
    noise(b, 0, 0.25, vol=0.6, smooth=0.4, sweep=0.85, attack=0.03, release=0.15, seed=101)
    tone(b, 0, 0.2, 900, vol=0.08, freq_end=500, release=0.1)
    save('swing.wav', b, peak=0.5)

    b = blank(0.35)  # ouch: a short falling buzz
    tone(b, 0, 0.3, 320, vol=0.4, freq_end=160, decay=0.12, kind='tri')
    noise(b, 0, 0.12, vol=0.2, smooth=0.5, decay=0.04, seed=111)
    save('hurt.wav', b, peak=0.6)

    b = blank(0.7)  # tamed: a happy little three-note arpeggio
    for k, n in enumerate((72, 76, 79, 84)):
        tone(b, k * 0.09, 0.35, midi(n), vol=0.25, decay=0.15)
    save('tame.wav', b, peak=0.55)

    zap_sound()
    money_sounds()
    treasure_sounds()
    intro_sounds()
    save('future.wav', future_music(), peak=0.5)
    save('space.wav', space_music(), peak=0.55)
    save('store.wav', store_music(), peak=0.45)


def zap_sound():
    """A laser zap: the drawn loop locks on before everything inside it blows up."""
    b = blank(0.45)
    tone(b, 0, 0.4, 1800, vol=0.3, freq_end=220, kind='tri', release=0.08)
    tone(b, 0, 0.4, 1810, vol=0.2, freq_end=230, release=0.08)
    noise(b, 0, 0.35, vol=0.18, smooth=0.2, decay=0.12, seed=31)
    save('zap.wav', b, peak=0.55)


def coin(buf, start, pitch=1.0, vol=0.3):
    """One coin: a bright, slightly inharmonic metallic ting with a tiny click."""
    for f, v, d in ((2093, 1.0, 0.16), (2637, 0.55, 0.12), (4186, 0.3, 0.07), (5590, 0.18, 0.05)):
        tone(buf, start, 0.35, f * pitch, vol=vol * v, decay=d, attack=0.001, release=0.05)
    noise(buf, start, 0.012, vol=vol * 0.5, smooth=0.1, decay=0.004, seed=int(start * 1000) + 7)


def money_sounds():
    """Earning and spending money."""
    b = blank(0.36)  # one coin, while drawing
    coin(b, 0, 1.0, 0.32)
    coin(b, 0.055, 1.335, 0.22)
    save('coin.wav', b, peak=0.5)

    b = blank(1.1)  # a shower of coins: a stroke paid out
    rng = random.Random(61)
    t = 0.0
    while t < 0.75:
        coin(b, t, rng.choice((0.94, 1.0, 1.06, 1.12, 1.19)), 0.16 + rng.random() * 0.1)
        t += 0.025 + rng.random() * 0.05
    save('coins.wav', b, peak=0.6)

    b = blank(2.0)  # jackpot: register "ka-ching", a flutter of notes, and a long coin rain
    noise(b, 0, 0.06, vol=0.6, smooth=0.3, decay=0.02, seed=71)          # drawer clack
    tone(b, 0, 0.08, 160, vol=0.4, freq_end=90, decay=0.03)
    for k, n in enumerate((84, 88, 91, 96)):                                   # bell
        tone(b, 0.08 + k * 0.012, 0.9, midi(n), vol=0.18, decay=0.35, attack=0.002)
    for k in range(9):                                                         # banknotes riffling
        noise(b, 0.15 + k * 0.045, 0.04, vol=0.22, smooth=0.6, sweep=0.2, decay=0.015, seed=80 + k)
    rng = random.Random(91)
    t = 0.25
    while t < 1.6:
        coin(b, t, rng.choice((0.9, 1.0, 1.06, 1.12, 1.19, 1.26)), 0.12 + rng.random() * 0.1)
        t += 0.018 + rng.random() * 0.035
    save('cash.wav', b, peak=0.62)

    b = blank(0.75)  # bought something: a rising sparkle ending on a ching
    for k, n in enumerate((72, 76, 79, 84, 88)):
        tone(b, k * 0.055, 0.32, midi(n), vol=0.2, decay=0.12, kind='tri', release=0.06)
    coin(b, 0.3, 1.0, 0.3)
    coin(b, 0.36, 1.335, 0.22)
    save('buy.wav', b, peak=0.55)

    b = blank(0.3)  # not enough money: a soft low double buzz
    tone(b, 0, 0.11, 196, vol=0.3, kind='tri', release=0.03)
    tone(b, 0.14, 0.13, 165, vol=0.3, kind='tri', release=0.04)
    save('deny.wav', b, peak=0.4)


def wobble(buf, start, length, f0, f1=None, vib=0.0, vib_rate=6.0, vol=0.3, harmonics=((1, 1.0),), attack=0.01, release=0.08, decay=None):
    """A note that slides from f0 to f1 with vibrato; `harmonics` makes it brassy or hollow."""
    i0, n, phase = int(start * RATE), int(length * RATE), 0.0
    f1 = f0 if f1 is None else f1
    for i in range(n):
        t = i / RATE
        f = f0 + (f1 - f0) * (t / length)
        f *= 1 + vib * math.sin(2 * math.pi * vib_rate * t)
        phase += f / RATE
        s = sum(v * math.sin(2 * math.pi * phase * h) for h, v in harmonics)
        level = env(t, length, attack, release) * (math.exp(-t / decay) if decay else 1.0)
        j = i0 + i
        if j < len(buf):
            buf[j] += vol * level * s


BRASS = ((1, 1.0), (2, 0.6), (3, 0.45), (4, 0.25), (5, 0.12))


def treasure_sounds():
    """Digging up treasure and the (deliberately silly) chest opening."""
    b = blank(1.5)  # drumroll building up while the chest shakes
    t, k = 0.0, 0
    while t < 1.35:
        lvl = 0.25 + 0.75 * (t / 1.35)
        noise(b, t, 0.05, vol=0.45 * lvl, smooth=0.25, decay=0.018, seed=200 + k)
        tone(b, t, 0.05, 190, vol=0.18 * lvl, freq_end=150, decay=0.02)
        t += 0.045 - 0.02 * (t / 1.35)
        k += 1
    save('drumroll.wav', b, peak=0.6)

    b = blank(0.55)  # "boing!": the lid pops off
    wobble(b, 0, 0.5, 180, 720, vib=0.18, vib_rate=22, vol=0.4, harmonics=((1, 1.0), (2, 0.3)), attack=0.004, release=0.15)
    noise(b, 0, 0.05, vol=0.4, smooth=0.2, decay=0.015, seed=231)
    save('pop.wav', b, peak=0.6)

    b = blank(1.7)  # ta-da-daaa fanfare
    for start, length, notes in ((0.0, 0.14, (72, 76)), (0.16, 0.14, (72, 76)), (0.32, 0.14, (72, 76)), (0.5, 1.1, (79, 84, 88))):
        for n in notes:
            wobble(b, start, length, midi(n), vib=0.006 if length > 0.5 else 0, vol=0.14, harmonics=BRASS, attack=0.015, release=0.12)
    for k in range(12):  # sparkle on the last chord
        tone(b, 0.55 + k * 0.07, 0.3, midi(96 + (k % 4) * 3), vol=0.05, decay=0.1, attack=0.002)
    save('fanfare.wav', b, peak=0.62)

    b = blank(2.3)  # sad trombone: wah, wah, wah, waaaah
    for k, (n, length) in enumerate(((67, 0.42), (66, 0.42), (65, 0.42), (64, 1.0))):
        start = k * 0.45
        wobble(b, start, length, midi(n) / 2, midi(n - (0.6 if k == 3 else 0)) / 2, vib=0.03 if k == 3 else 0.008,
               vib_rate=5.5, vol=0.3, harmonics=((1, 1.0), (2, 0.8), (3, 0.5), (4, 0.3), (6, 0.12)), attack=0.03, release=0.12)
    save('fail.wav', b, peak=0.6)

    b = blank(0.7)  # a gem: bright crystal arpeggio
    for k, n in enumerate((88, 91, 95, 100)):
        tone(b, k * 0.05, 0.45, midi(n), vol=0.18, decay=0.16, attack=0.001)
        tone(b, k * 0.05, 0.45, midi(n) * 2.01, vol=0.05, decay=0.08, attack=0.001)
    coin(b, 0.2, 1.5, 0.15)
    save('gem.wav', b, peak=0.55)

    b = blank(1.2)  # mystic effect: rising shimmer
    noise(b, 0, 1.0, vol=0.2, smooth=0.95, sweep=0.4, attack=0.3, release=0.4)
    wobble(b, 0, 1.0, 330, 990, vib=0.02, vib_rate=9, vol=0.12, harmonics=((1, 1.0), (1.5, 0.5), (2, 0.3)), attack=0.2, release=0.4)
    rng = random.Random(251)
    for k in range(16):
        tone(b, 0.1 + rng.random() * 0.9, 0.2, midi(rng.choice((96, 98, 100, 103, 105))), vol=0.06, decay=0.06, attack=0.001)
    save('magic.wav', b, peak=0.55)


def loop_crossfade(b, seconds=0.6):
    fade = int(seconds * RATE)
    for i in range(fade):
        w = i / fade
        b[i] = b[i] * w + b[len(b) - fade + i] * (1 - w)
    return b[: len(b) - fade]


def future_music():
    """City at night: a driving 16th-note arpeggio over warm pads and a soft pulse (original)."""
    bpm = 100
    beat = 60 / bpm
    bars = 16
    b = blank(bars * 4 * beat + 0.6)
    prog = [(57, [57, 60, 64, 67]), (53, [53, 57, 60, 64]), (55, [55, 59, 62, 67]), (52, [52, 55, 59, 62])]
    for bar in range(bars):
        root, notes = prog[(bar // 2) % 4]
        t0 = bar * 4 * beat
        for n in notes:
            tone(b, t0, 4 * beat, midi(n), vol=0.035, attack=0.5, release=0.6)
        for q in range(4):
            tone(b, t0 + q * beat, beat * 0.9, midi(root - 24), vol=0.12, decay=0.25, release=0.05)
        for i in range(16):
            n = notes[i % 4] + (12 if (i // 4) % 2 else 0)
            tone(b, t0 + i * beat / 4, beat / 4 * 0.9, midi(n + 12), vol=0.05, decay=0.08, kind='tri', release=0.02)
    return loop_crossfade(b)


def store_music():
    """The 24h store at 3 a.m.: a fridge hum, a faint tube buzz, vinyl crackle and a lazy, slightly
    off lo-fi electric piano (original)."""
    chord_len = 4.0
    chords = [(50, 57, 60, 65), (48, 55, 59, 64), (46, 53, 57, 62), (45, 52, 55, 61)]
    total = len(chords) * chord_len * 2
    b = blank(total + 0.8)
    tone(b, 0, total + 0.8, 60, vol=0.05, attack=0.5, release=0.5)  # compressor hum
    tone(b, 0, total + 0.8, 120, vol=0.012, kind='tri', attack=0.5, release=0.5)  # tube buzz
    noise(b, 0, total + 0.8, vol=0.012, smooth=0.97, attack=0.5, release=0.5, seed=401)
    rng = random.Random(402)
    for _ in range(int(total * 5)):  # crackle
        noise(b, rng.random() * total, 0.004, vol=0.05 * rng.random(), smooth=0.1, decay=0.002, seed=rng.randint(0, 9999))
    for rep in range(2):
        for i, ch in enumerate(chords):
            t0 = (rep * len(chords) + i) * chord_len
            for k, n in enumerate(ch):  # a lazy strum, each note a hair late
                for mult, amp in ((1, 1.0), (2, 0.35), (3, 0.12)):
                    tone(b, t0 + k * 0.045, chord_len * 0.95, midi(n) * mult * 1.003, vol=0.03 * amp, decay=1.6, attack=0.01, release=0.3)
            tone(b, t0, chord_len, midi(ch[0] - 12), vol=0.07, decay=1.2, release=0.3)
            mel = rng.choice(ch[1:]) + 12
            tone(b, t0 + 2.0 + rng.choice((0, 0.25, 0.5)), 1.2, midi(mel), vol=0.025, decay=0.5, release=0.3)
    return loop_crossfade(b, 0.8)


def organ(buf, start, length, freq, vol):
    """A breathy, organ-like tone: a few harmonics with a very slow swell."""
    for mult, amp in ((1, 1.0), (2, 0.5), (3, 0.22), (4, 0.18), (6, 0.06)):
        tone(buf, start, length, freq * mult, vol=vol * amp, attack=length * 0.45, release=length * 0.45)


def space_music():
    """Vast and slow: swelling organ chords, a deep sub drone, and sparse high bells (original)."""
    chord_len = 8.0
    chords = [(45, 52, 57, 59, 64), (41, 48, 57, 60, 67), (38, 50, 57, 62, 65), (40, 52, 56, 59, 64),
              (45, 52, 60, 64, 71), (43, 50, 59, 62, 69), (41, 53, 57, 60, 65), (40, 47, 56, 59, 64)]
    b = blank(len(chords) * chord_len + 2.0)
    for i, ch in enumerate(chords):
        t0 = i * chord_len
        for n in ch:
            organ(b, t0, chord_len + 1.6, midi(n), 0.035)
        tone(b, t0, chord_len + 1.6, midi(ch[0] - 12), vol=0.12, attack=3.0, release=3.0)
    rng = random.Random(7)
    t = 1.0
    while t < len(chords) * chord_len - 2:
        ch = chords[int(t // chord_len)]
        n = rng.choice(ch[2:]) + 24
        tone(b, t, 3.0, midi(n), vol=0.05, decay=1.0, release=1.5)
        tone(b, t + 0.37, 3.0, midi(n), vol=0.02, decay=1.0, release=1.5)  # a soft echo
        t += rng.choice((1.5, 2.25, 3.0, 4.5))
    return loop_crossfade(b, 1.5)



# Launch intro: letter blocks drop one by one ("tok"), then the logo slams in. The timings MUST match
# INTRO_TIMING in src/ui/intro.tsx, because the animation is synced to this one file.
INTRO_TIMING = {'intro.wav': (0.15, 0.075), 'intro_short.wav': (0.05, 0.022)}  # (first drop, gap)
INTRO_FALL = 0.32    # seconds a block takes to fall
INTRO_TILES = 11     # "VOXEL" + "VALLEY"
INTRO_SLAM_AFTER = 0.10  # slam this long after the last block lands
INTRO_NOTES = (55, 57, 60, 62, 64, 67, 69, 72, 74, 76, 79)  # rising pentatonic, one per block


def intro_sounds():
    for name, (first, gap) in INTRO_TIMING.items():
        lands = [first + i * gap + INTRO_FALL for i in range(INTRO_TILES)]
        slam = lands[-1] + INTRO_SLAM_AFTER
        b = blank(slam + 1.6)
        # a breathy rise while the blocks rain down, cut off by the slam
        noise(b, first, slam - first, vol=0.22, smooth=0.9, sweep=0.55, attack=slam - first - 0.02, release=0.02, seed=211)
        for k, t in enumerate(lands):  # each block: a woody "tok" with a little thump under it
            n = INTRO_NOTES[k]
            tone(b, t, 0.16, midi(n), vol=0.3, freq_end=midi(n) * 0.82, decay=0.045, kind='tri', attack=0.001)
            tone(b, t, 0.08, 150, vol=0.35, freq_end=85, decay=0.025, attack=0.001)
            noise(b, t, 0.02, vol=0.25, smooth=0.25, decay=0.006, seed=300 + k)
        # the slam: a sub drop, a crunchy burst, a big bright chord and a sparkle on top
        tone(b, slam, 0.7, 95, vol=0.9, freq_end=36, decay=0.22, attack=0.002)
        noise(b, slam, 0.45, vol=0.55, smooth=0.6, sweep=0.9, decay=0.09, seed=333)
        for n in (48, 60, 64, 67, 72):
            tone(b, slam, 1.5, midi(n), vol=0.13, decay=0.55, kind='tri', attack=0.003, release=0.3)
            tone(b, slam, 1.5, midi(n) * 1.004, vol=0.07, decay=0.6, attack=0.01, release=0.3)
        for k, n in enumerate((84, 88, 91, 96, 100)):
            tone(b, slam + 0.1 + k * 0.06, 0.5, midi(n), vol=0.1, decay=0.14, attack=0.002)
        save(name, b, peak=0.8)


# ───────────── Places: the dark worlds, the castle, and a sting for arriving anywhere (all original) ─────────────

def whisper(buf, start, length, vol=0.05, seed=1):
    """Breathy syllables with no words: short bursts of airy noise in an uneven rhythm."""
    rng = random.Random(seed)
    t = start
    while t < start + length:
        d = rng.uniform(0.07, 0.18)
        noise(buf, t, d, vol=vol * rng.uniform(0.5, 1.0), smooth=rng.uniform(0.15, 0.35), attack=d * 0.4, release=d * 0.5, seed=rng.randint(0, 99999))
        t += d + rng.choice((0.02, 0.04, 0.09, 0.25))


def creak(buf, start, vol=0.12, seed=1):
    """An old floorboard or door hinge taking weight, slowly."""
    rng = random.Random(seed)
    f0 = rng.uniform(170, 260)
    length = rng.uniform(0.7, 1.4)
    wobble(buf, start, length, f0, f0 * rng.uniform(0.6, 0.8), vib=0.08, vib_rate=rng.uniform(14, 22), vol=vol,
           harmonics=((1, 1.0), (2, 0.7), (3, 0.5), (5, 0.3)), attack=0.15, release=0.25)
    noise(buf, start, length, vol=vol * 0.3, smooth=0.6, attack=0.1, release=0.2, seed=seed + 7)


def thud(buf, start, vol=0.4, double=False):
    """Something heavy, far off, behind a wall."""
    tone(buf, start, 0.5, 62, vol=vol, freq_end=34, decay=0.16, attack=0.004)
    noise(buf, start, 0.12, vol=vol * 0.3, smooth=0.9, decay=0.05, seed=int(start * 100))
    if double:
        tone(buf, start + 0.28, 0.45, 58, vol=vol * 0.7, freq_end=32, decay=0.15, attack=0.004)


def tube_hum(buf, start, length, vol=0.05, base=120.0, seed=1):
    """A fluorescent tube at full hum-buzz: mains-hum harmonics, a fizz, and an uneven waver."""
    BUZZ = ((1, 1.0), (2, 0.7), (3, 0.55), (4, 0.4), (5, 0.3), (7, 0.18), (9, 0.1))
    wobble(buf, start, length, base, base, vib=0.002, vib_rate=0.31, vol=vol, harmonics=BUZZ, attack=1.0, release=1.0)
    wobble(buf, start, length, base * 1.004, base * 1.004, vib=0.003, vib_rate=0.17, vol=vol * 0.6, harmonics=BUZZ, attack=1.0, release=1.0)
    noise(buf, start, length, vol=vol * 0.12, smooth=0.15, attack=1.0, release=1.0, seed=seed)  # the fizz


def maze_music():
    """노란 방: nothing but the panels' hum-buzz, the dead air of an empty office floor, a ballast
    ticking somewhere, and now and then something heavy far off behind the walls (original)."""
    total = 44.0
    b = blank(total + 1.0)
    tube_hum(b, 0, total + 1, vol=0.06, seed=801)
    noise(b, 0, total + 1, vol=0.05, smooth=0.985, attack=2.0, release=2.0, seed=802)  # room tone
    for t0, length in ((6.0, 10.0), (27.0, 12.0)):  # a second tube somewhere joins in, slightly out of tune
        tube_hum(b, t0, length, vol=0.025, base=123.5, seed=int(t0 * 10))
    rng = random.Random(803)
    t = 2.0
    while t < total - 1:  # a failing ballast ticking, in uneven little runs
        for k in range(rng.randint(1, 4)):
            noise(b, t + k * 0.09, 0.012, vol=0.08, smooth=0.1, decay=0.004, seed=rng.randint(0, 9999))
        t += rng.uniform(3.0, 7.5)
    for t, dbl in ((13.6, False), (35.0, True)):
        thud(b, t, vol=0.25, double=dbl)
    for t in (21.3, 40.2):
        creak(b, t, vol=0.06, seed=int(t * 10))
    return loop_crossfade(b, 1.0)


def lampoff():
    """A panel dying behind you: the relay's clack, a buzz that sags and stutters out."""
    b = blank(0.9)
    noise(b, 0, 0.03, vol=0.7, smooth=0.3, decay=0.008, seed=881)
    tone(b, 0, 0.05, 1800, vol=0.15, decay=0.01, attack=0.001)
    for k, (t, length) in enumerate(((0.04, 0.16), (0.26, 0.08), (0.4, 0.3))):
        wobble(b, t, length, 120 - k * 6, 96 - k * 10, vib=0.004, vib_rate=9, vol=0.22 - k * 0.05,
               harmonics=((1, 1.0), (2, 0.7), (3, 0.5), (5, 0.3)), attack=0.005, release=length * 0.6)
    return b


def parking_under_music():
    """The car park below the street: tube hum, the ventilation, drips that echo, a door far off."""
    total = 34.0
    b = blank(total + 1.0)
    tone(b, 0, total + 1, 100, vol=0.045, attack=1.0, release=1.0)
    tone(b, 0, total + 1, 200, vol=0.018, kind='tri', attack=1.0, release=1.0)
    noise(b, 0, total + 1, vol=0.06, smooth=0.975, attack=1.0, release=1.0, seed=811)
    noise(b, 0, total + 1, vol=0.006, smooth=0.2, attack=1.0, release=1.0, seed=812)  # the tubes' fizz
    rng = random.Random(813)
    t = 1.0
    while t < total - 1:
        f = midi(rng.choice((86, 88, 91, 93, 96)))
        for k, (dt, v) in enumerate(((0, 0.06), (0.21, 0.025), (0.42, 0.01))):
            tone(b, t + dt, 0.12, f * (1 - 0.02 * k), vol=v, freq_end=f * 1.25, decay=0.03, attack=0.001)
        t += rng.uniform(1.4, 4.5)
    for k, (dt, v) in enumerate(((0, 0.3), (0.38, 0.14), (0.76, 0.06), (1.14, 0.025))):  # a fire door, far away
        tone(b, 15.0 + dt, 0.6, 70, vol=v, freq_end=42, decay=0.14, attack=0.003)
        noise(b, 15.0 + dt, 0.15, vol=v * 0.4, smooth=0.8, decay=0.05, seed=820 + k)
    noise(b, 26.0, 1.6, vol=0.035, smooth=0.25, sweep=0.55, attack=0.4, release=0.8, seed=821)  # tyres squealing two floors down
    wobble(b, 26.0, 1.6, 1150, 820, vol=0.012, attack=0.4, release=0.8)
    return loop_crossfade(b, 1.0)


def parking_music():
    """The car park in the open: night wind through the levels, the city's far hum, a lonely pad."""
    total = 36.0
    b = blank(total + 1.0)
    rng = random.Random(831)
    t = 0.0
    while t < total:  # gusts
        d = rng.uniform(3.0, 6.0)
        noise(b, t, d + 1.5, vol=rng.uniform(0.04, 0.09), smooth=rng.uniform(0.94, 0.98), attack=d * 0.5, release=d * 0.5, seed=rng.randint(0, 9999))
        t += d
    tone(b, 0, total + 1, 55, vol=0.035, attack=2.0, release=2.0)
    for i, ch in enumerate(((45, 52, 57, 60), (41, 48, 57, 60), (43, 50, 55, 59))):
        for n in ch:
            organ(b, i * 12.0, 13.0, midi(n), 0.012)
    for t in (9.5, 27.0):  # a horn somewhere in the city
        tone(b, t, 0.7, midi(64), vol=0.012, attack=0.03, release=0.3)
        tone(b, t, 0.7, midi(68), vol=0.009, attack=0.03, release=0.3)
    return loop_crossfade(b, 1.5)


def castle_music():
    """달빛 첨탑성 at night: slow minor organ and a wordless choir, with a bell now and then."""
    chord_len = 6.0
    chords = [(45, 57, 60, 64), (41, 57, 60, 65), (38, 53, 57, 62), (40, 52, 56, 59)]
    b = blank(len(chords) * chord_len * 2 + 2.0)
    for rep in range(2):
        for i, ch in enumerate(chords):
            t0 = (rep * len(chords) + i) * chord_len
            for n in ch:
                organ(b, t0, chord_len + 1.2, midi(n), 0.028)
            for n in ch[1:]:  # the choir: vowel-ish harmonics with a slow vibrato
                wobble(b, t0 + 0.2, chord_len, midi(n + 12), vib=0.006, vib_rate=4.5, vol=0.012,
                       harmonics=((1, 1.0), (2, 0.5), (3, 0.35), (4, 0.1)), attack=1.8, release=1.6)
            if i % 2 == 0:
                for mult, amp in ((1, 1.0), (2.76, 0.5), (5.4, 0.25)):  # a bell's inharmonic partials
                    tone(b, t0, 4.0, midi(ch[0]) * mult, vol=0.06 * amp, decay=1.4, attack=0.002)
    return loop_crossfade(b, 1.2)


def arrival_stings():
    b = blank(1.8)  # the valley: birds and a bright little arpeggio
    for k, n in enumerate((72, 76, 79, 84)):
        tone(b, 0.05 + k * 0.09, 0.9, midi(n), vol=0.12, decay=0.35, kind='tri', attack=0.003)
    rng = random.Random(851)
    for k in range(6):
        t = 0.3 + k * 0.17 + rng.uniform(0, 0.05)
        wobble(b, t, 0.09, rng.uniform(2600, 3400), rng.uniform(3600, 4200), vol=0.05, attack=0.005, release=0.03)
    save('arrive_valley.wav', loud(b, 0.8), peak=0.8)

    b = blank(1.6)  # the future city: a synth sweep up and a digital chime
    tone(b, 0, 0.7, 180, vol=0.25, freq_end=1500, kind='tri', attack=0.05, release=0.1)
    for k, n in enumerate((84, 91)):
        tone(b, 0.6 + k * 0.12, 0.8, midi(n), vol=0.12, decay=0.3, attack=0.002)
        tone(b, 0.6 + k * 0.12, 0.8, midi(n) * 2, vol=0.04, decay=0.2, attack=0.002)
    save('arrive_future.wav', loud(b, 0.8), peak=0.8)

    b = blank(2.6)  # space: a vast whoosh and a low swell
    noise(b, 0, 2.2, vol=0.5, smooth=0.6, sweep=0.95, attack=0.3, release=1.2, seed=861)
    tone(b, 0.2, 2.3, 55, vol=0.4, attack=0.9, release=1.0)
    tone(b, 0.2, 2.3, 82.4, vol=0.18, attack=1.1, release=1.0)
    save('arrive_space.wav', b, peak=0.75)

    b = blank(2.2)  # the 24h store: an automatic door's two-tone chime (an original interval)
    for t, n in ((0.0, 88), (0.42, 83)):
        for mult, amp in ((1, 1.0), (2, 0.3), (3.01, 0.12)):
            tone(b, t, 1.5, midi(n) * mult, vol=0.18 * amp, decay=0.55, attack=0.002)
    save('arrive_store.wav', loud(b, 0.8), peak=0.8)

    b = blank(3.0)  # 노란 방: a heavy switch, then the panels stutter on one after another and settle into the hum
    noise(b, 0, 0.04, vol=0.8, smooth=0.3, decay=0.01, seed=871)
    tone(b, 0, 0.3, 70, vol=0.6, freq_end=45, decay=0.1, attack=0.002)
    for k, t in enumerate((0.25, 0.5, 0.62, 0.95, 1.15)):
        noise(b, t, 0.02, vol=0.35, smooth=0.2, decay=0.006, seed=872 + k)
        tube_hum(b, t, 3.0 - t, vol=0.05 + 0.012 * k, base=120.0 + k * 0.7, seed=880 + k)
    save('arrive_maze.wav', b, peak=0.9)

    b = blank(3.0)  # the car park: a heavy steel door slams and rings through the concrete, the tubes flicker on
    for k, (dt, v) in enumerate(((0, 1.0), (0.33, 0.45), (0.66, 0.2), (0.99, 0.09))):
        for f, a in ((180, 1.0), (237, 0.7), (311, 0.5), (412, 0.35), (553, 0.2)):
            tone(b, dt, 1.1, f * (1 - 0.01 * k), vol=0.12 * v * a, decay=0.35, attack=0.002)
        noise(b, dt, 0.08, vol=0.4 * v, smooth=0.5, decay=0.02, seed=880 + k)
    for k, t in enumerate((1.3, 1.42, 1.75, 1.83)):
        tone(b, t, 0.03, 3100 + 200 * k, vol=0.08, decay=0.01, attack=0.001)
    tone(b, 1.8, 1.1, 100, vol=0.1, attack=0.25, release=0.5)
    save('arrive_parking.wav', loud(b, 0.9), peak=0.9)

    b = blank(1.6)
    creak(b, 0.05, vol=0.3, seed=891)
    save('creak.wav', b, peak=0.7)


def loud(buf, peak):
    """Scales a buffer so its loudest sample sits at `peak` (save() only ever turns things down)."""
    m = max(1e-9, max(abs(v) for v in buf))
    return [v * peak / m for v in buf]


def eerie_sounds():
    """Small sounds for the 노란 방, played quietly now and then from nowhere in particular."""
    b = blank(3.2)  # footsteps somewhere behind you, slow, then they stop
    for k, t in enumerate((0.0, 0.62, 1.22, 1.86, 2.5)):
        tone(b, t, 0.16, 95 - k * 3, vol=0.5, freq_end=60, decay=0.05, attack=0.002)
        noise(b, t, 0.09, vol=0.25, smooth=0.75, decay=0.03, seed=930 + k)
        noise(b, t + 0.21, 0.06, vol=0.06, smooth=0.8, decay=0.02, seed=940 + k)  # its echo
    save('eerie_steps.wav', loud(b, 0.8), peak=0.8)

    b = blank(2.0)  # three knocks inside the wall
    for k, t in enumerate((0.0, 0.32, 0.64)):
        tone(b, t, 0.22, 140, vol=0.6, freq_end=90, decay=0.05, attack=0.001)
        noise(b, t, 0.05, vol=0.35, smooth=0.55, decay=0.015, seed=950 + k)
    save('eerie_knock.wav', loud(b, 0.8), peak=0.8)

    b = blank(3.4)  # someone breathing, close, behind your ear
    for k, (t, d) in enumerate(((0.0, 1.2), (1.6, 1.4))):
        noise(b, t, d, vol=0.3, smooth=0.55 if k == 0 else 0.62, attack=d * 0.55, release=d * 0.4, seed=960 + k)
    save('eerie_breath.wav', loud(b, 0.75), peak=0.75)

    b = blank(2.6)  # a whisper with no words
    whisper(b, 0.05, 2.2, vol=0.3, seed=970)
    save('eerie_whisper.wav', loud(b, 0.75), peak=0.75)

    b = blank(2.8)  # a door far away, eased shut, then the latch
    creak(b, 0.0, vol=0.25, seed=980)
    tone(b, 1.35, 0.4, 78, vol=0.5, freq_end=48, decay=0.12, attack=0.003)
    tone(b, 1.55, 0.06, 1800, vol=0.12, decay=0.02, attack=0.001)
    save('eerie_door.wav', loud(b, 0.75), peak=0.75)

    b = blank(2.4)  # a radio somewhere between stations, and for a moment almost a voice
    noise(b, 0, 2.3, vol=0.25, smooth=0.1, attack=0.3, release=0.6, seed=990)
    wobble(b, 0.8, 0.7, 330, 300, vib=0.05, vib_rate=5.5, vol=0.06, harmonics=((1, 1.0), (2, 0.6), (3, 0.4)), attack=0.1, release=0.2)
    save('eerie_static.wav', loud(b, 0.7), peak=0.7)


def place_sounds():
    save('maze.wav', loud(maze_music(), 0.8), peak=0.8)
    save('lampoff.wav', lampoff(), peak=0.7)
    save('parking_under.wav', loud(parking_under_music(), 0.7), peak=0.7)
    save('parking.wav', loud(parking_music(), 0.6), peak=0.6)
    save('castle.wav', loud(castle_music(), 0.55), peak=0.55)
    arrival_stings()
    eerie_sounds()


if __name__ == '__main__':
    main()
