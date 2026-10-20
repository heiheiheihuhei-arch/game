"""把 Q 版三国兵的动作图切帧、合成游戏用的帧组：assets/art/q/u_<兵种>_<blue|red>/f_0.png …
每个兵种 = 攻击图的帧 + 受击阵亡图的帧，按顺序接起来；红方的图是蓝方左右翻转后让 AI 换色的，
翻转后每一行的帧序是反的，这里倒回来。同一兵种红蓝两套统一成同样大小的画布（地面贴底边、身体居中），
游戏里按同一个显示高度缩放，两边一样大。
用法：python3 tools/art/build_q_units.py
"""
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "art" / "raw"
OUT = ROOT / "assets" / "art" / "q"
SLICE = ROOT / "tools" / "art" / "slice_frames.py"

# 兵种：[(蓝方图, 红方图, 列x行), …]，按这个顺序把帧接起来
UNITS = {
    "gong": [("168-q-blue-anim/gong_atk_1", "176-q-red/red_gong_atk_1", "4x2"),
             ("168-q-blue-anim/gong_die_1", "176-q-red/red_gong_die_1", "4x2")],
    "qiang": [("175-key-attacks/qiang_key_2", "176-q-red/red_qiang_atk_1", "2x2"),
              ("169-q-blue-fix/qiang_die_1", "176-q-red/red_qiang_die_1", "4x2")],
    "qi": [("175-key-attacks/qi_key_1", "176-q-red/red_qi_atk_1", "2x2"),
           ("168-q-blue-anim/qi_die_1", "176-q-red/red_qi_die_1", "4x2")],
}


def size(p):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(p)],
                         capture_output=True, text=True, check=True).stdout
    return tuple(map(int, out.strip().split(",")))


only = set(sys.argv[1:])
with tempfile.TemporaryDirectory() as tmp:
    tmp = pathlib.Path(tmp)
    for unit, sheets in UNITS.items():
        if only and unit not in only:
            continue
        frames = {"blue": [], "red": []}
        for si, (blue, red, grid) in enumerate(sheets):
            ncol, nrow = map(int, grid.split("x"))
            for side, src in (("blue", blue), ("red", red)):
                d = tmp / f"{unit}_{side}_{si}"
                subprocess.run([sys.executable, "-I", str(SLICE), str(RAW / f"{src}.png"), str(d), grid,
                                "--body", side, "--ref-row", "0", "--clean"], check=True, stdout=subprocess.DEVNULL)
                for r in range(nrow):
                    for c in range(ncol):
                        # 红方是翻转过的图：同一行里从右往左才是原来的顺序
                        cc = ncol - 1 - c if side == "red" else c
                        frames[side].append(d / f"f_{r * ncol + cc}.png")
        W = max(size(f)[0] for fs in frames.values() for f in fs)
        H = max(size(f)[1] for fs in frames.values() for f in fs)
        for side, fs in frames.items():
            dst = OUT / f"u_{unit}_{side}"
            dst.mkdir(parents=True, exist_ok=True)
            for i, f in enumerate(fs):
                subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(f), "-vf",
                                f"pad={W}:{H}:(ow-iw)/2:oh-ih:color=0x00000000", str(dst / f"f_{i}.png")], check=True)
        print(f"{unit}: {len(frames['blue'])} 帧，画布 {W}x{H}")
