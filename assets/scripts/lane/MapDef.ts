import { Color, Graphics, Node } from 'cc';
import { createGraphics } from '../core/Nodes';
import { createSprite } from '../core/Res';

/** 整张地图的大小，比屏幕大，靠拖动查看 */
export const WORLD_W = 3500;
export const WORLD_H = 1440;
export const BASE_X = 1560;

/** 三条路都从我方大本营（左）通到敌方大本营（右）；沿路的距离 s 从我方这头算起 */
export const LANES: [number, number][][] = [
    [[-1450, 120], [-1120, 540], [1120, 540], [1450, 120]],
    [[-1450, 0], [1450, 0]],
    [[-1450, -120], [-1120, -540], [1120, -540], [1450, -120]],
];
export const LANE_NAMES = ['上路', '中路', '下路'];
const ROAD_W = 70;

const lens = LANES.map(pts => {
    const segs: number[] = [];
    for (let i = 0; i + 1 < pts.length; i++) segs.push(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
    return segs;
});
export const LANE_LEN = lens.map(segs => segs.reduce((a, b) => a + b, 0));

/** 路上距离 s 处的坐标，lat 是垂直于路的偏移（让一队兵不挤成一条线） */
export function lanePoint(lane: number, s: number, lat = 0): [number, number] {
    const pts = LANES[lane], segs = lens[lane];
    let i = 0;
    s = Math.max(0, Math.min(LANE_LEN[lane], s));
    while (i < segs.length - 1 && s > segs[i]) { s -= segs[i]; i++; }
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const t = s / segs[i], dx = (bx - ax) / segs[i], dy = (by - ay) / segs[i];
    return [ax + (bx - ax) * t - dy * lat, ay + (by - ay) * t + dx * lat];
}

/** 每条路上建筑的位置（占全长的比例），敌方对称 */
export const SPOTS = { barracks: 0.08, innerTower: 0.2, outerTower: 0.36 };

export function drawMap(parent: Node) {
    createSprite('Ground', parent, 'scene/ground_tile', { tiled: true, width: WORLD_W + 400, height: WORLD_H + 400 });
    const g = createGraphics('Roads', parent);
    g.lineJoin = Graphics.LineJoin.ROUND;
    g.lineCap = Graphics.LineCap.ROUND;
    const stroke = (w: number, c: Color) => {
        for (const pts of LANES) {
            g.lineWidth = w;
            g.strokeColor = c;
            g.moveTo(-BASE_X, pts[0][1] * 0.3);
            for (const [x, y] of pts) g.lineTo(x, y);
            g.lineTo(BASE_X, pts[pts.length - 1][1] * 0.3);
            g.stroke();
        }
    };
    stroke(ROAD_W + 16, new Color(120, 86, 52, 150));
    stroke(ROAD_W, new Color(176, 134, 86, 255));
    stroke(ROAD_W - 30, new Color(198, 160, 110, 255));
    // 两路之间的空地放些树石营帐，地图不至于空荡荡；左右对称
    const decor: [string, number, number, number][] = [
        ['scene/pine_1', -700, 300, 150], ['scene/pine_2', -300, 270, 130], ['scene/rock_1', 200, 300, 90],
        ['scene/pine_1', 650, 260, 150], ['scene/rock_2', -500, -280, 90], ['scene/pine_2', 0, -300, 140],
        ['scene/pine_1', 450, -290, 150], ['scene/hay_pile', -900, -260, 90], ['scene/crates', 900, 280, 90],
        ['scene/pine_2', -1000, 680, 130], ['scene/pine_1', 300, 690, 140], ['scene/rock_1', -200, -690, 90],
        ['scene/pine_2', 950, -680, 130], ['scene/tent', -1400, 420, 160], ['scene/tent', 1400, -420, 160],
        ['scene/banner', -1300, -330, 150], ['scene/banner', 1300, 330, 150],
    ];
    for (const [path, x, y, h] of decor) createSprite('Decor', parent, path, { height: h, anchorY: 0 }).setPosition(x, y);
}
