"""第二套兵种（统一画风的初级小兵）：把 Seedance 生成的各动作视频切成游戏用的帧组，并打印 Defs.ts 里要填的动画配置。
每个兵种的动作按 [闲置, 跑步, 攻击, 阵亡, 胜利] 依次排进同一个目录 assets/art/q/<前缀><兵种>_<阵营>/f_N.png。
- 闲置、跑步：在视频里找首尾最接近的一段，做成无缝循环
- 攻击：截一次完整动作；收招回不到起始姿势的（枪兵）用「刺出 + 倒放收回」
- 受击不做动作，游戏里只闪红
- 阵亡：从开始倒下截到躺稳；胜利：整段
各段按头部和脚底对齐、统一缩放（用 build_video_unit.py 里的抠图和对齐）
用法：python3 tools/art/build_units2.py [兵种...]
"""
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import build_video_unit as bvu  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
VID = ROOT / "art" / "raw" / "video2"
OUT = ROOT / "assets" / "art" / "q"
PREFIX = "u6_"
HEIGHT = 160


def gray(video, size=80):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(video), "-vf", f"scale={size}:{size},format=gray", "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    n = size * size
    return [raw[i * n:(i + 1) * n] for i in range(len(raw) // n)]


def diff(a, b):
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def find_loop(video, lo, hi, start_from=0):
    """首尾最接近的一段 [s, s+L)，L 在 [lo, hi] 之间"""
    f = gray(video)
    best = min(((diff(f[s], f[s + L]), s, L) for s in range(start_from, len(f) - lo) for L in range(lo, hi + 1) if s + L < len(f)))
    return best[1], best[2], best[0]


def pick(n, count):
    """把 n 帧均匀抽成 count 帧的下标"""
    return [round(i * (n - 1) / max(1, count - 1)) for i in range(count)] if n > count else list(range(n))


def take(video, start, end, count):
    """视频 [start, end] 闭区间里均匀取 count 帧（RGBA，已抠背景）"""
    n = end - start + 1
    sel = [start + i for i in pick(n, count)]
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(video), "-vf", f"scale={bvu.SIZE}:{bvu.SIZE}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True).stdout
    sz = bvu.SIZE * bvu.SIZE * 3
    return [bvu.key_flood(raw[i * sz:(i + 1) * sz]) for i in sel]


def settle(video, start, thresh=0.6, hold=8):
    """从 start 起，第一次连续 hold 帧几乎不动（相邻帧差 < thresh）的位置：倒地躺稳了"""
    f = gray(video)
    for i in range(start, len(f) - hold):
        if all(diff(f[j], f[j + 1]) < thresh for j in range(i, i + hold)):
            return i
    return len(f) - 1


def first_move(video, start=0, thresh=2.5):
    """从 start 起，第一次和 start 那帧差别超过 thresh 的位置：动作开始"""
    f = gray(video)
    for i in range(start, len(f)):
        if diff(f[start], f[i]) > thresh:
            return i
    return start


# 每个兵种各动作用的视频（红方同名加 red_ 前缀）；攻击自动截取：动作开始 → 离起始姿势最远（出手）→ 回到最接近起始姿势
# back=False：收招回不到起始姿势（枪兵），用「刺出 + 倒放收回」；die_from：阵亡视频开头 AI 加了闪光特效，从这一帧之后开始找
UNITS = {
    "gong": {"idle": "gong_idle", "run": "gong_run", "attack": "gong_attack", "die": "gong_die", "win": "gong_win", "atk_frames": 14, "back": True},
    "qiang": {"idle": "qiang_idle", "run": "qiang_run", "attack": "qiang_attack", "die": "qiang_die", "win": "qiang_win", "atk_frames": 8, "back": False},
    "qi": {"idle": "qi_idle2", "run": "qi_run2", "attack": "qi_attack3", "die": "qi_die", "win": "qi_win", "atk_frames": 14, "back": True,
           "run_from": {"blue": 60}, "die_from": {"blue": 24, "red": 28}},
}


def attack_cut(video, back):
    f = gray(video)
    a0 = max(0, first_move(video) - 2)
    peak = max(range(a0, len(f)), key=lambda i: diff(f[0], f[i]))
    if not back:
        return a0, peak, peak
    a1 = min(range(peak, len(f)), key=lambda i: diff(f[0], f[i]))
    return a0, a1, peak


def build_unit(unit, side="blue"):
    c = UNITS[unit]
    pre = "" if side == "blue" else "red_"
    segs, conf = [], {}
    cursor = 0

    def add(name, fr):
        nonlocal cursor
        segs.append((fr, 0))
        conf[name] = [cursor, cursor + len(fr)]
        cursor += len(fr)

    v = lambda n: VID / f"{pre}{n}" / "video.mp4"
    s, L, e = find_loop(v(c["idle"]), 18, 60)
    add("idle", take(v(c["idle"]), s, s + L - 1, 10))
    s, L, e2 = find_loop(v(c["run"]), 12, 30, c.get("run_from", {}).get(side, 0))
    add("walk", take(v(c["run"]), s, s + L - 1, 10))
    n = c["atk_frames"]
    a0, a1, peak = attack_cut(v(c["attack"]), c["back"])
    if not c["back"]:
        fwd = take(v(c["attack"]), a0, peak, n)
        add("attack", fwd + fwd[-2::-1])
        conf["release"] = conf["attack"][0] + len(fwd) - 1
    else:
        add("attack", take(v(c["attack"]), a0, a1, n))
        conf["release"] = conf["attack"][0] + round((peak - a0) / max(1, a1 - a0) * (n - 1))
    d0 = first_move(v(c["die"]), c.get("die_from", {}).get(side, 0))
    d1 = settle(v(c["die"]), d0)
    die = take(v(c["die"]), max(0, d0 - 2), d1, 12)
    add("death", die)
    add("win", take(v(c["win"]), 0, len(gray(v(c["win"]))) - 1, 12))
    out = OUT / f"{PREFIX}{unit}_{side}"
    if out.exists():
        for p in out.glob("f_*.png*"):
            p.unlink()
    # 红方朝左：整组左右翻转（人物身上没有字，翻转没问题）
    bvu.build(segs, out, flip=(side == "red"), height=HEIGHT)
    print(unit, side, json.dumps(conf), f"攻击 {a0}-{a1} 出手 {peak}，循环首尾差：闲置 {e:.1f}，跑步 {e2:.1f}", flush=True)
    return conf


if __name__ == "__main__":
    for u in (sys.argv[1:] or UNITS):
        for side in ("blue", "red"):
            build_unit(u, side)
