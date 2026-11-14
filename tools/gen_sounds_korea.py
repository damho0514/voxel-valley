"""The reward sounds, in a Korean market / 풍물 style, synthesised from scratch (no samples):

    python3 tools/gen_sounds_korea.py

Overwrites coin, coins, cash, drumroll, pop, fanfare, fail and gem in assets/sounds/ (same names,
so the game needs no other change). Uses the helpers in gen_sounds.py.
  coin      엽전 두 닢이 부딪는 짤랑
  coins     엽전 꾸러미 흔드는 소리
  cash      복주머니가 툭 터지고 꽹과리 한 번, 엽전이 쏟아짐
  drumroll  장구: 덩 … 기덕 … 점점 빨라지는 덕덕덕 → 덩!
  pop       반닫이 앞판이 덜컥 열리고 장석이 찰랑
  fanfare   꽹과리 갱 갱 개갱 + 징 ~~~
  fail      쪽박: 빈 바가지 똑, 똑 … 김빠지는 피리
  gem       풍경 (처마 끝 바람 종)
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
from gen_sounds import RATE, blank, noise, save, tone  # noqa: E402


def brass_clink(buf, start, pitch=1.0, vol=0.3):
    """One 엽전 against another: duller and more inharmonic than a gold coin, very short."""
    for f, v, d in ((1480, 1.0, 0.07), (2390, 0.7, 0.05), (3720, 0.45, 0.035), (5260, 0.25, 0.02)):
        tone(buf, start, 0.2, f * pitch, vol=vol * v, decay=d, attack=0.0008, release=0.03)
    noise(buf, start, 0.01, vol=vol * 0.6, smooth=0.05, decay=0.003, seed=int(start * 977) + 3)


def kkwaenggwari(buf, start, vol=0.3, damp=0.09):
    """꽹과리: a small brass gong struck hard — a bright, clangy 갱."""
    for f, v in ((880, 1.0), (1322, 0.8), (1978, 0.7), (2710, 0.5), (3530, 0.35), (4420, 0.2)):
        tone(buf, start, damp * 5, f * (1 + (random.random() - 0.5) * 0.01), vol=vol * v, decay=damp, attack=0.0008, release=0.05)
    noise(buf, start, 0.02, vol=vol * 0.7, smooth=0.05, decay=0.006, seed=int(start * 1000) + 41)


def jing(buf, start, vol=0.35, length=2.0):
    """징: a big gong — a low hum with a slow beat between two close partials, long tail."""
    for f, v, d in ((108, 1.0, 1.1), (110.6, 0.8, 1.0), (216, 0.45, 0.7), (298, 0.3, 0.5), (433, 0.15, 0.35)):
        tone(buf, start, length, f, vol=vol * v, decay=d, attack=0.025, release=0.3)
    noise(buf, start, 0.08, vol=vol * 0.25, smooth=0.6, decay=0.03, seed=91)  # the mallet's soft thud


def deong(buf, start, vol=0.4):
    """장구 덩: the big left drumhead (deep, pitch dropping) with a slap of the right."""
    tone(buf, start, 0.32, 118, vol=vol, freq_end=72, decay=0.12, attack=0.002)
    tone(buf, start, 0.2, 236, vol=vol * 0.3, freq_end=150, decay=0.05, attack=0.002)
    noise(buf, start, 0.05, vol=vol * 0.55, smooth=0.25, decay=0.012, seed=int(start * 1000) + 5)


def deok(buf, start, vol=0.3):
    """장구 덕 / 기덕: the thin stick on the right head — a dry, bright crack."""
    noise(buf, start, 0.035, vol=vol, smooth=0.12, decay=0.008, seed=int(start * 1000) + 9)
    tone(buf, start, 0.06, 620, vol=vol * 0.45, freq_end=480, decay=0.015, attack=0.001)


def main():
    random.seed(7)

    b = blank(0.3)
    brass_clink(b, 0, 1.0, 0.32)
    brass_clink(b, 0.045, 1.21, 0.22)
    save('coin.wav', b, peak=0.5)

    b = blank(0.95)  # a string of 엽전 shaken
    rng = random.Random(61)
    t = 0.0
    while t < 0.7:
        brass_clink(b, t, rng.choice((0.88, 0.94, 1.0, 1.07, 1.15)), 0.12 + rng.random() * 0.12)
        t += 0.02 + rng.random() * 0.045
    noise(b, 0, 0.7, vol=0.05, smooth=0.55, attack=0.05, release=0.2, seed=62)  # the cord rustling
    save('coins.wav', b, peak=0.6)

    b = blank(2.0)  # 복주머니: the knot gives, one 꽹과리 hit, then a pour of coins
    noise(b, 0, 0.12, vol=0.4, smooth=0.75, decay=0.04, seed=71)  # silk puff
    tone(b, 0, 0.1, 140, vol=0.3, freq_end=90, decay=0.04)
    kkwaenggwari(b, 0.06, vol=0.26, damp=0.12)
    rng = random.Random(91)
    t = 0.18
    while t < 1.55:
        brass_clink(b, t, rng.choice((0.85, 0.92, 1.0, 1.08, 1.16, 1.25)), 0.1 + rng.random() * 0.12)
        t += 0.016 + rng.random() * 0.03
    save('cash.wav', b, peak=0.62)

    b = blank(1.55)  # 장구 build-up while the chest rattles
    deong(b, 0.0, 0.42)
    deok(b, 0.24, 0.28)
    deok(b, 0.33, 0.24)  # 기덕
    deong(b, 0.48, 0.36)
    t, k = 0.66, 0
    while t < 1.36:
        lvl = 0.4 + 0.6 * (t - 0.66) / 0.7
        deok(b, t, 0.3 * lvl)
        if k % 4 == 0:
            tone(b, t, 0.12, 120, vol=0.18 * lvl, freq_end=90, decay=0.05)
        t += 0.085 - 0.05 * (t - 0.66) / 0.7
        k += 1
    deong(b, 1.38, 0.5)
    save('drumroll.wav', b, peak=0.62)

    b = blank(0.5)  # 덜컥: a wooden flap drops, the brass fittings ring
    tone(b, 0, 0.12, 210, vol=0.45, freq_end=140, decay=0.04, attack=0.001)
    noise(b, 0, 0.06, vol=0.45, smooth=0.35, decay=0.015, seed=231)
    tone(b, 0.07, 0.1, 170, vol=0.3, freq_end=120, decay=0.03, attack=0.001)
    brass_clink(b, 0.09, 0.8, 0.2)
    brass_clink(b, 0.13, 1.05, 0.14)
    save('pop.wav', b, peak=0.6)

    b = blank(2.4)  # 꽹과리 갱 갱 개갱 — then the 징
    for at, v in ((0.0, 0.3), (0.16, 0.26), (0.32, 0.22), (0.4, 0.3)):
        kkwaenggwari(b, at, vol=v, damp=0.07)
    kkwaenggwari(b, 0.56, vol=0.34, damp=0.22)
    jing(b, 0.56, vol=0.42, length=1.8)
    save('fanfare.wav', b, peak=0.64)

    b = blank(1.5)  # 쪽박: two hollow knocks on an empty gourd, then a deflating 피리
    for at in (0.0, 0.22):
        tone(b, at, 0.16, 330, vol=0.4, freq_end=290, decay=0.04, attack=0.001)
        tone(b, at, 0.16, 760, vol=0.12, decay=0.02, attack=0.001)
        noise(b, at, 0.02, vol=0.2, smooth=0.3, decay=0.006, seed=300 + int(at * 100))
    i0, n = int(0.48 * RATE), int(0.85 * RATE)  # breathy reed sliding down with a wobble
    phase = 0.0
    for i in range(n):
        tt = i / RATE
        f = 620 * (430 / 620) ** (tt / 0.85) * (1 + 0.02 * math.sin(2 * math.pi * 6 * tt))
        phase += f / RATE
        lvl = min(1, tt / 0.04) * min(1, (0.85 - tt) / 0.25)
        b[i0 + i] += 0.16 * lvl * (math.sin(2 * math.pi * phase) + 0.35 * math.sin(4 * math.pi * phase))
    noise(b, 0.48, 0.85, vol=0.05, smooth=0.5, attack=0.04, release=0.25, seed=311)
    save('fail.wav', b, peak=0.55)

    b = blank(1.3)  # 풍경: the little bell under the eaves, struck twice by the wind
    for at, p, v in ((0.0, 1.0, 0.24), (0.32, 1.12, 0.15)):
        for f, vv, d in ((1320, 1.0, 0.5), (3170, 0.5, 0.25), (5150, 0.25, 0.12), (7130, 0.12, 0.06)):
            tone(b, at, 0.95, f * p, vol=v * vv, decay=d, attack=0.0008, release=0.2)
    save('gem.wav', b, peak=0.55)


if __name__ == '__main__':
    main()
