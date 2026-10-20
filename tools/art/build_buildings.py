"""建筑（箭塔、兵营、主城）的动画帧：把 Seedance 生成的各状态视频切成一组帧，输出 assets/art/q/<前缀><建筑>_<阵营>/f_N.png，并打印 Defs 要填的帧范围。
每组按顺序：闲置（健康、受伤、重伤各一段循环）、攻击（只有箭塔，三种状态各一段）、倒塌（最后一帧就是废墟地基）。
建筑不能像兵那样按身高对齐（烟往上冒会改变高度），改成按「地基」对齐：每段参照帧最下面一截的宽度和中心、底边，缩放平移到和健康闲置一致。
红方左右翻转（箭塔上的小弓兵朝左）。
用法：python3 tools/art/build_buildings.py [建筑...]
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import build_units2 as bu  # noqa: E402
import build_video_unit as bvu  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
VID = ROOT / "art" / "raw" / "video_b"
OUT = ROOT / "assets" / "art" / "q"
PREFIX = os.environ.get("BUILDING_PREFIX", "b1_")
HEIGHT = 160
SIZE = bvu.SIZE
STATES = ("", "_hurt", "_heavy")
# 每种建筑：视频名前缀、有没有攻击；attack_end 是攻击视频截到第几帧（之后 AI 自己加了火之类的就不要）
BUILDINGS = {"tower": {"v": "towerA", "attack": True, "attack_end": 52}, "barracks": {"v": "barracks"}, "base": {"v": "base"}}


def footprint(rgba):
    """地基：不透明区域最下面 45% 那一截（烟只在上面，不会影响）的左右范围和底边 → (底边 y, 中心 x, 宽度)"""
    rows = [y for y in range(0, SIZE, 2) if any(rgba[(y * SIZE + x) * 4 + 3] > 128 for x in range(0, SIZE, 2))]
    top, bottom = rows[0], rows[-1]
    band = [x for y in range(bottom - max(4, (bottom - top) * 45 // 100), bottom + 1, 2) for x in range(0, SIZE, 2) if rgba[(y * SIZE + x) * 4 + 3] > 128]
    return bottom, (min(band) + max(band)) / 2, max(band) - min(band)


def place(segments, out_dir, flip):
    tmp = pathlib.Path(tempfile.mkdtemp())
    base = None
    placed = []
    for si, (frames, ref) in enumerate(segments):
        b, cx, w = footprint(frames[ref])
        if base is None:
            base = (b, cx, w)
        s = base[2] / w
        dx, dy = base[1] - cx * s, base[0] - b * s
        for fi, fr in enumerate(frames):
            src = tmp / f"s{si}_{fi}.png"
            bvu.save_raw(fr, src)
            dst = tmp / f"p{si}_{fi}.png"
            sw = round(SIZE * s)
            vf = (f"scale={sw}:{sw},pad={max(SIZE, sw) + 2 * SIZE}:{max(SIZE, sw) + 2 * SIZE}:{SIZE + round(dx)}:{SIZE + round(dy)}:color=0x00000000,"
                  f"crop={SIZE}:{SIZE}:{SIZE}:{SIZE}")
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-vf", vf, str(dst)], check=True)
            placed.append(dst)
    x0 = y0 = SIZE
    x1 = y1 = 0
    for p in placed:
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(p), "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True, check=True).stdout
        for y in range(0, SIZE, 2):
            xs = [x for x in range(0, SIZE, 2) if raw[(y * SIZE + x) * 4 + 3] > 40]
            if xs:
                x0, x1, y0, y1 = min(x0, xs[0]), max(x1, xs[-1]), min(y0, y), max(y1, y)
    x0, y0, x1, y1 = max(0, x0 - 4), max(0, y0 - 4), min(SIZE, x1 + 6), min(SIZE, y1 + 6)
    out_dir.mkdir(parents=True, exist_ok=True)
    for p in out_dir.glob("f_*.png*"):
        p.unlink()
    for i, p in enumerate(placed):
        vf = f"crop={x1 - x0}:{y1 - y0}:{x0}:{y0}" + (",hflip" if flip else "") + f",scale=-1:{HEIGHT}"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(p), "-vf", vf, str(out_dir / f"f_{i}.png")], check=True)
    # 地基在最终画布里的位置：给游戏摆放用（底边中心对准建筑坐标），地基宽度占画布宽的比例用来算显示大小
    k = HEIGHT / (y1 - y0)
    return {"canvasW": round((x1 - x0) * k), "canvasH": HEIGHT, "footW": round(base[2] * k), "footBottom": round((y1 - base[0]) * k),
            "footCx": round(((x1 - base[1]) if flip else (base[1] - x0)) * k)}


def build(name, side):
    c = BUILDINGS[name]
    pre = "" if side == "blue" else "red_"
    v = lambda n: VID / f"{pre}{n}" / "video.mp4"
    segs, conf, cur = [], {}, 0

    def add(key, fr):
        nonlocal cur
        segs.append((fr, 0))
        conf[key] = [cur, cur + len(fr)]
        cur += len(fr)

    for s in STATES:
        st, L, _ = bu.find_loop(v(f"{c['v']}{s}_idle"), 24, 70)
        add(f"idle{s or '_ok'}", bu.take(v(f"{c['v']}{s}_idle"), st, st + L - 1, 8))
    if c.get("attack"):
        for s in STATES:
            vid = v(f"{c['v']}{s}_attack")
            n = len(bu.gray(vid))
            add(f"attack{s or '_ok'}", bu.take(vid, 0, min(n - 1, c["attack_end"]), 8))
    vid = v(f"{c['v']}_die")
    d1 = bu.settle(vid, bu.first_move(vid, 0, 4.0), thresh=0.8)
    add("death", bu.take(vid, 0, d1, 12))
    meta = place(segs, OUT / f"{PREFIX}{name}_{side}", flip=(side == "red"))
    print(name, side, json.dumps(conf), json.dumps(meta), flush=True)


if __name__ == "__main__":
    for n in (sys.argv[1:] or BUILDINGS):
        for side in ("blue", "red"):
            build(n, side)
