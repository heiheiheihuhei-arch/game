import { Color, EventTouch, Graphics, Node, UITransform, Vec3, view } from 'cc';
import { createNode } from '../core/Nodes';
import { Battle } from './Battle';
import { LANES, WORLD_H, WORLD_W } from './MapDef';

/** 镜头：地图比屏幕宽，左右移动 world 节点来"拖动"视野，边缘不出界；高度正好一屏，不上下动 */
export class CameraCtl {
    x = 0;
    y = 0;

    constructor(private readonly world: Node) { this.apply(); }

    pan(dx: number) { this.x -= dx; this.apply(); }
    focus(x: number) { this.x = x; this.apply(); }

    /** 屏幕（界面）坐标 → 地图坐标 */
    toWorld(ux: number, uy: number): [number, number] { return [ux + this.x, uy + this.y]; }

    private apply() {
        const vs = view.getVisibleSize();
        const mx = Math.max(0, (WORLD_W - vs.width) / 2), my = Math.max(0, (WORLD_H - vs.height) / 2);
        this.x = Math.max(-mx, Math.min(mx, this.x));
        this.y = Math.max(-my, Math.min(my, this.y));
        this.world.setPosition(-this.x, -this.y);
    }
}

const MM_W = 290;
const MM_H = Math.round(MM_W * WORLD_H / WORLD_W);
const MM = {
    bg: new Color(30, 24, 18, 210), rim: new Color(200, 160, 90, 255), road: new Color(176, 134, 86, 255),
    me: new Color(110, 170, 255, 255), foe: new Color(255, 90, 70, 255), dead: new Color(110, 100, 90, 255),
    view: new Color(255, 255, 255, 200),
};

/** 左下角小地图：点或拖动可以把镜头移过去 */
export class Minimap {
    readonly node: Node;
    private readonly g: Graphics;
    private redrawT = 0;

    constructor(parent: Node, private readonly cam: CameraCtl, private readonly battle: Battle) {
        const vs = view.getVisibleSize();
        this.node = createNode('Minimap', parent);
        this.node.setPosition(-vs.width / 2 + MM_W / 2 + 14, -vs.height / 2 + MM_H / 2 + 14);
        this.node.getComponent(UITransform)!.setContentSize(MM_W, MM_H);
        this.g = this.node.addComponent(Graphics);
        const jump = (e: EventTouch) => {
            e.propagationStopped = true;
            const loc = e.getUILocation();
            const p = this.node.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(loc.x, loc.y, 0));
            this.cam.focus(p.x / MM_W * WORLD_W);
            this.draw();
        };
        this.node.on(Node.EventType.TOUCH_START, jump);
        this.node.on(Node.EventType.TOUCH_MOVE, jump);
        this.node.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; });
    }

    update(dt: number) {
        this.redrawT -= dt;
        if (this.redrawT > 0) return;
        this.redrawT = 0.2;
        this.draw();
    }

    private draw() {
        const g = this.g, k = MM_W / WORLD_W;
        g.clear();
        g.fillColor = MM.bg;
        g.strokeColor = MM.rim;
        g.lineWidth = 2;
        g.roundRect(-MM_W / 2, -MM_H / 2, MM_W, MM_H, 6);
        g.fill();
        g.stroke();
        g.strokeColor = MM.road;
        g.lineWidth = 3;
        for (const pts of LANES) {
            pts.forEach(([x, y], i) => i === 0 ? g.moveTo(x * k, y * k) : g.lineTo(x * k, y * k));
            g.stroke();
        }
        for (const b of this.battle.buildings) {
            g.fillColor = !b.alive ? MM.dead : b.side === 1 ? MM.me : MM.foe;
            const r = b.kind === 'base' ? 7 : b.kind === 'barracks' ? 4.5 : 3.5;
            g.rect(b.x * k - r, b.y * k - r, r * 2, r * 2);
            g.fill();
        }
        for (const u of this.battle.units) {
            g.fillColor = u.side === 1 ? MM.me : MM.foe;
            g.circle(u.x * k, u.y * k, 1.8);
            g.fill();
        }
        const vs = view.getVisibleSize();
        g.strokeColor = MM.view;
        g.lineWidth = 1.5;
        g.rect((this.cam.x - vs.width / 2) * k, (this.cam.y - vs.height / 2) * k, vs.width * k, vs.height * k);
        g.stroke();
    }
}
