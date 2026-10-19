"""把一排姿势的动作设定图切成单帧：白底去掉，在相邻两个人之间画面最空的那一列切开，
每帧按头部对齐、脚底对齐，输出同样大小的透明 PNG。
用法：python3 tools/art/slice_sheet.py 设定图.png 输出目录 前缀 [帧数或 列x行]
  帧数：一排 N 个；列x行（如 2x2）：网格排列，按从左到右、从上到下的顺序编号
输出约定（不同设定图切出来的帧能混着播）：人物从头顶到脚底统一缩放成 PERSON 像素高，
画布高 CANVAS_H、脚底贴底边、头部在画布水平正中——游戏里锚点固定用底边中点
"""
import pathlib
import subprocess
import sys

src, out_dir, prefix = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
layout = sys.argv[4] if len(sys.argv) > 4 else "5"
ncol, nrow = (map(int, layout.split("x")) if "x" in layout else (int(layout), 1))
PERSON = 160
CANVAS_H = 256
out_dir.mkdir(parents=True, exist_ok=True)

probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", src],
                       capture_output=True, text=True, check=True).stdout.strip().split(",")
W, H = int(probe[0]), int(probe[1])
# 白底 → 透明：越接近白越透明，并把白从半透明边缘里扣掉
A = "clip((((255-r(X,Y))+(255-g(X,Y))+(255-b(X,Y)))*3/255-0.2)/0.8,0,1)"
ch = lambda c: f"if(gt({A},0),clip(({c}(X,Y)-(1-{A})*255)/max({A},0.02),0,255),0)"
key = f"format=rgba,geq=r='{ch('r')}':g='{ch('g')}':b='{ch('b')}':a='255*{A}'"
raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", src, "-vf", key, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
                     capture_output=True, check=True).stdout
alpha = raw[3::4]
TH = 60

# 人物等间距排开，所以在每个等分点附近找最空的一行 / 一列下刀。
# 相邻两人的兵器常常碰在一起，按连通块分不开，按行列切最稳
R = 12


def emptiest(occ, n, lo, hi):
    """在 [lo, hi) 里按 n 等分，每个等分点附近找最空的位置"""
    sm = [sum(occ[max(0, i - R):i + R + 1]) for i in range(len(occ))]
    size = hi - lo
    cuts = [lo]
    for i in range(1, n):
        c, span = lo + size * i // n, int(size / n * 0.35)
        cuts.append(min(range(c - span, c + span), key=lambda x: sm[x]))
    return cuts + [hi]


rocc = [sum(1 for x in range(0, W, 2) if alpha[y * W + x] > TH) for y in range(H)]
rcuts = emptiest(rocc, nrow, 0, H)
cells = []
for ry0, ry1 in zip(rcuts, rcuts[1:]):
    cocc = [sum(1 for y in range(ry0, ry1, 2) if alpha[y * W + x] > TH) for x in range(W)]
    ccuts = emptiest(cocc, ncol, 0, W)
    cells += [(cx0, cx1, ry0, ry1) for cx0, cx1 in zip(ccuts, ccuts[1:])]

frames = []
for cx0, cx1, ry0, ry1 in cells:
    rows = [y for y in range(ry0, ry1) if any(alpha[y * W + x] > TH for x in range(cx0, cx1, 2))]
    y0, y1 = rows[0], rows[-1] + 1
    cols = [x for x in range(cx0, cx1) if any(alpha[y * W + x] > TH for y in range(y0, y1, 2))]
    x0, x1 = cols[0], cols[-1] + 1
    # 头部：从上往下第一段"够宽"的行（兵器尖可能比头还高，但很细）；它的水平中心作为对齐点，起点作为头顶
    band = max(6, (y1 - y0) * 14 // 100)
    head, head_top = [], None
    for y in range(y0, y1):
        xs = [x for x in range(x0, x1) if alpha[y * W + x] > TH]
        if len(xs) > (x1 - x0) * 0.06:
            head_top = y if head_top is None else head_top
            head += xs
            band -= 1
            if band <= 0:
                break
    frames.append((x0, x1, y0, y1, sum(head) / len(head), head_top))

# 同一张图里所有帧用同一个缩放：以最高的站姿为准（蓄力、弓步时人会矮下去，这是动作本身）
scale = PERSON / max(f[3] - f[5] for f in frames)
half = max(max(hx - x0, x1 - hx) for x0, x1, _, _, hx, _ in frames) * scale
cw = int(half * 2) + 8
for i, (x0, x1, y0, y1, hx, _) in enumerate(frames):
    w, h = round((x1 - x0) * scale), round((y1 - y0) * scale)
    ox, oy = round(cw / 2 - (hx - x0) * scale), CANVAS_H - 4 - h
    if oy < 0:
        sys.exit(f"第 {i} 帧太高（兵器竖得太高），超出画布，调大 CANVAS_H")
    vf = f"{key},crop={x1 - x0}:{y1 - y0}:{x0}:{y0},scale={w}:{h},pad={cw}:{CANVAS_H}:{ox}:{oy}:color=0x00000000"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-vf", vf, str(out_dir / f"{prefix}_{i}.png")], check=True)
print(f"{len(frames)} 帧 → {out_dir}/{prefix}_*.png，画布 {cw}x{CANVAS_H}，人物高 {PERSON}")
