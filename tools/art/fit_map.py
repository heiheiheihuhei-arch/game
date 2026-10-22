"""把规划图里的路线和点位「贴」到 AI 画好的地图上：AI 画的位置总会和规划差一点（比如整条河偏了），
游戏里的兵必须走在图上真实的路上、建筑必须站在图上真实的空地上。
做法：① 每个建筑在规划点附近找一块最像空地的位置（土路色的椭圆）；② 路面那一段每隔几步沿法线找路面中线；
③ 兵营到主城不画路的那段沿用规划点，两头接到量出来的建筑上。
输出：assets/scripts/lane/maps/<名字>.ts（游戏坐标：原点在地图中心、y 向上）和一张检查图。
用法：python3 tools/art/fit_map.py 地图.png 规划.html 名字 世界高度 [检查图.jpg] [人工点位.json]
人工点位：{编号: [x,y]}，给了就用它代替自动找空地（小箭塔的空地和路同色，自动找不准）
"""
import json, math, pathlib, re, subprocess, sys

src, plan_html, name, world_h = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
check_out = sys.argv[5] if len(sys.argv) > 5 else None
manual = {k: tuple(v) for k, v in json.load(open(sys.argv[6])).items() if not k.startswith('_')} if len(sys.argv) > 6 else {}
ROOT = pathlib.Path(__file__).resolve().parents[2]
_wh = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", src],
                     capture_output=True, text=True, check=True).stdout.strip().split(",")
IW, IH = int(_wh[0]), int(_wh[1])
H = 500; W = round(H * IW / IH)
raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", src, "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                     capture_output=True, check=True).stdout

def road(x, y):
    if not (0 <= x < W and 0 <= y < H): return False
    i = (y * W + x) * 3; r, g, b = raw[i], raw[i + 1], raw[i + 2]
    return r > 175 and g > 145 and b > 95 and r - b > 40 and r >= g - 8

s = open(plan_html).read()
routes = {n: (list(map(int, r.split(","))), json.loads(p)) for n, r, p in re.findall(r"(\S+?):\{c:'[^']*',road:\[(\d+,\d+)\],p:(\[\[.*?\]\])", s)}
pts = [(i, n, float(x), float(y), t) for i, n, x, y, t in re.findall(r"\['(\w+)','([^']*)',([\d.]+),([\d.]+),'(\w+)'", s)]
FOOT = {"base": 39, "ebase": 39, "tower": 13, "etower": 13, "camp": 20, "ecamp": 20}

# ① 建筑：在规划点 ±R 范围里挪，找椭圆里土路色占比最高的位置
def fit_clearing(x0, y0, f, R=14, ring_w=0.8):
    e = lambda dx, dy: (dx / f) ** 2 + (dy / (f * 0.7)) ** 2
    cells = [(dx, dy) for dy in range(-int(f * 0.7), int(f * 0.7) + 1) for dx in range(-f, f + 1) if e(dx, dy) <= 1]
    # 空地外面一圈应该是草：小箭塔的空地和路一个颜色，只看里面会被吸到路上去
    g = int(f * 1.7)
    ring = [(dx, dy) for dy in range(-g, g + 1) for dx in range(-g, g + 1) if 1.35 ** 2 <= e(dx, dy) <= 1.7 ** 2]
    best = (-1, x0, y0)
    for oy in range(-R, R + 1, 2):
        for ox in range(-R, R + 1, 2):
            cx, cy = int(x0 + ox), int(y0 + oy)
            fill = sum(road(cx + dx, cy + dy) for dx, dy in cells) / len(cells)
            if fill < 0.5: continue
            sc = fill - ring_w * sum(road(cx + dx, cy + dy) for dx, dy in ring) / len(ring)
            # 同分时选离规划点近的
            sc -= 0.0005 * math.hypot(ox, oy)
            if sc > best[0]: best = (sc, cx, cy)
    return best

fitted, report = {}, []
for i, n, x, y, t in pts:
    if t not in FOOT: continue
    # 主城周围本来就是一大片黄土，不看外圈
    if i in manual:
        fitted[i] = manual[i]; report.append(f"· {i} {n}：用人工点位 {manual[i]}，比规划挪了 ({manual[i][0] - x:+.0f},{manual[i][1] - y:+.0f})"); continue
    sc, fx, fy = fit_clearing(x, y, FOOT[t], ring_w=0 if 'base' in t else 0.8)
    ok = sc > (0.6 if 'base' in t else 0.3)
    fitted[i] = (fx, fy) if ok else (x, y)
    report.append(f"{'✓' if ok else '✗'} {i} {n}：得分 {sc:.2f}，挪了 ({fx - x:+.0f},{fy - y:+.0f})" + ("" if ok else "，没找到空地，沿用规划点"))

# ② 路面：样条采样，每点沿法线找路面，取那一段路面的中点
def cr(P, step=3.0):
    o = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(0, i - 1)], P[i], P[i + 1], P[min(len(P) - 1, i + 2)]
        n = max(2, int(math.dist(p1, p2) / step))
        for j in range(n):
            t = j / n; t2 = t * t; t3 = t2 * t
            o.append([0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in (0, 1)])
    return o + [list(P[-1])]

