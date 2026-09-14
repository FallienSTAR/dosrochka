"""Rasterize the bot avatar (same geometry as assets/bot-avatar.svg) to PNG without third-party libs."""
import math
import struct
import sys
import zlib

S = 640
SS = 3  # supersampling per axis
BLUE = (0x2B, 0x45, 0xC8)
WHITE = (255, 255, 255)
GREEN = (0x3F, 0xCB, 0x93)

img = [list(BLUE) for _ in range(S * S)]


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def draw(inside, bbox, color, opacity=1.0):
    x0, y0, x1, y1 = (int(math.floor(bbox[0])), int(math.floor(bbox[1])), int(math.ceil(bbox[2])), int(math.ceil(bbox[3])))
    offs = [(i + 0.5) / SS for i in range(SS)]
    for y in range(max(0, y0), min(S, y1 + 1)):
        for x in range(max(0, x0), min(S, x1 + 1)):
            hits = sum(1 for oy in offs for ox in offs if inside(x + ox, y + oy))
            if not hits:
                continue
            a = opacity * hits / (SS * SS)
            p = img[y * S + x]
            for c in range(3):
                p[c] = p[c] * (1 - a) + color[c] * a


def capsules(segs, half):
    def inside(px, py):
        return any(seg_dist(px, py, *s) <= half for s in segs)
    xs = [v for s in segs for v in (s[0], s[2])]
    ys = [v for s in segs for v in (s[1], s[3])]
    return inside, (min(xs) - half, min(ys) - half, max(xs) + half, max(ys) + half)


def disc(cx, cy, r):
    return (lambda px, py: (px - cx) ** 2 + (py - cy) ** 2 <= r * r), (cx - r, cy - r, cx + r, cy + r)


draw(*capsules([(150, 442, 490, 442)], 6), WHITE, 0.35)
draw(*capsules([(150, 336, 490, 336)], 4), WHITE, 0.15)
draw(*capsules([(150, 230, 490, 230)], 4), WHITE, 0.15)
pts = [(162, 190), (250, 236), (332, 318), (422, 442)]
draw(*capsules([(*pts[i], *pts[i + 1]) for i in range(3)], 17), WHITE)
draw(*disc(422, 442, 41), BLUE)
draw(*disc(422, 442, 27), GREEN)

raw = b"".join(b"\x00" + bytes(int(round(v)) for px in img[y * S:(y + 1) * S] for v in px) for y in range(S))


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
with open(sys.argv[1], "wb") as f:
    f.write(png)
print("ok", len(png))
