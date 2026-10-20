"""把一整张网格序列帧（如 8 列 × 3 行）切成单帧，给按帧播放的动画用。
和 slice_sheet.py 不同：每一行算一条地面线，帧在这一行里离地多高原样保留（蹦跳腾空的帧就是悬空的），
横向按角色身体（主色像素）的重心对齐，免得播放时左右抖。
用法：python3 tools/art/slice_frames.py 设定图.png 输出目录 [列x行] [--red 输出红色版的目录]
输出 f_0.png … f_N.png，所有帧画布一样大，地面贴画布底边（游戏里锚点用底边中点）。
--red：把身体的蓝色换成红色另存一套（蓝绿红三个通道对调）（敌方用），手、弓、箭袋这些不是蓝色的地方不变
"""
import argparse
import pathlib
import subprocess

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out")
ap.add_argument("layout", nargs="?", default="8x3")
ap.add_argument("--red")
ap.add_argument("--body-h", type=int, default=150, help="站着时身体（主色部分）的高度，像素")
ap.add_argument("--body", default="blue", choices=["blue", "red"], help="身体的主色：用来对齐和定缩放")
ap.add_argument("--align-top", action="store_true", help="横向按上半身（身体主色在上半部分的重心）对齐：跑步时腿前后甩，按全身重心对齐上身会晃")
ap.add_argument("--clean", action="store_true", help="每格只留大块的连通区域，去掉邻格伸进来的兵器尖、刀光碎片")
ap.add_argument("--ref-row", type=int, default=1, help="用哪一行（从 0 数）的身体高度定缩放，要选角色都站着的那一行")
args = ap.parse_args()
ncol, nrow = map(int, args.layout.split("x"))

probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", args.src],
                       capture_output=True, text=True, check=True).stdout.strip().split(",")
W, H = int(probe[0]), int(probe[1])
rgb = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", args.src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                     capture_output=True, check=True).stdout


def px(x, y):
    i = (y * W + x) * 3
    return rgb[i], rgb[i + 1], rgb[i + 2]


def alpha_of(r, g, b):
    # 地上的影子（浅灰、颜色很淡）也当背景扣掉，游戏里影子另画
    if min(r, g, b) > 150 and max(r, g, b) - min(r, g, b) < 45:
        return 0.0
    # 白底 → 透明：越接近白越透明
    a = ((255 - r) + (255 - g) + (255 - b)) * 3 / 255
    return max(0.0, min(1.0, (a - 0.2) / 0.8))


def is_body(r, g, b):
    if args.body == "red":
        return r > 150 and r > g + 90 and r > b + 60
    return b > 120 and b > r + 50 and b > g + 10


TH = 0.25
occ = [[alpha_of(*px(x, y)) > TH for x in range(W)] for y in range(H)]
R = 12


def emptiest(counts, n, lo, hi):
    sm = [sum(counts[max(0, i - R):i + R + 1]) for i in range(len(counts))]
    size, cuts = hi - lo, [lo]
    for i in range(1, n):
        c, span = lo + size * i // n, int(size / n * 0.35)
        cuts.append(min(range(c - span, c + span), key=lambda x: sm[x]))
    return cuts + [hi]


def components(cx0, cx1, ry0, ry1):
    """格子里按 2 像素步长找连通块，留下面积不小于最大块 3% 的块，返回这些块覆盖的 (x, y) 集合（步长 2 的格点）"""
    pts = {(x, y) for y in range(ry0 - ry0 % 2, ry1, 2) for x in range(cx0 - cx0 % 2, cx1, 2) if occ[y][x]}
    seen, blobs = set(), []
    for p in pts:
        if p in seen:
            continue
        stack, blob = [p], []
        seen.add(p)
        while stack:
            x, y = stack.pop()
            blob.append((x, y))
            for dx in (-2, 0, 2):
                for dy in (-2, 0, 2):
                    q = (x + dx, y + dy)
                    if q in pts and q not in seen:
                        seen.add(q)
                        stack.append(q)
        blobs.append(blob)
    big = max(len(b) for b in blobs)
    return {q for b in blobs if len(b) >= big * 0.03 for q in b}


