"""出一张带细网格的地图图，标出每个建筑现在的位置，给人对着它细调点位。
网格：每 10 一条细线、每 50 一条粗线并标数字（坐标就是规划图的 1500×500），建筑画十字、空地大小的椭圆和编号。
用法：python3 tools/art/grid_map.py 地图.png 点位.json 输出.jpg [每格像素，默认 2]
"""
import json, subprocess, sys

src, pts_file, out = sys.argv[1], sys.argv[2], sys.argv[3]
px = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0
wh = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", src],
                    capture_output=True, text=True, check=True).stdout.strip().split(",")
H = 500; W = round(H * int(wh[0]) / int(wh[1]))
OW, OH = int(W * px), int(H * px)
pts = {k: v for k, v in json.load(open(pts_file)).items() if not k.startswith("_")}
FOOT = {"A": 39, "E": 39, "B1": 20, "B2": 20, "B3": 20, "C2": 20, "C3": 20, "C4": 20}

vf = [f"scale={OW}:{OH}"]
for x in range(10, W, 10):
    major = x % 50 == 0
    vf.append(f"drawbox=x={int(x * px)}:y=0:w={2 if major else 1}:h=ih:c={'red@0.75' if major else 'white@0.35'}:t=fill")
    if major: vf.append(f"drawtext=text='{x}':x={int(x * px) + 3}:y=3:fontsize=16:fontcolor=red:borderw=2:bordercolor=white")
for y in range(10, H, 10):
    major = y % 50 == 0
    vf.append(f"drawbox=x=0:y={int(y * px)}:w=iw:h={2 if major else 1}:c={'red@0.75' if major else 'white@0.35'}:t=fill")
    if major: vf.append(f"drawtext=text='{y}':x=3:y={int(y * px) + 3}:fontsize=16:fontcolor=red:borderw=2:bordercolor=white")
for pid, (x, y) in pts.items():
    X, Y = int(x * px), int(y * px)
    enemy = pid.startswith(("C", "E", "H"))
    c = "0xff3030" if enemy else "0x2060ff"
    vf.append(f"drawbox=x={X - 9}:y={Y - 1}:w=19:h=3:c={c}:t=fill")
    vf.append(f"drawbox=x={X - 1}:y={Y - 9}:w=3:h=19:c={c}:t=fill")
    vf.append(f"drawtext=text='{pid} ({x:g},{y:g})':x={X + 8}:y={Y + 6}:fontsize=17:fontcolor=white:borderw=3:bordercolor={c}")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-vf", ",".join(vf), "-q:v", "2", out], check=True)
print(f"{out}：{OW}×{OH}，每 10 一格（{int(10 * px)} 像素），{len(pts)} 个点")
