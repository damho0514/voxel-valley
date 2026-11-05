"""Draws the app icon (a "V" of coloured blocks on a dusk-teal tile) with no
dependencies and writes the PWA / iOS home-screen sizes.

    python3 tools/make_icons.py
"""
import math
import os
import random
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), '..', 'Assets', 'WebGLTemplates', 'VoxelValley', 'icons')
N = 512


def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)


def draw():
    """Sky tile with a "V" stacked from rounded blocks in the avatar colours."""
    img = [0] * (N * N * 4)
    for y in range(N):
        t = y / N
        r, g, b = int(43 + 30 * t), int(69 + 60 * t), int(82 + 80 * t)
        for x in range(N):
            img[(y * N + x) * 4:(y * N + x) * 4 + 4] = [r, g, b, 255]

    palette = [(242, 115, 64), (66, 153, 245), (171, 71, 188), (255, 202, 40), (38, 166, 154), (236, 64, 122)]
    cell = N // 9
    # Block grid (col, row) forming a V, bottom row = tip.
    blocks = []
    for row in range(5):
        offset = row // 1
        blocks.append((1 + offset * 0.75, 1.2 + row))
        blocks.append((7 - offset * 0.75, 1.2 + row))
    blocks = blocks[:-1]  # the two arms meet in one tip block
    blocks.append((4, 5.2))

    def rounded(x0, y0, size, color, radius, shade=1.0, alpha=1.0):
        for y in range(int(y0), int(y0 + size)):
            for x in range(int(x0), int(x0 + size)):
                if not (0 <= x < N and 0 <= y < N):
                    continue
                dx = max(x0 + radius - x, 0, x - (x0 + size - radius))
                dy = max(y0 + radius - y, 0, y - (y0 + size - radius))
                if dx * dx + dy * dy > radius * radius:
                    continue
                # Lighter top edge for a bit of depth.
                k = shade * (1.15 if y - y0 < size * 0.18 else 1.0)
                i = (y * N + x) * 4
                for c in range(3):
                    v = min(255, int(color[c] * k))
                    img[i + c] = int(img[i + c] * (1 - alpha) + v * alpha)

    for n, (col, row) in enumerate(blocks):
        x0, y0 = col * cell - cell * 0.5 + cell * 0.5, row * cell
        rounded(x0 + cell * 0.08, y0 + cell * 0.12, cell * 0.92, (0, 0, 0), cell * 0.22, alpha=0.25)  # shadow
        rounded(x0, y0, cell * 0.92, palette[n % len(palette)], cell * 0.22)
    return img


def downscale(src, n):
    out = [0] * (n * n * 4)
    f = N / n
    for y in range(n):
        for x in range(n):
            acc = [0, 0, 0, 0]
            cnt = 0
            for yy in range(int(y * f), int((y + 1) * f)):
                for xx in range(int(x * f), int((x + 1) * f)):
                    i = (yy * N + xx) * 4
                    for c in range(4):
                        acc[c] += src[i + c]
                    cnt += 1
            out[(y * n + x) * 4:(y * n + x) * 4 + 4] = [v // cnt for v in acc]
    return out


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    big = draw()
    png(os.path.join(OUT, 'icon-512.png'), N, N, big)
    for size in (192, 180):
        png(os.path.join(OUT, f'icon-{size}.png'), size, size, downscale(big, size))
    print('icons written to', os.path.normpath(OUT))
