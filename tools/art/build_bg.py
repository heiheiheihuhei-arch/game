"""战场背景素材：地面贴图（给 tools/art/map/mapgen.html 合成整张地图）、战场痕迹和摆件（单张透明图）、会动的摆件（逐帧）。
输出：tools/art/map/grass.jpg、dirt.jpg；assets/art/bg/<名字>.png；assets/art/bg/<名字>/f_N.png
用法：python3 tools/art/build_bg.py
"""
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import build_units2 as bu  # noqa: E402
import build_video_unit as bvu  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "art" / "raw" / "196-battlefield"
OUT = ROOT / "assets" / "art" / "bg"
PREP = ROOT / "tools" / "art" / "prep.py"
# 3 列 × 2 行的物件图：每格的名字和输出宽度（像素，按游戏里最大显示尺寸的 2 倍左右）
SHEETS = {
    "scars": ["scorch", "puddle", "arrows", "shield", "crater", "tracks"],
    "props": ["barricade", "cart", "rack", "crates", "palisade", "drum"],
    "nature": ["tree_round", "tree_pine", "rocks", "bush", "stump", "grass_tuft"],
}
PROP_W = 240
# 会动的摆件：视频、循环帧数、输出高度
LOOPS = {"campfire": ("campfire", 8, 96), "banner_blue": ("banner_blue", 8, 160), "banner_red": ("banner_red", 8, 160), "crow": ("crow", 8, 72)}


def run(*a):
    subprocess.run(list(a), check=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = ROOT / "art" / "raw" / "_bgtmp"
    tmp.mkdir(exist_ok=True)
    m = ROOT / "tools" / "art" / "map"
    run(sys.executable, "-I", str(PREP), "ground", str(RAW / "grass_1.png"), str(m / "grass.jpg"), "--size", "512", "--crop", "0.8", "--lighten", "0")
    run(sys.executable, "-I", str(PREP), "ground", str(RAW / "dirt_1.png"), str(m / "dirt.jpg"), "--size", "512", "--crop", "0.75", "--lighten", "0")
    for sheet, names in SHEETS.items():
        for i, n in enumerate(names):
            c, r = i % 3, i // 3
            cell = tmp / f"{n}.png"
            run("ffmpeg", "-loglevel", "error", "-y", "-i", str(RAW / f"{sheet}_1.png"), "-vf", f"crop=853:720:{c * 853}:{r * 720}", str(cell))
            run(sys.executable, "-I", str(PREP), "prop", str(cell), str(OUT / f"{n}.png"), "--width", str(PROP_W), "--corner", "0")
    for name, (vid, n, h) in LOOPS.items():
        v = ROOT / "art" / "raw" / "video_bg" / vid / "video.mp4"
        s, L, e = bu.find_loop(v, 16, 60)
        frames = bu.take(v, s, s + L - 1, n)
        bvu.build([(frames, 0)], OUT / name, flip=False, height=h)
        print(name, "循环首尾差", round(e, 2))


main()