def snap_road(P, R=22):
    out, widths, miss = [], [], 0
    for i, (x, y) in enumerate(P):
        a, b = P[max(0, i - 1)], P[min(len(P) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1; nx, ny = -dy / L, dx / L
        hits = [d for d in range(-R, R + 1) if road(int(round(x + nx * d)), int(round(y + ny * d)))]
        if not hits: out.append((x, y)); miss += 1; continue
        d0 = min(hits, key=abs); lo = hi = d0; hs = set(hits)
        # 路面上有车辙、碎石，颜色断断续续：隔 1~2 格也算连着
        while any(lo - j in hs for j in (1, 2, 3)): lo = max(lo - j for j in (1, 2, 3) if lo - j in hs)
        while any(hi + j in hs for j in (1, 2, 3)): hi = min(hi + j for j in (1, 2, 3) if hi + j in hs)
        c = (lo + hi) / 2; widths.append(hi - lo + 1)
        out.append((x + nx * c, y + ny * c))
    # 平滑：滑动平均，消掉路边杂草造成的抖动
    sm = []
    for i in range(len(out)):
        win = out[max(0, i - 4):i + 5]
        sm.append((sum(p[0] for p in win) / len(win), sum(p[1] for p in win) / len(win)))
    return sm, widths, miss

lanes, lane_report = [], []
LANE_OF = {"北路": 0, "中路": 1, "南路": 2}
road_widths = []
for nm, ((a, b), P) in sorted(routes.items(), key=lambda kv: LANE_OF[kv[0]]):
    seg, widths, miss = snap_road(cr(P[a:b + 1]))
    road_widths += widths
    lane_report.append(f"{nm}：路面段 {len(seg)} 点，没找到路面 {miss} 点，路宽中位数 {sorted(widths)[len(widths) // 2] if widths else 0}")
    # 主城 → 规划里路面之前的点 → 路面 → 路面之后的点 → 敌方主城
    full = [fitted["A"]] + [tuple(p) for p in P[1:a]] + seg[::4] + [seg[-1]] + [tuple(p) for p in P[b + 1:-1]] + [fitted["E"]]
    lanes.append(full)

# ③ 换成游戏坐标
k = world_h / H
def w(p): return [round((p[0] - W / 2) * k), round((H / 2 - p[1]) * k)]
LANE = {"B1": 0, "C4": 0, "T1": 0, "E3": 0, "E1": 0, "B2": 1, "C2": 1, "T2": 1, "E2": 1, "B3": 2, "C3": 2, "T3": 2, "E4": 2}
KIND = {"base": "base", "ebase": "base", "camp": "barracks", "ecamp": "barracks", "tower": "tower", "etower": "tower"}
blds = []
for i, n, x, y, t in pts:
    if t not in FOOT: continue
    kind = KIND[t]
    if i in ("G1", "G2", "H1", "H2"): kind = "gate"
    side = -1 if t.startswith("e") else 1
    blds.append({"id": i, "kind": kind, "side": side, "lane": LANE.get(i, -1), "pos": w(fitted[i])})
med_w = sorted(road_widths)[len(road_widths) // 2]
data = {"worldW": round(W * k), "worldH": world_h, "roadW": round(med_w * k), "lanes": [[w(p) for p in L] for L in lanes], "buildings": blds}
ts = ROOT / "assets" / "scripts" / "lane" / "maps" / f"{name}.ts"
ts.parent.mkdir(parents=True, exist_ok=True)
ts.write_text(f"// 由 tools/art/fit_map.py 从 {pathlib.Path(src).name} 量出来，别手改；改规划或换图后重新跑\n"
              f"import type {{ MapLayout }} from '../MapDef';\n\nexport const LAYOUT: MapLayout = {json.dumps(data, ensure_ascii=False)};\n")
print("\n".join(report + lane_report))
print(f"路宽中位数 {med_w}（坐标）= 游戏里 {round(med_w * k)} 像素；世界 {data['worldW']}×{world_h} → {ts.relative_to(ROOT)}")

if check_out:
    # 检查图：量出来的路线（白）和建筑位置（蓝/红圈）画在地图上
    buf = bytearray(raw)
    def dot(x, y, c, r=2):
        for oy in range(-r, r + 1):
            for ox in range(-r, r + 1):
                X, Y = int(x) + ox, int(y) + oy
                if 0 <= X < W and 0 <= Y < H: buf[(Y * W + X) * 3:(Y * W + X) * 3 + 3] = bytes(c)
    for L in lanes:
        for i in range(len(L) - 1):
            n = max(1, int(math.dist(L[i], L[i + 1])))
            for j in range(n):
                dot(L[i][0] + (L[i + 1][0] - L[i][0]) * j / n, L[i][1] + (L[i + 1][1] - L[i][1]) * j / n, (255, 255, 255), 1)
    for bd in blds:
        x, y = fitted[bd["id"]]; c = (40, 90, 230) if bd["side"] == 1 else (230, 50, 40)
        f = FOOT["base" if bd["kind"] == "base" else "tower" if bd["kind"] in ("tower", "gate") else "camp"]
        for a in range(0, 360, 4):
            dot(x + f * math.cos(math.radians(a)), y + 0.7 * f * math.sin(math.radians(a)), c, 1)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-i", "-", "-q:v", "3", check_out], input=bytes(buf), check=True)
