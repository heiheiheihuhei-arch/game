"""把一排姿势的动作设定图切成单帧：白底去掉，按空白列切开，每帧按头部对齐、脚底对齐，输出同样大小的透明 PNG。
用法：python3 tools/art/slice_sheet.py 设定图.png 输出目录 前缀 [帧数] [输出高度]
"""
import pathlib
import subprocess
import sys

src, out_dir, prefix = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
want = int(sys.argv[4]) if len(sys.argv) > 4 else 5
out_h = int(sys.argv[5]) if len(sys.argv) > 5 else 256
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
TH = 50

# 按连通块切：每个人连同手里的兵器是一块；在缩小 4 倍的网格上做，快
K = 4
gw, gh = W // K, H // K
grid = bytearray(gw * gh)
for gy in range(gh):
    row = gy * K * W
    for gx in range(gw):
        if alpha[row + gx * K] > TH:
            grid[gy * gw + gx] = 1
label = [0] * (gw * gh)
comps = []
for start in range(gw * gh):
    if not grid[start] or label[start]:
        continue
    cid = len(comps) + 1
    stack, cells = [start], []
    label[start] = cid
    while stack:
        c = stack.pop()
        cells.append(c)
        cx, cy = c % gw, c // gw
        for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1), (cx + 1, cy + 1), (cx - 1, cy - 1), (cx + 1, cy - 1), (cx - 1, cy + 1)):
            if 0 <= nx < gw and 0 <= ny < gh:
                n = ny * gw + nx
                if grid[n] and not label[n]:
                    label[n] = cid
                    stack.append(n)
    xs = [c % gw for c in cells]
    ys = [c // gw for c in cells]
    comps.append({"n": len(cells), "x0": min(xs), "x1": max(xs) + 1, "y0": min(ys), "y1": max(ys) + 1, "id": cid})
comps.sort(key=lambda c: -c["n"])
main = sorted(comps[:want], key=lambda c: c["x0"])
if len(main) < want:
    sys.exit(f"只找到 {len(main)} 个人物")
# 碎块（脱手的枪尖、飘带）归到离它最近的人物
for c in comps[want:]:
    mx = (c["x0"] + c["x1"]) / 2
    owner = min(main, key=lambda m: abs((m["x0"] + m["x1"]) / 2 - mx))
    if c["n"] > 3:
        owner.setdefault("extra", []).append(c["id"])
ids_of = [set([m["id"]] + m.get("extra", [])) for m in main]

frames = []
for m, ids in zip(main, ids_of):
    x0, x1, y0, y1 = m["x0"] * K, min(W, m["x1"] * K + K), m["y0"] * K, min(H, m["y1"] * K + K)
    for c in comps:
        if c["id"] in ids:
            x0, x1 = min(x0, c["x0"] * K), max(x1, c["x1"] * K + K)
            y0, y1 = min(y0, c["y0"] * K), max(y1, c["y1"] * K + K)
    x1, y1 = min(W, x1), min(H, y1)
    head = [x for y in range(y0, y0 + max(4, (y1 - y0) * 12 // 100)) for x in range(x0, x1)
            if alpha[y * W + x] > TH and label[(y // K) * gw + min(gw - 1, x // K)] in ids]
    frames.append((x0, x1, y0, y1, sum(head) / len(head), ids))

left = max(f[4] - f[0] for f in frames)
right = max(f[1] - f[4] for f in frames)
top = max(frames[i][3] - frames[i][2] for i in range(len(frames)))
cw, chh = int(left + right) + 8, top + 8
scale = out_h / chh
for i, (x0, x1, y0, y1, hx, ids) in enumerate(frames):
    # 画布里：头部中心对齐到同一列，脚底对齐到底边
    ox, oy = int(left - (hx - x0)) + 4, chh - 4 - (y1 - y0)
    vf = (f"{key},crop={x1 - x0}:{y1 - y0}:{x0}:{y0},"
          f"pad={cw}:{chh}:{ox}:{oy}:color=0x00000000,scale=-1:{out_h}")
    dst = out_dir / f"{prefix}_{i}.png"
    mask = bytearray(gw * gh)
    for j, l in enumerate(label):
        if l in ids:
            mask[j] = 255
    mpath = out_dir / f".mask_{i}.pgm"
    mpath.write_bytes(b"P5 %d %d 255\n" % (gw, gh) + bytes(mask))
    # 遮罩放大回原尺寸、稍微膨胀一圈，再和去白底后的透明度相乘：别人伸进来的兵器被擦掉，边缘的半透明保留
    fc = (f"[1]scale={W}:{H}:flags=neighbor,dilation,dilation,format=gray[m];"
          f"[0]{key},split[k][k2];[k2]alphaextract[ka];[ka][m]blend=all_mode=multiply[a];"
          f"[k][a]alphamerge,crop={x1 - x0}:{y1 - y0}:{x0}:{y0},"
          f"pad={cw}:{chh}:{ox}:{oy}:color=0x00000000,scale=-1:{out_h}")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-i", str(mpath), "-filter_complex", fc, str(dst)], check=True)
    mpath.unlink()
print(f"{len(frames)} 帧 → {out_dir}/{prefix}_*.png，画布 {cw}x{chh}，头部锚点 x={left / cw:.3f}")
