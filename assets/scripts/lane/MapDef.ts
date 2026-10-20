import { Node } from 'cc';
import { createSprite } from '../core/Res';

/** 整张地图：比屏幕宽得多、也比屏幕高一点（约 1.3 屏），左右为主、上下也能拖一点 */
export const WORLD_W = 3500;
export const WORLD_H = 940;
export const BASE_X = 1540;
/** 路宽、大本营广场大小：游戏里不再用代码画，但 tools/art/mapgen.html 合成地图图时按这两个值画 */
export const ROAD_W = 150;
/** 大本营周围的广场，三条路从这里散开 */
export const PLAZA = { rx: 270, ry: 230 };

/**
 * 三条路的控制点，只写我方这半边（从大本营到地图中线），另一半左右镜像，保证双方路况一样。
 * 出了广场转个弯就基本走直：上路贴着地图上沿、下路贴着下沿、中路在中间只有很轻的起伏
 */
const HALF: [number, number][][] = [
    [[-BASE_X, 0], [-1360, 130], [-1140, 270], [-840, 300], [-400, 296], [0, 300]],
    [[-BASE_X, 0], [-1240, 0], [-700, 10], [0, 0]],
    [[-BASE_X, 0], [-1360, -130], [-1140, -270], [-840, -300], [-400, -296], [0, -300]],
];

function mirror(half: [number, number][]): [number, number][] {
    const right = half.slice(0, -1).reverse().map(([x, y]) => [-x, y] as [number, number]);
    return half.concat(right);
}

/** Catmull-Rom 样条：过每个控制点的平滑曲线，按固定步长采样成折线 */
function smooth(ctrl: [number, number][], step = 24): [number, number][] {
    const out: [number, number][] = [];
    const p = (i: number) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
    for (let i = 0; i < ctrl.length - 1; i++) {
        const [x0, y0] = p(i - 1), [x1, y1] = p(i), [x2, y2] = p(i + 1), [x3, y3] = p(i + 2);
        const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
        for (let k = 0; k < n; k++) {
            const t = k / n, t2 = t * t, t3 = t2 * t;
            out.push([
                0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
                0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3),
            ]);
        }
    }
    out.push(ctrl[ctrl.length - 1]);
    return out;
}

/** 三条路的折线（从我方大本营到敌方大本营）；沿路的距离 s 从我方这头算起 */
export const LANES: [number, number][][] = HALF.map(h => smooth(mirror(h)));
export const LANE_NAMES = ['上路', '中路', '下路'];

const lens = LANES.map(pts => {
    const segs: number[] = [];
    for (let i = 0; i + 1 < pts.length; i++) segs.push(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
    return segs;
});
export const LANE_LEN = lens.map(segs => segs.reduce((a, b) => a + b, 0));

/** 路上距离 s 处的坐标，lat 是垂直于路的偏移（正数在路的左手边，向右走时就是上侧） */
export function lanePoint(lane: number, s: number, lat = 0): [number, number] {
    const pts = LANES[lane], segs = lens[lane];
    let i = 0;
    s = Math.max(0, Math.min(LANE_LEN[lane], s));
    while (i < segs.length - 1 && s > segs[i]) { s -= segs[i]; i++; }
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const t = s / segs[i], dx = (bx - ax) / segs[i], dy = (by - ay) / segs[i];
    return [ax + (bx - ax) * t - dy * lat, ay + (by - ay) * t + dx * lat];
}

/** 地图上一点在某条路上最近处的 s：门牙塔、大本营不属于哪一路，三路的兵都靠它判断"打到了没有" */
export function projectS(lane: number, x: number, y: number): number {
    const pts = LANES[lane], segs = lens[lane];
    let best = Infinity, bestS = 0, acc = 0;
    for (let i = 0; i < segs.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        const vx = bx - ax, vy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (segs[i] * segs[i])));
        const d = Math.hypot(x - ax - vx * t, y - ay - vy * t);
        if (d < best) { best = d; bestS = acc + segs[i] * t; }
        acc += segs[i];
    }
    return bestS;
}

/** 兵营离自家大本营（沿路）多远；兵营的那座箭塔就站在路上、兵营前方一点 */
export const BARRACKS_S = 380;
export const LANE_TOWER: { ahead: number; lat: number }[] = [
    { ahead: 150, lat: 0 },
    { ahead: 150, lat: 0 },
    { ahead: 150, lat: 0 },
];
/** 两座门牙塔紧贴在大本营正面（相对大本营，我方这边；敌方左右镜像），不放在路口 */
export const GATE_TOWERS: [number, number][] = [[118, 74], [118, -74]];

export function drawMap(parent: Node) {
    // 草地和土路是离线合成好的一整张图（tools/art/mapgen.html 按 LANES、ROAD_W、PLAZA 画的），改了路线要重新生成
    createSprite('Ground', parent, 'q/map', { width: WORLD_W, height: WORLD_H });
    // 树、石头、营地、战场痕迹和会动的东西在 Scenery.ts
}