rcuts = emptiest([sum(occ[y][::2]) for y in range(H)], nrow, 0, H)
frames, rows = [], []
for ry0, ry1 in zip(rcuts, rcuts[1:]):
    ccuts = emptiest([sum(occ[y][x] for y in range(ry0, ry1, 2)) for x in range(W)], ncol, 0, W)
    row = []
    for cx0, cx1 in zip(ccuts, ccuts[1:]):
        ys = [y for y in range(ry0, ry1) if any(occ[y][x] for x in range(cx0, cx1, 2))]
        if not ys:
            row.append(None)
            continue
        y0, y1 = ys[0], ys[-1] + 1
        keep = None
        if args.clean:
            keep = components(cx0, cx1, ry0, ry1)
            ys = sorted({y for (x, y) in keep})
            y0, y1 = ys[0], ys[-1] + 2
        xs = [x for x in range(cx0, cx1) if any(occ[y][x] for y in range(y0, y1, 2))] if keep is None else sorted({x for (x, y) in keep})
        x0, x1 = xs[0], (xs[-1] + 1 if keep is None else xs[-1] + 2)
        ytop = (y0 + y1) // 2 if args.align_top else y1
        bx = [x for y in range(y0, ytop, 2) for x in range(x0, x1, 2) if is_body(*px(x, y))]
        by = [y for y in range(y0, y1, 2) for x in range(x0, x1, 2) if is_body(*px(x, y))]
        row.append({"x0": x0, "x1": x1, "y0": y0, "y1": y1, "keep": keep,
                    "cx": sum(bx) / len(bx) if bx else (x0 + x1) / 2,
                    "bh": (max(by) - min(by)) if by else 0})
    # 这一行的地面线：大多数帧的底边都在地上，取底边的中位数（腾空帧比它高）
    bottoms = sorted(f["y1"] for f in row if f)
    ground = bottoms[len(bottoms) // 2]
    for f in row:
        if f:
            f["ground"] = max(ground, f["y1"])
    rows.append(row)
    frames += row

real = [f for f in frames if f]
# 用 --ref-row 那一行（角色都站着）身体高度的中位数定缩放
ref = sorted(f["bh"] for f in rows[min(args.ref_row, nrow - 1)] if f and f["bh"])
scale = args.body_h / ref[len(ref) // 2]
half = max(max(f["cx"] - f["x0"], f["x1"] - f["cx"]) for f in real) * scale
cw = int(half * 2) + 8
ch = int(max(f["ground"] - f["y0"] for f in real) * scale) + 8


def save(path, f, red):
    w, h = f["x1"] - f["x0"], f["y1"] - f["y0"]
    out = bytearray()
    for y in range(f["y0"], f["y1"]):
        for x in range(f["x0"], f["x1"]):
            r, g, b = px(x, y)
            a = alpha_of(r, g, b)
            if f["keep"] is not None:
                # 细线（弓弦、枪杆边缘）可能落在格点之间：周围一圈格点有一个在保留块里就算保留
                ex, ey = x - x % 2, y - y % 2
                if not any((ex + dx, ey + dy) in f["keep"] for dx in (-2, 0, 2) for dy in (-2, 0, 2)):
                    a = 0.0
            # 把白从半透明边缘里扣掉
            r, g, b = (int(max(0, min(255, (c - (1 - a) * 255) / max(a, 0.02)))) if a > 0 else 0 for c in (r, g, b))
            if red and is_body(*px(x, y)):
                r, g, b = b, int(g * 0.4), int(r * 0.8)
            out += bytes((r, g, b, int(a * 255)))
    sw, sh = max(1, round(w * scale)), max(1, round(h * scale))
    ox = round(cw / 2 - (f["cx"] - f["x0"]) * scale)
    oy = ch - 4 - round((f["ground"] - f["y0"]) * scale)
    vf = f"scale={sw}:{sh},pad={cw}:{ch}:{ox}:{max(0, oy)}:color=0x00000000"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}",
                    "-i", "-", "-vf", vf, str(path)], input=bytes(out), check=True)


def blank(path):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=black@0:s={cw}x{ch},format=rgba",
                    "-frames:v", "1", str(path)], check=True)


for d, red in [(args.out, False)] + ([(args.red, True)] if args.red else []):
    d = pathlib.Path(d)
    d.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(frames):
        (save(d / f"f_{i}.png", f, red) if f else blank(d / f"f_{i}.png"))
print(f"{len(frames)} 帧（空 {len(frames) - len(real)}）→ {args.out}，画布 {cw}x{ch}")
