import { Node } from 'cc';
import { createSprite } from '../core/Res';
import { LAYOUT as ZHUO3 } from './maps/Zhuo3';

/**
 * 一张关卡地图：底图、三条进攻路线（我方大本营 → 敌方大本营）、每座建筑站在哪。
 * AI 画的关卡图由 tools/art/fit_map.py 量出路线和建筑位置（maps/*.ts）；老的对称地图在 classicLayout() 里按规则算。
 */
export interface MapLayout {
    worldW: number;
    worldH: number;
    /** 图上路面的宽度：兵在路上左右散开的范围按它定 */
    roadW: number;
    /** 底图（assets/art 下的路径） */
    image?: string;
    /** 摆不摆老地图那套手放的树、石头、营地、战场痕迹（AI 画的关卡图自带，不摆） */
    decor?: boolean;
    lanes: [number, number][][];
    buildings: { id?: string; kind: 'base' | 'gate' | 'barracks' | 'tower'; side: 1 | -1; lane: number; pos: [number, number] }[];
}

/** 路宽、大本营广场大小：游戏里不再用代码画，但 tools/art/mapgen.html 合成老地图时按这两个值画 */
export const ROAD_W = 150;
/** 大本营周围的广场，三条路从这里散开 */
export const PLAZA = { rx: 270, ry: 230 };

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

function segLens(pts: [number, number][]) {
    const segs: number[] = [];
    for (let i = 0; i + 1 < pts.length; i++) segs.push(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
    return segs;
}

/** 折线上距离 s 处的坐标，lat 是垂直于路的偏移（正数在路的左手边，向右走时就是上侧） */
function pointOn(pts: [number, number][], segs: number[], s: number, lat: number): [number, number] {
    const total = segs.reduce((a, b) => a + b, 0);
    let i = 0;
    s = Math.max(0, Math.min(total, s));
    while (i < segs.length - 1 && s > segs[i]) { s -= segs[i]; i++; }
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const t = s / segs[i], dx = (bx - ax) / segs[i], dy = (by - ay) / segs[i];
    return [ax + (bx - ax) * t - dy * lat, ay + (by - ay) * t + dx * lat];
}

// ---------- 老的对称地图 ----------

/** 比屏幕宽得多、也比屏幕高一点（约 1.3 屏），左右对称 */
const CLASSIC_W = 3500, CLASSIC_H = 940, CLASSIC_BASE_X = 1540;
/**
 * 三条路的控制点，只写我方这半边（从大本营到地图中线），另一半左右镜像，保证双方路况一样。
 * 出了广场转个弯就基本走直：上路贴着地图上沿、下路贴着下沿、中路在中间只有很轻的起伏
 */
const HALF: [number, number][][] = [
    [[-CLASSIC_BASE_X, 0], [-1360, 130], [-1140, 270], [-840, 300], [-400, 296], [0, 300]],
    [[-CLASSIC_BASE_X, 0], [-1240, 0], [-700, 10], [0, 0]],
    [[-CLASSIC_BASE_X, 0], [-1360, -130], [-1140, -270], [-840, -300], [-400, -296], [0, -300]],
];
/** 兵营离自家大本营（沿路）多远；兵营的那座箭塔站在路上、兵营前方一点；两座门牙塔紧贴大本营正面（我方这边，敌方镜像） */
const BARRACKS_S = 380, TOWER_AHEAD = 150;
const GATE_TOWERS: [number, number][] = [[118, 74], [118, -74]];

function mirror(half: [number, number][]): [number, number][] {
    const right = half.slice(0, -1).reverse().map(([x, y]) => [-x, y] as [number, number]);
    return half.concat(right);
}

export function classicLayout(): MapLayout {
    const lanes = HALF.map(h => mirror(h));
    const buildings: MapLayout['buildings'] = [];
    for (const side of [1, -1] as const) {
        const bx = side === 1 ? -CLASSIC_BASE_X : CLASSIC_BASE_X;
        buildings.push({ kind: 'base', side, lane: -1, pos: [bx, 0] });
        for (const [dx, dy] of GATE_TOWERS) buildings.push({ kind: 'gate', side, lane: -1, pos: [bx + side * dx, dy] });
        lanes.forEach((ctrl, lane) => {
            const pts = smooth(ctrl), segs = segLens(pts), len = segs.reduce((a, b) => a + b, 0);
            const bs = side === 1 ? BARRACKS_S : len - BARRACKS_S;
            buildings.push({ kind: 'barracks', side, lane, pos: pointOn(pts, segs, bs, 0) });
            buildings.push({ kind: 'tower', side, lane, pos: pointOn(pts, segs, bs + side * TOWER_AHEAD, 0) });
        });
    }
    return { worldW: CLASSIC_W, worldH: CLASSIC_H, roadW: ROAD_W, image: 'q/map', decor: true, lanes, buildings };
}

// ---------- 当前关卡 ----------

/** 现在打的是哪张图：涿郡（AI 画的 3:1 第 3 张）；要回到老的对称地图换成 classicLayout() */
export const LAYOUT: MapLayout = { ...ZHUO3, image: 'q/maps/zhuo3', decor: false };
export const WORLD_W = LAYOUT.worldW;
export const WORLD_H = LAYOUT.worldH;
/** 兵在路上左右散开的最大偏移：路窄的图上兵排得紧一些 */
export const LAT_SPREAD = Math.min(50, LAYOUT.roadW * 0.45);
/** 我方大本营在哪：开局镜头对准它 */
export const MY_BASE = LAYOUT.buildings.find(b => b.kind === 'base' && b.side === 1)!.pos;

/** 三条路的折线（从我方大本营到敌方大本营）；沿路的距离 s 从我方这头算起 */
export const LANES: [number, number][][] = LAYOUT.lanes.map(l => smooth(l));
export const LANE_NAMES = ['上路', '中路', '下路'];

const lens = LANES.map(segLens);
export const LANE_LEN = lens.map(segs => segs.reduce((a, b) => a + b, 0));

/** 路上距离 s 处的坐标，lat 是垂直于路的偏移（正数在路的左手边，向右走时就是上侧） */
export function lanePoint(lane: number, s: number, lat = 0): [number, number] {
    return pointOn(LANES[lane], lens[lane], s, lat);
}

/** 地图上一点在某条路上最近处的 s：建筑都按它算自己在路上的位置，兵靠它判断"打到了没有" */
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

export function drawMap(parent: Node) {
    // 底图是一整张图：老地图由 tools/art/mapgen.html 合成，关卡图是 AI 画的，改了要重新跑 fit_map.py
    createSprite('Ground', parent, LAYOUT.image ?? 'q/map', { width: WORLD_W, height: WORLD_H });
    // 树、石头、营地、战场痕迹和会动的东西在 Scenery.ts
}
