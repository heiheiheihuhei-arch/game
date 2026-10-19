import { Graphics } from 'cc';

// Graphics.arc 在 y 轴向上的坐标系里，"逆时针"参数的方向不直观，容易画成绕远路的大弧；
// 统一用折线自己画，方向就是数学上的逆时针（角度从 a0 增加到 a1）

export function arcPath(g: Graphics, cx: number, cy: number, r: number, a0: number, a1: number) {
    const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 0.12));
    for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * i / n;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
}

/** 扇形：从圆心出发，扫过 a0→a1 */
export function piePath(g: Graphics, r: number, a0: number, a1: number) {
    g.moveTo(0, 0);
    const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 0.12));
    for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * i / n;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.close();
}

/** 圆的下半部分，水位 p(0→1) 从底部往上涨，用来画气槽 */
export function waterPath(g: Graphics, r: number, p: number) {
    const level = -r + 2 * r * Math.max(0, Math.min(1, p));
    const a = Math.asin(Math.max(-1, Math.min(1, level / r)));
    arcPath(g, 0, 0, r, Math.PI - a, Math.PI * 2 + a);
    g.close();
}
