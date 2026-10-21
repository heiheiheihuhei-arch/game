"""出图前核对路线规划（手绘规划页 html）：不过就不许出图。
检查：① 桥、浅滩的中心必须在河道中心线上；② 每条进攻路线（全程，不只画出来的路）正好过河一次，过河点就是一座桥或浅滩；
③ 路从我方兵营出发，并且经过一座敌方兵营。坐标按 1000×500。
用法：python3 tools/art/check_plan.py docs/涿郡路线规划.html
"""
import json, math, re, sys

TOL_ON_RIVER = 3   # 桥/浅滩中心离河道中心线的最大距离
TOL_CROSS = 6      # 路过河点离桥/浅滩中心的最大距离
TOL_END = 3        # 路的端点离兵营中心的最大距离

src = open(sys.argv[1]).read()
river = json.loads(re.search(r"// 河[^\n]*\n\s*g\.beginPath\(\);(\[\[.*?\]\])\.forEach", src).group(1))
routes = {}
attack = {}
for name, road, pts in re.findall(r"(\S+?):\{c:'[^']*',road:\[(\d+,\d+)\],p:(\[\[.*?\]\])", src):
    a, b = map(int, road.split(",")); attack[name] = json.loads(pts); routes[name] = attack[name][a:b + 1]
pts = [(i, n, float(x), float(y), t) for i, n, x, y, t in re.findall(r"\['(\w+)','([^']*)',([\d.]+),([\d.]+),'(\w+)'", src)]

def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy or 1
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.dist(p, (a[0] + t * dx, a[1] + t * dy))
def river_dist(p):
    return min(seg_dist(p, river[i], river[i + 1]) for i in range(len(river) - 1))
def cr(P, step=1.0):  # 和规划页 curve() 等价的 Catmull-Rom
    o = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(0, i - 1)], P[i], P[i + 1], P[min(len(P) - 1, i + 2)]
        n = max(2, int(math.dist(p1, p2) / step))
        for j in range(n):
            t = j / n; t2 = t * t; t3 = t2 * t
            o.append([0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in (0, 1)])
    return o + [P[-1]]
def side(p):  # 点在河的哪一边：同一高度上，河道中心线左边为 -1，右边为 1
    for i in range(len(river) - 1):
        (x0, y0), (x1, y1) = river[i], river[i + 1]
        if y0 <= p[1] <= y1:
            return -1 if p[0] < x0 + (x1 - x0) * (p[1] - y0) / ((y1 - y0) or 1) else 1
    return 0

errs = []
crossings = [p for p in pts if p[4] in ("bridge", "ford")]
for i, n, x, y, t in crossings:
    d = river_dist((x, y))
    print(f"{i} {n}：离河道中心 {d:.1f}")
    if d > TOL_ON_RIVER: errs.append(f"{i}（{n}）不在河上：离河道中心 {d:.1f}，要 ≤{TOL_ON_RIVER}")
camps = [p for p in pts if p[4] in ("camp", "ecamp")]
for name, P in routes.items():
    C = cr(attack[name]); xs = [k for k in range(len(C) - 1) if side(C[k]) * side(C[k + 1]) < 0]
    print(f"{name}：过河 {len(xs)} 次")
    if len(xs) != 1: errs.append(f"{name} 过河 {len(xs)} 次，要正好 1 次")
    if len(xs) != 1: continue
    c = C[xs[0]]; best = min(crossings, key=lambda p: math.dist(c, (p[2], p[3])))
    d = math.dist(c, (best[2], best[3]))
    print(f"  过河点 ({c[0]:.0f},{c[1]:.0f}) → {best[0]} 距离 {d:.1f}")
    if d > TOL_CROSS: errs.append(f"{name} 过河点 ({c[0]:.0f},{c[1]:.0f}) 不在桥/浅滩上，最近的 {best[0]} 差 {d:.1f}")
    # 路从我方兵营出发，并且要经过一座敌方兵营
    mine = min((p for p in camps if p[4] == "camp"), key=lambda p: math.dist(P[0], (p[2], p[3])))
    dd = math.dist(P[0], (mine[2], mine[3]))
    if dd > TOL_END: errs.append(f"{name} 起点 {P[0]} 不在我方兵营上，最近的 {mine[0]} 差 {dd:.1f}")
    R = cr(P); foe = min((p for p in camps if p[4] == "ecamp"), key=lambda p: min(math.dist(q, (p[2], p[3])) for q in R))
    dd = min(math.dist(q, (foe[2], foe[3])) for q in R)
    print(f"  路经过敌营 {foe[0]}，距离 {dd:.1f}")
    if dd > TOL_END: errs.append(f"{name} 的路没经过敌方兵营，最近的 {foe[0]} 差 {dd:.1f}")
print("\n".join(["✗ " + e for e in errs]) if errs else "✓ 规划检查通过")
sys.exit(1 if errs else 0)
