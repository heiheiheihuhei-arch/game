import { Color, Graphics, Node } from 'cc';
import { createGraphics } from '../core/Nodes';
import { createSprite } from '../core/Res';

/** 整张地图：比屏幕宽得多、也比屏幕高一点（约 1.3 屏），左右为主、上下也能拖一点 */
export const WORLD_W = 3500;
export const WORLD_H = 940;
export const BASE_X = 1540;
const ROAD_W = 150;
/** 大本营周围的广场，三条路从这里散开 */
const PLAZA = { rx: 270, ry: 230 };

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

/**
 * 兵营离自家大本营（沿路）多远；兵营的那座箭塔再往前多远、偏离路中心多少：塔站在路边，
 * 上下路的塔放在靠里的一侧，中路的放在上侧，前后错开，免得两座塔挤在同一处
 */
export const BARRACKS_S = 380;
export const LANE_TOWER: { ahead: number; lat: number }[] = [
    { ahead: 230, lat: -108 },
    { ahead: 380, lat: 108 },
    { ahead: 230, lat: 108 },
];
/** 两座门牙塔紧贴在大本营正面（相对大本营，我方这边；敌方左右镜像），不放在路口 */
export const GATE_TOWERS: [number, number][] = [[118, 74], [118, -74]];

export function drawMap(parent: Node) {
    createSprite('Ground', parent, 'scene/ground_tile', { tiled: true, width: WORLD_W + 400, height: WORLD_H + 400 });
    const g = createGraphics('Roads', parent);
    g.lineJoin = Graphics.LineJoin.ROUND;
    g.lineCap = Graphics.LineCap.ROUND;
    // 一层层叠：外圈深色路肩 → 路面 → 路心浅色；广场和路一起画，接缝处自然连上
    const layer = (w: number, c: Color) => {
        g.strokeColor = c;
        g.fillColor = c;
        for (const side of [-1, 1]) {
            g.ellipse(side * BASE_X, 0, PLAZA.rx + (w - ROAD_W) / 2, PLAZA.ry + (w - ROAD_W) / 2);
            g.fill();
        }
        g.lineWidth = w;
        for (const pts of LANES) {
            pts.forEach(([x, y], i) => i === 0 ? g.moveTo(x, y) : g.lineTo(x, y));
            g.stroke();
        }
    };
    layer(ROAD_W + 18, new Color(120, 86, 52, 150));
    layer(ROAD_W, new Color(176, 134, 86, 255));
    layer(ROAD_W - 56, new Color(198, 160, 110, 255));
    // 路与路之间的空地放树石草垛，地图上下边放营帐旗帜；左右大致对称
    const decor: [string, number, number, number][] = [
        ['scene/pine_1', -620, 120, 90], ['scene/rock_1', -260, 150, 50], ['scene/hay_pile', 160, 130, 54], ['scene/pine_2', 560, 120, 86],
        ['scene/rock_2', -560, -190, 50], ['scene/pine_1', -180, -210, 90], ['scene/crates', 240, -190, 54], ['scene/pine_2', 640, -210, 86],
        ['scene/pine_1', -700, 400, 70], ['scene/rock_1', 100, 410, 44], ['scene/pine_2', 760, 400, 66],
        ['scene/rock_2', -360, -460, 44], ['scene/pine_1', 380, -460, 66],
        ['scene/tent', -1540, 300, 100], ['scene/banner', -1460, -360, 100], ['scene/tent', 1540, -360, 100], ['scene/banner', 1460, 290, 100],
    ];
    for (const [path, x, y, h] of decor) createSprite('Decor', parent, path, { height: h, anchorY: 0 }).setPosition(x, y);
}
