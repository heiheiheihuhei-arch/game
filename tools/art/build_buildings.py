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
VID = ROOT / "art" / "raw" / "video_b2"
OUT = pathlib.Path(os.environ.get("BUILDING_OUT", ROOT / "assets" / "art" / "q"))
PREFIX = os.environ.get("BUILDING_PREFIX", "b3_")
HEIGHT = 160
SIZE = bvu.SIZE
STATES = ("", "_hurt", "_heavy")
# 每种建筑：视频名前缀、有没有攻击；attack_end 是攻击视频截到第几帧（之后 AI 自己加了火之类的就不要）
# still_ok：健康状态用一张静止图（AI 给静止的塔生成视频时总会让塔长高）
BUILDINGS = {"tower": {"v": "tower", "still_ok": "art/raw/bpicks_pad/{pre}tower.png"}, "barracks": {"v": "barracks", "soft": True}, "base": {"v": "base"}}


def footprint(rgba):
    """地基：不透明区域最下面 45% 那一截（烟只在上面，不会影响）的左右范围和底边 → (底边 y, 中心 x, 宽度)"""
    rows = [y for y in range(0, SIZE, 2) if any(rgba[(y * SIZE + x) * 4 + 3] > 128 for x in range(0, SIZE, 2))]
    top, bottom = rows[0], rows[-1]
    band = [x for y in range(bottom - max(4, (bottom - top) * 45 // 100), bottom + 1, 2) for x in range(0, SIZE, 2) if rgba[(y * SIZE + x) * 4 + 3] > 128]
    return bottom, (min(band) + max(band)) / 2, max(band) - min(band)


def blend(a, b, t):
    """两帧 RGBA 按透明度正确地混合：t=0 全是 a，t=1 全是 b"""
    out = bytearray(len(a))
    u = 1 - t
    for i in range(0, len(a), 4):
        wa, wb = a[i + 3] * u, b[i + 3] * t
        w = wa + wb
        if w < 0.5:
            continue
        out[i] = int((a[i] * wa + b[i] * wb) / w)
        out[i + 1] = int((a[i + 1] * wa + b[i + 1] * wb) / w)
        out[i + 2] = int((a[i + 2] * wa + b[i + 2] * wb) / w)
        out[i + 3] = int(w)
    return bytes(out)


def seamless(video, n, L=36):
    """无缝循环：取视频里紧挨着的两段 W1=[s,s+L)、W2=[s+L,s+2L)，第 i 帧 = W2 和 W1 按 i/n 交叉淡化。
    第一帧就是 W2 开头，最后一帧就是 W1 结尾，而 W1 结尾在视频里正好接着 W2 开头，所以循环时接得上"""
    N = len(bu.gray(video))
    L = min(L, N // 2 - 1)
    s0 = (N - 2 * L) // 2
    w1 = bu.take(video, s0, s0 + L - 1, n)
    w2 = bu.take(video, s0 + L, s0 + 2 * L - 1, n)
    return [blend(w2[i], w1[i], i / (n - 1)) for i in range(n)]


def soft_edges(frames, ramp=140, per_frame=False):
    """AI 视频里烟的顶边、左右边有时是一刀切的直线：从内容最上沿 / 最左右沿往里 ramp 像素，透明度按平滑曲线从 0 升到 1，
    把直边变成自然散开。用整组统一的边缘（循环不闪）再乘上每帧自己的边缘（烟顶高低不一时也盖得住）。
    左右只处理上半部分（烟所在的高度），不碰下面的建筑本体"""
    S = SIZE
    smooth = lambda t: 0.0 if t <= 0 else 1.0 if t >= 1 else t * t * (3 - 2 * t)
    edges = []
    for f in frames:
        rows = [y for y in range(0, S, 2) if any(f[(y * S + x) * 4 + 3] > 40 for x in range(0, S, 2))]
        top, bottom = rows[0], rows[-1]
        cols = [x for x in range(0, S, 2) if any(f[(y * S + x) * 4 + 3] > 40 for y in range(top, top + (bottom - top) // 2, 2))]
        edges.append((top, bottom, cols[0], cols[-1]))
    g_top, g_left, g_right = min(e[0] for e in edges), min(e[2] for e in edges), max(e[3] for e in edges)
    g_mid = g_top + (max(e[1] for e in edges) - g_top) // 2
    out = []
    for f, (top, bottom, left, right) in zip(frames, edges):
        mid = max(g_mid, top + (bottom - top) // 2)
        sets = [(top, left, right, ramp * 0.6)] if per_frame else [(g_top, g_left, g_right, ramp), (top, left, right, ramp * 0.6)]
        b = bytearray(f)
        for y in range(min(g_top, top), mid):
            for x in range(S):
                i = (y * S + x) * 4 + 3
                if not b[i]:
                    continue
                k = 1.0
                for t0, l0, r0, rp in sets:
                    k *= smooth(min((y - t0) / rp, (x - l0) / rp, (r0 - x) / rp))
                if k < 1:
                    b[i] = int(b[i] * k)
        out.append(bytes(b))
    return out

def place(segments, out_dir, flip):
    tmp = pathlib.Path(tempfile.mkdtemp())
    C = 2 * SIZE
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
            # 放大很多时（新视频里建筑画得小）偏移会是很大的负数：画布四周留足 M 的边，保证贴进去的位置不为负
            M = sw + SIZE
            # 工作画布 C×C 比视频大：基准建筑放在中下部，上面留一整屏给放大后的烟，左右各留半屏，什么都不会被裁掉
            vf = (f"scale={sw}:{sw},pad={sw + 2 * M}:{sw + 2 * M}:{M + round(dx)}:{M + round(dy)}:color=0x00000000,"
                  f"crop={C}:{C}:{M - SIZE // 2}:{M - SIZE}")
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-vf", vf, str(dst)], check=True)
            placed.append(dst)
    x0 = y0 = C
    x1 = y1 = 0
    for p in placed:
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(p), "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True, check=True).stdout
        for y in range(0, C, 2):
            xs = [x for x in range(0, C, 2) if raw[(y * C + x) * 4 + 3] > 40]
            if xs:
                x0, x1, y0, y1 = min(x0, xs[0]), max(x1, xs[-1]), min(y0, y), max(y1, y)
    x0, y0, x1, y1 = max(0, x0 - 4), max(0, y0 - 4), min(C, x1 + 6), min(C, y1 + 6)
    out_dir.mkdir(parents=True, exist_ok=True)
    for p in out_dir.glob("f_*.png*"):
        p.unlink()
    k = HEIGHT / (y1 - y0)
    # 健康建筑的屋顶（第一帧最高的不透明处）：血条放在它上面；烟升过屋顶后慢慢变淡，到画布顶端完全消失，
    # 不会在视频画面上沿被一刀切断。左右两边也淡出（烟飘到视频边缘同样会被切）
    raw0 = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(placed[0]), "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True, check=True).stdout
    roof = next(y for y in range(C) if any(raw0[(y * C + x) * 4 + 3] > 128 for x in range(0, C, 2)))
    roof_k = max(1, round((roof - y0) * k))
    fade = f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(Y/{roof_k},0,1)*clip(min(X,W-1-X)/(W*0.1),0,1)'"
    for i, p in enumerate(placed):
        vf = f"crop={x1 - x0}:{y1 - y0}:{x0}:{y0}" + (",hflip" if flip else "") + f",scale=-1:{HEIGHT},format=rgba,{fade}"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(p), "-vf", vf, str(out_dir / f"f_{i}.png")], check=True)
    # 最后再加一帧干净的废墟：最后一帧里瓦砾线以上全部淡掉（烟散了）
    # base 是在视频坐标里量的，换到工作画布坐标（左右各留半屏、上面留一屏）
    by, bx = base[0] + SIZE, base[1] + SIZE // 2
    foot_bottom = round((y1 - by) * k)
    h_b = HEIGHT - foot_bottom - roof_k
    line = HEIGHT - foot_bottom - round(h_b * 0.32)
    band = max(4, round(h_b * 0.12))
    last = len(placed) - 1
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(out_dir / f"f_{last}.png"), "-vf",
                    f"format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip((Y-{line - band})/{band},0,1)'",
                    str(out_dir / f"f_{last + 1}.png")], check=True)
    # 地基在最终画布里的位置：给游戏摆放用（底边中心对准建筑坐标），地基宽度占画布宽的比例用来算显示大小
    return {"roofTop": roof_k, "canvasW": round((x1 - x0) * k), "canvasH": HEIGHT, "footW": round(base[2] * k), "footBottom": round((y1 - by) * k),
            "footCx": round(((x1 - bx) if flip else (bx - x0)) * k)}


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
        if not s and c.get("still_ok"):
            img = ROOT / c["still_ok"].format(pre=pre)
            rgb = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(img), "-vf", f"scale={SIZE}:{SIZE}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                                 capture_output=True, check=True).stdout
            add("idle_ok", [bvu.key_flood(rgb)])
            continue
        fr = seamless(v(f"{c['v']}{s}_idle"), 12)
        add(f"idle{s or '_ok'}", soft_edges(fr) if s and c.get("soft") else fr)
    if c.get("attack"):
        for s in STATES:
            vid = v(f"{c['v']}{s}_attack")
            n = len(bu.gray(vid))
            add(f"attack{s or '_ok'}", bu.take(vid, 0, min(n - 1, c["attack_end"]), 8))
    vid = v(f"{c['v']}_die")
    # 倒塌：整段视频顺着播一遍（倒下后烟继续往上飘一会儿），最后接一帧干净废墟（place 里生成），游戏里淡过去
    n = len(bu.gray(vid))
    die = bu.take(vid, 0, n - 1, 24)
    add("death", soft_edges(die, per_frame=True) if c.get("soft") else die)
    conf["ruin"] = cur
    meta = place(segs, OUT / f"{PREFIX}{name}_{side}", flip=(side == "red"))
    print(name, side, json.dumps(conf), json.dumps(meta), flush=True)


if __name__ == "__main__":
    for n in (sys.argv[1:] or BUILDINGS):
        for side in ("blue", "red"):
            build(n, side)
