import { Color, Graphics, Label, Node } from 'cc';
import { createGraphics, createLabel, createNode } from '../core/Nodes';
import { BuildingDef, SIDE_COLOR, UnitDef } from './Defs';

export type Side = 1 | -1;

const HP_BG = new Color(30, 22, 18, 170);
const HP_FG: Record<number, Color> = { 1: new Color(90, 200, 110), [-1]: new Color(220, 70, 50) };
const RUBBLE = new Color(110, 100, 90, 255);

function drawBar(g: Graphics, side: Side, p: number, w: number, y: number) {
    g.clear();
    g.fillColor = HP_BG;
    g.rect(-w / 2, y, w, 5);
    g.fill();
    g.fillColor = HP_FG[side];
    g.rect(-w / 2, y, w * Math.max(0, p), 5);
    g.fill();
}

/** 路上的一个兵：彩色圆牌 + 兵种字；s 是沿路离我方大本营的距离 */
export class Unit {
    readonly node: Node;
    readonly maxHp: number;
    hp: number;
    x = 0;
    y = 0;
    cdT = 0;
    /** 正在打的目标；为空就继续往前走 */
    target: Unit | Building | null = null;
    /** 主城卫兵的岗位：不沿路走，守在这附近 */
    post: [number, number] | null = null;
    private readonly body: Node;
    private readonly bar: Graphics;
    private walkT = Math.random() * 10;
    private lunge = 0;
    private lungeDir = 0;
    private flash = 0;
    private shownHp = -1;

    constructor(parent: Node, readonly def: UnitDef, readonly side: Side, readonly lane: number, public s: number,
        readonly lat: number, readonly dmgMul: number, hpMul: number) {
        this.maxHp = this.hp = Math.round(def.hp * hpMul);
        this.node = createNode(def.name, parent);
        const shadow = createGraphics('Shadow', this.node);
        shadow.fillColor = new Color(20, 14, 10, 60);
        shadow.ellipse(0, -def.radius * 0.9, def.radius, def.radius * 0.35);
        shadow.fill();
        this.body = createNode('Body', this.node);
        const g = this.body.addComponent(Graphics);
        const c = SIDE_COLOR[side];
        g.fillColor = c.fill;
        g.strokeColor = c.rim;
        g.lineWidth = 2;
        if (def.kind === 'che') g.roundRect(-def.radius, -def.radius, def.radius * 2, def.radius * 2, 5);
        else g.circle(0, 0, def.radius);
        g.fill();
        g.stroke();
        const l: Label = createLabel('Glyph', this.body, def.glyph, Math.round(def.radius * 1.25), Color.WHITE);
        l.enableOutline = true;
        l.outlineColor = new Color(20, 14, 10, 255);
        l.outlineWidth = 2;
        this.bar = createGraphics('Hp', this.node);
    }

    get alive() { return this.hp > 0; }
    get radius() { return this.def.radius; }

    hurt(d: number) { this.hp -= d; this.flash = 0.1; }

    /** 近战出手时往目标方向一冲 */
    strike(towardX: number) { this.lunge = 1; this.lungeDir = Math.sign(towardX - this.x) || this.side; }

    sync(dt: number, walking: boolean) {
        if (walking) this.walkT += dt * 10;
        if (this.lunge > 0) this.lunge = Math.max(0, this.lunge - dt * 5);
        if (this.flash > 0) this.flash -= dt;
        const hop = walking ? Math.abs(Math.sin(this.walkT)) * 4 : 0;
        this.node.setPosition(this.x, this.y);
        this.body.setPosition(this.lungeDir * Math.sin(this.lunge * Math.PI) * 10, hop);
        this.body.setScale(this.flash > 0 ? 1.15 : 1, this.flash > 0 ? 0.88 : 1);
        if (this.hp !== this.shownHp) {
            this.shownHp = this.hp;
            if (this.hp < this.maxHp) drawBar(this.bar, this.side, this.hp / this.maxHp, this.def.radius * 2.2, this.def.radius + 6);
        }
    }
}

export type BuildingKind = 'tower' | 'gate' | 'barracks' | 'base';

/** 箭塔、兵营、大本营：石台 + 大字；被拆后变成灰色废墟 */
export class Building {
    readonly node: Node;
    readonly maxHp: number;
    hp: number;
    cdT = 0;
    readonly radius: number;
    private readonly bar: Graphics;
    private readonly label: Label;
    private readonly base: Graphics;
    private flash = 0;
    private shownHp = -1;
    /** 不属于某一路的建筑（大本营、门牙塔）在每条路上对应的位置 */
    sOn: number[] = [];

    /** s：所在那条路上的位置；大本营、门牙塔 lane 为 -1，用 sOn */
    constructor(parent: Node, readonly kind: BuildingKind, readonly def: BuildingDef, readonly side: Side,
        readonly lane: number, readonly s: number, readonly x: number, readonly y: number) {
        this.maxHp = this.hp = def.hp;
        this.radius = kind === 'base' ? 84 : kind === 'barracks' ? 50 : kind === 'gate' ? 34 : 30;
        this.node = createNode(def.name, parent);
        this.node.setPosition(x, y);
        this.base = createGraphics('Base', this.node);
        const size = kind === 'base' ? 92 : kind === 'barracks' ? 56 : kind === 'gate' ? 44 : 38;
        this.label = createLabel('Glyph', this.node, def.glyph, size, Color.WHITE);
        this.label.node.setPosition(0, this.radius * 0.55);
        this.label.enableOutline = true;
        this.label.outlineColor = new Color(20, 14, 10, 255);
        this.label.outlineWidth = 3;
        this.bar = createGraphics('Hp', this.node);
        this.drawBase(SIDE_COLOR[side].fill, SIDE_COLOR[side].rim);
    }

    get alive() { return this.hp > 0; }
    get attacks() { return !!this.def.attack && this.alive; }

    hurt(d: number) {
        if (!this.alive) return;
        this.hp -= d;
        this.flash = 0.08;
        if (this.hp <= 0) {
            this.hp = 0;
            this.label.color = RUBBLE;
            this.drawBase(RUBBLE, new Color(80, 72, 64, 255));
            this.bar.clear();
        }
    }

    sync(dt: number) {
        if (this.flash > 0) this.flash -= dt;
        const s = this.flash > 0 ? 1.06 : 1;
        this.label.node.setScale(s, s);
        if (this.alive && this.hp !== this.shownHp) {
            this.shownHp = this.hp;
            // 血条画在台基下方：上路的塔靠近屏幕顶端，画在上面会被状态栏挡住
            drawBar(this.bar, this.side, this.hp / this.maxHp, this.radius * 2, -this.radius * 0.5 - 14);
        }
    }

    private drawBase(fill: Color, rim: Color) {
        const g = this.base, r = this.radius;
        g.clear();
        g.fillColor = new Color(20, 14, 10, 70);
        g.ellipse(0, -r * 0.15, r * 1.15, r * 0.42);
        g.fill();
        g.fillColor = fill;
        g.strokeColor = rim;
        g.lineWidth = 3;
        for (let i = 0; i < 8; i++) {
            const a = Math.PI / 8 + i * Math.PI / 4, px = Math.cos(a) * r, py = Math.sin(a) * r * 0.45;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.close();
        g.fill();
        g.stroke();
    }
}
