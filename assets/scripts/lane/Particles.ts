import { Color, Graphics, Node } from 'cc';
import { createGraphics } from '../core/Nodes';

interface Particle {
    x: number; y: number; vx: number; vy: number;
    life: number; max: number;
    size: number; grow: number;
    r: number; g: number; b: number; a: number;
    /** 每秒向上的加速度（火焰上飘为正，碎屑下落为负） */
    lift: number;
    drag: number;
}

export interface EmitOpts {
    color: Color;
    speed?: number;
    size?: number;
    life?: number;
    /** 大小每秒变化量，负数表示越烧越小 */
    grow?: number;
    lift?: number;
    drag?: number;
    /** 发射方向（弧度）和散布角；不给则四面八方 */
    dir?: number;
    spread?: number;
    /** 出生位置的随机半径 */
    jitter?: number;
}

const MAX = 1500;

/** 程序粒子：所有粒子画在同一个 Graphics 上，每帧重画，数量上千也只是一次绘制 */
export class Particles {
    private readonly g: Graphics;
    private readonly list: Particle[] = [];
    private readonly tmp = new Color();

    constructor(parent: Node) {
        this.g = createGraphics('Particles', parent);
    }

    emit(x: number, y: number, n: number, o: EmitOpts) {
        for (let i = 0; i < n && this.list.length < MAX; i++) {
            const ang = o.dir === undefined ? Math.random() * Math.PI * 2 : o.dir + (Math.random() - 0.5) * (o.spread ?? 0.6);
            const sp = (o.speed ?? 120) * (0.4 + Math.random() * 0.8);
            const j = o.jitter ?? 0;
            const life = (o.life ?? 0.6) * (0.6 + Math.random() * 0.6);
            this.list.push({
                x: x + (Math.random() - 0.5) * 2 * j, y: y + (Math.random() - 0.5) * 2 * j,
                vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
                life, max: life,
                size: (o.size ?? 4) * (0.7 + Math.random() * 0.6), grow: o.grow ?? -2,
                r: o.color.r, g: o.color.g, b: o.color.b, a: o.color.a,
                lift: o.lift ?? 0, drag: o.drag ?? 2,
            });
        }
    }

    update(dt: number) {
        const g = this.g;
        g.clear();
        for (let i = this.list.length - 1; i >= 0; i--) {
            const p = this.list[i];
            p.life -= dt;
            p.size += p.grow * dt;
            if (p.life <= 0 || p.size <= 0.2) { this.list[i] = this.list[this.list.length - 1]; this.list.pop(); continue; }
            const k = Math.exp(-p.drag * dt);
            p.vx *= k;
            p.vy = p.vy * k + p.lift * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            const t = p.life / p.max;
            this.tmp.set(p.r, p.g, p.b, p.a * Math.min(1, t * 1.6));
            g.fillColor = this.tmp;
            g.circle(p.x, p.y, p.size);
            g.fill();
        }
    }

    clear() { this.list.length = 0; this.g.clear(); }
}
