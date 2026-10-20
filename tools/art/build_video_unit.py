"""把一个兵种的几段动作（AI 动画工具给的透明 PNG 帧、或 Seedance 生成的白底视频）合成游戏用的一组帧。
- 视频：取指定的一段（首尾能接上的循环），从四边往里泛洪抠掉背景（和背景连通的才抠，角色身上的白色不受影响）
- 各段按「头的位置 + 脚底」对齐、按角色身高统一缩放，切换动作时人不会跳
- 最后统一裁剪、可选左右翻转（敌方朝左），缩到指定高度，输出 f_0.png …
用法见文件末尾的 JOBS；python3 tools/art/build_video_unit.py 任务名
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "art" / "raw"
SIZE = 640


def rgba_frames_from_pngs(files):
    out = []
    for f in files:
        out.append(subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(f), "-vf", f"scale={SIZE}:{SIZE}", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
                                  capture_output=True, check=True).stdout)
    return out


def rgba_frames_from_video(video, start, count, step):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(video), "-vf", f"scale={SIZE}:{SIZE}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True).stdout
    n = SIZE * SIZE * 3
    frames = [raw[i * n:(i + 1) * n] for i in range(start, start + count, step)]
    return [key_flood(f) for f in frames]


def key_flood(rgb, tol=26, soft=24):
    """从四边往里找和背景颜色接近、连成一片的像素，变透明；边缘按色差做半透明过渡"""
    W = H = SIZE
    bg = rgb[0:3]
    dist = bytearray(W * H)
    for i in range(W * H):
        r, g, b = rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]
        dist[i] = min(255, max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2])))
    alpha = bytearray([255]) * (W * H)
    stack = [i for i in range(W)] + [(H - 1) * W + i for i in range(W)] + [j * W for j in range(H)] + [j * W + W - 1 for j in range(H)]
    seen = bytearray(W * H)
    while stack:
        i = stack.pop()
        if seen[i] or dist[i] > tol + soft:
            continue
        seen[i] = 1
        # 很接近背景的全透明，再远一点的按距离半透明（抗锯齿边缘）
        alpha[i] = 0 if dist[i] <= tol else int(255 * (dist[i] - tol) / soft)
        if dist[i] > tol:
            continue
        x, y = i % W, i // W
        if x > 0: stack.append(i - 1)
        if x < W - 1: stack.append(i + 1)
        if y > 0: stack.append(i - W)
        if y < H - 1: stack.append(i + W)
    # 被角色围住、和外面背景不连通的大块背景色（比如弓和弓弦之间）：颜色几乎和背景一样、面积够大的也抠掉；
    # 箭羽这种小块白色面积小，保留
    for start in range(W * H):
        if seen[start] or dist[start] > 10:
            continue
        region, st = [], [start]
        seen[start] = 1
        while st:
            i = st.pop()
            region.append(i)
            x, y = i % W, i // W
            for j in ((i - 1) if x > 0 else -1, (i + 1) if x < W - 1 else -1, (i - W) if y > 0 else -1, (i + W) if y < H - 1 else -1):
                if j >= 0 and not seen[j] and dist[j] <= 10:
                    seen[j] = 1
                    st.append(j)
        if len(region) >= 400:
            for i in region:
                alpha[i] = 0
    out = bytearray(W * H * 4)
    for i in range(W * H):
        out[i * 4:i * 4 + 3] = rgb[i * 3:i * 3 + 3]
        out[i * 4 + 3] = alpha[i]
    return bytes(out)


def measure(rgba):
    """角色的脚底 y、身高（头顶到脚底）、头部中心 x（最上面 30% 的不透明像素的平均 x）"""
    rows = [y for y in range(0, SIZE, 2) if any(rgba[(y * SIZE + x) * 4 + 3] > 128 for x in range(0, SIZE, 2))]
    top, bottom = rows[0], rows[-1]
    hx = [x for y in range(top, top + int((bottom - top) * 0.3), 2) for x in range(0, SIZE, 2) if rgba[(y * SIZE + x) * 4 + 3] > 128]
    return bottom, bottom - top, sum(hx) / len(hx)


def save_raw(rgba, path):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{SIZE}x{SIZE}", "-i", "-", str(path)],
                   input=rgba, check=True)


def build(segments, out_dir, flip, height):
    """segments：[(帧列表, 这一段的参照帧下标)]；第一段当基准，其余段缩放、平移到和它对齐"""
    import tempfile
    tmp = pathlib.Path(tempfile.mkdtemp())
    base = None
    placed = []
    for si, (frames, ref) in enumerate(segments):
        b, h, hx = measure(frames[ref])
        if base is None:
            base = (b, h, hx)
        s = base[1] / h
        # 先把这一段缩放 s 倍，再平移让脚底、头部中心和基准对齐
        dx, dy = base[2] - hx * s, base[0] - b * s
        for fi, fr in enumerate(frames):
            src = tmp / f"s{si}_{fi}.png"
            save_raw(fr, src)
            dst = tmp / f"p{si}_{fi}.png"
            sw = round(SIZE * s)
            vf = (f"scale={sw}:{sw},pad={max(SIZE, sw) + 2 * SIZE}:{max(SIZE, sw) + 2 * SIZE}:{SIZE + round(dx)}:{SIZE + round(dy)}:color=0x00000000,"
                  f"crop={SIZE}:{SIZE}:{SIZE}:{SIZE}")
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-vf", vf, str(dst)], check=True)
            placed.append(dst)
    # 所有帧不透明区域的并集，统一裁剪
    x0 = y0 = SIZE; x1 = y1 = 0
    for p in placed:
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(p), "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True, check=True).stdout
        for y in range(0, SIZE, 2):
            xs = [x for x in range(0, SIZE, 2) if raw[(y * SIZE + x) * 4 + 3] > 40]
            if xs:
                x0, x1, y0, y1 = min(x0, xs[0]), max(x1, xs[-1]), min(y0, y), max(y1, y)
    x0, y0, x1, y1 = max(0, x0 - 6), max(0, y0 - 6), min(SIZE, x1 + 8), min(SIZE, y1 + 8)
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, p in enumerate(placed):
        vf = f"crop={x1 - x0}:{y1 - y0}:{x0}:{y0}" + (",hflip" if flip else "") + f",scale=-1:{height}"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(p), "-vf", vf, str(out_dir / f"f_{i}.png")], check=True)
    print(f"{len(placed)} 帧 → {out_dir}，裁剪框 {x1 - x0}x{y1 - y0}")


TOOL = RAW / "tool-framesprite"
VID = RAW / "video"
JOBS = {
    # 敌方弓兵（红衣将军）：攻击 0-11（AI 动画工具）、走路 12-23（Seedance 1.0-pro-fast，第 33 帧起 23 帧的循环，隔一帧取）、受击 24-27、阵亡 28-39
    "gong_red": lambda: build([
        (rgba_frames_from_pngs(sorted((TOOL / "gong_red_attack").glob("frame_*.png"))), 0),
        (rgba_frames_from_video(VID / "gong_red_walk1" / "video.mp4", 33, 23, 2), 0),
        # 受击 4 帧：被打中后头往后仰（视频 0.8~1.2 秒；前面 AI 自己加了一团火，不要）
        (rgba_frames_from_video(VID / "gong_red_hurt1" / "video.mp4", 19, 10, 3), 0),
        # 阵亡 12 帧：弓掉落、往后仰面倒地、躺平（视频 1.25~2.2 秒）
        (rgba_frames_from_video(VID / "gong_red_die1" / "video.mp4", 30, 24, 2), 0),
    ], ROOT / "assets" / "art" / "q" / "u4_gong_red", flip=True, height=220),
}

if __name__ == "__main__":
    JOBS[sys.argv[1]]()
