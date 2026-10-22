"""给 AI 画的关卡图做「流水图」：哪里是水、水往哪个方向流。游戏里的 map-water 着色器按它让河水流动。
R = 水的多少（边缘羽化，岸不动）；G、B = 流向（图片像素方向，x 向右、y 向下，0.5 表示 0）；A = 255。
河是一条从上往下的带子：每一行找河道中心，按中心线的走向定这一行的流向（桥下、浅滩那几行没水就插值）。
用法：python3 tools/art/water_mask.py 地图.png 输出.png [缩小倍数，默认 4]
"""
import math, struct, subprocess, sys, zlib

src, out = sys.argv[1], sys.argv[2]
div = int(sys.argv[3]) if len(sys.argv) > 3 else 4
wh = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", src],
                    capture_output=True, text=True, check=True).stdout.strip().split(",")
W, H = int(wh[0]) // div, int(wh[1]) // div
raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", src, "-vf", f"scale={W}:{H}:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                     capture_output=True, check=True).stdout

def water(x, y):
    i = (y * W + x) * 3; r, g, b = raw[i], raw[i + 1], raw[i + 2]
    # 河水：蓝，且比岸边的阴影亮；浅滩的白水花也算（偏白但带蓝）
    return (b > 140 and b - r > 45) or (r > 200 and g > 215 and b > 225 and b >= r)

m = [[1 if water(x, y) else 0 for x in range(W)] for y in range(H)]
# 只留大块的水（河被桥、浅滩分成几段，每段都要），去掉零星蓝点
seen = [[False] * W for _ in range(H)]; best = []
for y in range(H):
    for x in range(W):
        if m[y][x] and not seen[y][x]:
            comp, st = [], [(x, y)]; seen[y][x] = True
            while st:
                cx, cy = st.pop(); comp.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < W and 0 <= ny < H and m[ny][nx] and not seen[ny][nx]: seen[ny][nx] = True; st.append((nx, ny))
            if len(comp) >= 120: best += comp
river = [[0] * W for _ in range(H)]
for x, y in best: river[y][x] = 1
# 每一行的河道中心，没水的行插值
cx = [None] * H
for y in range(H):
    xs = [x for x in range(W) if river[y][x]]
    if xs: cx[y] = sum(xs) / len(xs)
known = [y for y in range(H) if cx[y] is not None]
for y in range(H):
    if cx[y] is None:
        a = max([k for k in known if k < y], default=None); b = min([k for k in known if k > y], default=None)
        cx[y] = cx[a] if b is None else cx[b] if a is None else cx[a] + (cx[b] - cx[a]) * (y - a) / (b - a)
# 中心线平滑后求走向
sm = [sum(cx[max(0, y - 6):y + 7]) / len(cx[max(0, y - 6):y + 7]) for y in range(H)]
dirs = []
for y in range(H):
    dx = (sm[min(H - 1, y + 3)] - sm[max(0, y - 3)]) / 6; L = math.hypot(dx, 1)
    dirs.append((dx / L, 1 / L))
# 羽化：离岸 1~2 格的水只动一半，岸本身不动
def soft(x, y):
    if not river[y][x]: return 0
    near = sum(river[yy][xx] for yy in range(max(0, y - 2), min(H, y + 3)) for xx in range(max(0, x - 2), min(W, x + 3)))
    return min(1, near / 25 * 1.25)
rows = []
for y in range(H):
    row = bytearray([0])
    dx, dy = dirs[y]
    for x in range(W):
        a = soft(x, y)
        row += bytes((int(a * 255), int((dx * 0.5 + 0.5) * 255), int((dy * 0.5 + 0.5) * 255), 255))
    rows.append(bytes(row))
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")
open(out, "wb").write(png)
print(f"{out}：{W}×{H}，河水 {len(best)} 格，占 {len(best) / (W * H):.1%}")
