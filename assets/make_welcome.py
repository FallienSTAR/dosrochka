"""Rasterize the bot welcome picture (640x360) to PNG without third-party libs."""
import math
import struct
import sys
import zlib

W, H = 640, 360
SS = 3
BLUE = (0x2B, 0x45, 0xC8)
WHITE = (255, 255, 255)
LIGHT = (0xB5, 0xC2, 0xFF)
GREEN = (0x3F, 0xCB, 0x93)

img = [list(BLUE) for _ in range(W * H)]


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def draw(inside, bbox, color, opacity=1.0):
    offs = [(i + 0.5) / SS for i in range(SS)]
    for y in range(max(0, int(bbox[1])), min(H, int(math.ceil(bbox[3])) + 1)):
        for x in range(max(0, int(bbox[0])), min(W, int(math.ceil(bbox[2])) + 1)):
            hits = sum(1 for oy in offs for ox in offs if inside(x + ox, y + oy))
            if hits:
                a = opacity * hits / (SS * SS)
                p = img[y * W + x]
                for c in range(3):
                    p[c] = p[c] * (1 - a) + color[c] * a


def polyline(pts, half):
    segs = [(*pts[i], *pts[i + 1]) for i in range(len(pts) - 1)]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return (lambda px, py: any(seg_dist(px, py, *s) <= half for s in segs)), (min(xs) - half, min(ys) - half, max(xs) + half, max(ys) + half)


def disc(cx, cy, r):
    return (lambda px, py: (px - cx) ** 2 + (py - cy) ** 2 <= r * r), (cx - r, cy - r, cx + r, cy + r)


def dot(cx, cy):
    draw(*disc(cx, cy, 25), BLUE)
    draw(*disc(cx, cy, 16), GREEN)


BASE = 292
for gy, op in ((112, 0.12), (172, 0.12), (232, 0.12)):
    draw(*polyline([(64, gy), (576, gy)], 3), WHITE, op)
draw(*polyline([(64, BASE), (576, BASE)], 5), WHITE, 0.35)

# «без доплат» — длинная пологая линия
draw(*polyline([(70, 86), (230, 132), (400, 200), (570, BASE)], 7), WHITE, 0.25)
# варианты доплат: долги закрываются раньше
draw(*polyline([(70, 196), (190, 222), (320, 256), (430, BASE)], 13), LIGHT)
draw(*polyline([(70, 118), (160, 162), (240, 226), (300, BASE)], 13), WHITE)
dot(430, BASE)
dot(300, BASE)

raw = b"".join(b"\x00" + bytes(int(round(v)) for px in img[y * W:(y + 1) * W] for v in px) for y in range(H))


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
with open(sys.argv[1], "wb") as f:
    f.write(png)
print("ok", len(png))
