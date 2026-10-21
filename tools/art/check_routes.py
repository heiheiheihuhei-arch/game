"""核对 AI 画的地图上的路和规划路线是否一致：沿规划路线每隔几像素，在法线方向 ±R 像素内找路面（按颜色），
记录偏差；输出每条路线的覆盖率、平均/最大偏差，并画一张检查图（规划线 + 识别出的路面）。
用法：python3 tools/art/check_routes.py 地图.png 路线.json 检查图.jpg [过河点.json]  （路线 json：{名字: [[x,y],...]}，过河点 json：{编号: [x,y]}，坐标按 1000×500）
"""
import json, math, subprocess, sys
src, rj, out = sys.argv[1], sys.argv[2], sys.argv[3]
W, H, R = 1000, 500, 14
raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", src, "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
def road(x, y):
    i = (y * W + x) * 3; r, g, b = raw[i], raw[i + 1], raw[i + 2]
    return r > 175 and g > 145 and b > 95 and r - b > 40 and r >= g - 8
def cr(pts, step=5):
    o = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(len(pts) - 1, i + 2)]
        n = max(2, int(math.dist(p1, p2) / step))
        for j in range(n):
            t = j / n; t2 = t * t; t3 = t2 * t
            o.append([0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3) for a in (0, 1)])
    return o + [pts[-1]]
routes = json.load(open(rj)); report = {}; marks = []
for name, pts in routes.items():
    P = cr(pts); devs = []; miss = 0
    for i, (x, y) in enumerate(P):
        a, b = P[max(0, i - 1)], P[min(len(P) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1; nx, ny = -dy / L, dx / L
        hits = [d for d in range(-R, R + 1) if 0 <= int(x + nx * d) < W and 0 <= int(y + ny * d) < H and road(int(x + nx * d), int(y + ny * d))]
        if hits:
            d = min(hits, key=abs); devs.append(abs(d)); marks.append((x, y, 1))
        else:
            miss += 1; marks.append((x, y, 0))
    report[name] = {"覆盖率": round(1 - miss / len(P), 3), "平均偏差px": round(sum(devs) / max(1, len(devs)), 1), "缺失点": miss}
print(json.dumps(report, ensure_ascii=False))
# 过河点（可选第 4 个参数，json：{编号: [x,y]}）：量桥上下两侧河水的中心，看桥是不是真的架在河上
bad = []
if len(sys.argv) > 4:
    def water(x, y):
        i = (y * W + x) * 3; r, g, b = raw[i], raw[i + 1], raw[i + 2]
        return b > 150 and b - r > 50
    def wood_px(x, y):
        i = (y * W + x) * 3; r, g, b = raw[i], raw[i + 1], raw[i + 2]
        return 70 < r < 175 and 40 < g < 125 and b < 90 and r - b > 45 and r > g > b
    def river_cx(y, x0):  # 这一行里离 x0 最近的一段连续河水的中心
        runs, s = [], None
        for x in range(max(0, x0 - 60), min(W, x0 + 61)):
            if water(x, y) and s is None: s = x
            if not water(x, y) and s is not None: runs.append((s, x - 1)); s = None
        if s is not None: runs.append((s, min(W, x0 + 61) - 1))
        runs = [r for r in runs if r[1] - r[0] >= 4]
        return min(((a + b) / 2 for a, b in runs), key=lambda c: abs(c - x0), default=None)
    for cid, (cx, cy) in json.load(open(sys.argv[4])).items():
        cs = [c for dy in list(range(-26, -17)) + list(range(18, 27)) if 0 <= cy + dy < H and (c := river_cx(cy + dy, cx)) is not None]
        if not cs: print(f"✗ {cid}：桥附近找不到河"); bad.append(cid); continue
        rx = sum(cs) / len(cs); off = rx - cx; ok = abs(off) <= 7
        msg = f"河道中心比规划{'偏右' if off > 0 else '偏左'} {abs(off):.1f}"
        # 木桥：桥面那几行里的棕色木头，取中心，和河道中心比
        wood = [] if not cid.startswith("Q") else [x for y in range(max(0, cy - 10), min(H, cy + 11)) for x in range(max(0, cx - 45), min(W, cx + 46)) if wood_px(x, y)]
        if cid.startswith("Q") and len(wood) > 40:
            bx = sorted(wood)[len(wood) // 2]; d = bx - rx
            msg += f"；桥中心比河道中心{'偏右' if d > 0 else '偏左'} {abs(d):.1f}"
            ok = ok and abs(d) <= 5
        elif cid.startswith("Q"):
            msg += "；找不到桥"; ok = False
        print(f"{'✓' if ok else '✗'} {cid}：{msg}（都要 ≤7 / ≤5）")
        if not ok: bad.append(cid)
# 检查图：路面半透明白，规划点 绿=有路 红=没路
buf = bytearray(W * H * 4)
for y in range(H):
    for x in range(W):
        if road(x, y): buf[(y * W + x) * 4:(y * W + x) * 4 + 4] = bytes((255, 255, 255, 90))
for x, y, ok in marks:
    c = (40, 220, 60, 255) if ok else (255, 30, 30, 255)
    for ox in range(-2, 3):
        for oy in range(-2, 3):
            X, Y = int(x) + ox, int(y) + oy
            if 0 <= X < W and 0 <= Y < H: buf[(Y * W + X) * 4:(Y * W + X) * 4 + 4] = bytes(c)
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-i", "-", "/tmp/_ov.png"], input=bytes(buf), check=True)
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-i", "/tmp/_ov.png", "-filter_complex", f"[0]scale={W}:{H}[a];[a][1]overlay", out], check=True)
sys.exit(1 if bad else 0)
