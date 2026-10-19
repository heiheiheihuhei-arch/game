import { Color, Graphics, Label, Node, Sprite, UITransform } from 'cc';
import { createGraphics, createLabel, createNode } from '../core/Nodes';
import { createSprite } from '../core/Res';
import { BuildingDef, SIDE_COLOR, UnitDef } from './Defs';

export type Side = 1 | -1;

const HP_BG = new Color(30, 22, 18, 170);
const HP_FG: Record<number, Color> = { 1: new Color(90, 200, 110), [-1]: new Color(220, 70, 50) };
const RUBBLE = new Color(110, 100, 90, 255);
const HURT = new Color(255, 240, 230, 255);
const HURT_TINT = new Color(255, 150, 140, 255);
const SHAFT = new Color(120, 84, 46, 255);
const STEEL = new Color(225, 230, 238, 255);
const EDGE = new Color(30, 22, 16, 255);
/** 枪兵出手：长枪放平刺出再收回的总时长，前 35% 刺出、其余收回 */
const THRUST_TIME = 0.32;
const THRUST_OUT = 0.35;
/** 弓兵出手：搭箭拉满弦的时长，拉满才放箭；放箭后弓弦抖动的时长 */
const DRAW_TIME = 0.42;
const TWANG_TIME = 0.18;
const BOW = new Color(110, 70, 36, 255);
const STRING = new Color(240, 235, 220, 255);

function drawBar(g: Graphics, side: Side, p: number, w: number, y: number) {
    g.clear();
    g.fillColor = HP_BG;
    g.rect(-w / 2, y, w, 5);
    g.fill();
    g.fillColor = HP_FG[side];
    g.rect(-w / 2, y, w * Math.max(0, p), 5);
    g.fill();
}

const ease = (k: number) => 1 - Math.pow(1 - k, 3);

/** 路上的一个兵：就是一个字（我方蓝、敌方红）；s 是沿路离我方大本营的距离 */
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
    private readonly glyph: Label | null = null;
    private readonly glyphImg: Sprite | null = null;
    private readonly spear: Node | null = null;
    private readonly bar: Graphics;
    private walkT = Math.random() * 10;
    private lunge = 0;
    private lungeDir = 0;
    private flash = 0;
    private shownHp = -1;
    private thrustT = 0;
    private readonly bow: Graphics | null;
    private drawT = -1;
    private twangT = 0;
    private bowDir: number;
    private onRelease: (() => void) | null = null;

    constructor(parent: Node, readonly def: UnitDef, readonly side: Side, readonly lane: number, public s: number,
        readonly lat: number, readonly dmgMul: number, hpMul: number) {
        this.maxHp = this.hp = Math.round(def.hp * hpMul);
        this.node = createNode(def.name, parent);
        const shadow = createGraphics('Shadow', this.node);
        shadow.fillColor = new Color(20, 14, 10, 60);
        shadow.ellipse(0, -def.radius * 0.9, def.radius * 0.9, def.radius * 0.3);
        shadow.fill();
        this.bowDir = side;
        this.body = createNode('Body', this.node);
        const c = SIDE_COLOR[side];
        if (def.weapon) {
            // 兵器拿在字的前侧、画在字后面；锚点在握的位置
            this.spear = createSprite('Weapon', this.body, def.weapon.path, { height: def.weapon.h });
            this.spear.getComponent(UITransform)!.setAnchorPoint(0.5, 0.3);
        }
        if (def.img) {
            const n = createSprite('Glyph', this.body, side === 1 ? def.img.me : def.img.foe, { height: def.img.h });
            this.glyphImg = n.getComponent(Sprite);
        } else {
            this.glyph = createLabel('Glyph', this.body, def.glyph, Math.round(def.radius * 2.1), c.rim);
            this.glyph.enableOutline = true;
            this.glyph.outlineColor = c.fill;
            this.glyph.outlineWidth = 4;
            this.glyph.enableShadow = true;
            this.glyph.shadowColor = new Color(20, 14, 10, 150);
        }
        // 弓拿在字的前面
        this.bow = def.kind === 'gong' ? createGraphics('Bow', this.body) : null;
        this.bar = createGraphics('Hp', this.node);
    }

    get alive() { return this.hp > 0; }
    get radius() { return this.def.radius; }

    hurt(d: number) { this.hp -= d; this.flash = 0.1; }

    /** 弓兵出手：搭箭、拉满弦，拉满那一刻调用 release 放箭 */
    drawBow(towardX: number, release: () => void) {
        this.bowDir = Math.sign(towardX - this.x) || this.side;
        this.drawT = 0;
        this.onRelease = release;
    }

    /** 出手：近战往目标方向一冲；枪兵把长枪刺出去 */
    strike(towardX: number) {
        this.lunge = 1;
        this.lungeDir = Math.sign(towardX - this.x) || this.side;
        if (this.spear) this.thrustT = THRUST_TIME;
    }

    sync(dt: number, walking: boolean) {
        if (walking) this.walkT += dt * 10;
        if (this.lunge > 0) this.lunge = Math.max(0, this.lunge - dt * 5);
        if (this.flash > 0) this.flash -= dt;
        this.node.setPosition(this.x, this.y);
        // 走路：一颠一颠、左右轻晃
        const hop = walking ? Math.abs(Math.sin(this.walkT)) * 5 : 0;
        const sway = walking ? Math.sin(this.walkT) * 5 : 0;
        const ext = this.updateSpear(dt);
        this.updateBow(dt);
        this.body.setPosition(this.lungeDir * Math.sin(this.lunge * Math.PI) * (this.spear ? 4 : 10), hop);
        // 刺枪时字往前探
        this.body.angle = sway - this.lungeDir * ext * 10;
        const sq = this.flash > 0 ? 1.12 : 1;
        this.body.setScale(sq, 2 - sq);
        if (this.glyph) this.glyph.color = this.flash > 0 ? HURT : SIDE_COLOR[this.side].rim;
        if (this.glyphImg) this.glyphImg.color = this.flash > 0 ? HURT_TINT : Color.WHITE;
        if (this.hp !== this.shownHp) {
            this.shownHp = this.hp;
            if (this.hp < this.maxHp) drawBar(this.bar, this.side, this.hp / this.maxHp, this.def.radius * 2.2, this.def.radius + 10);
        }
    }

    /** 画弓：平时松弦；出手时搭箭往后拉满，放箭后弦弹回抖几下 */
    private updateBow(dt: number) {
        const g = this.bow;
        if (!g || !this.alive) return;
        let pull = 0, arrow = false;
        if (this.drawT >= 0) {
            this.drawT += dt;
            pull = Math.min(1, this.drawT / DRAW_TIME);
            arrow = true;
            if (this.drawT >= DRAW_TIME) {
                this.drawT = -1;
                this.twangT = TWANG_TIME;
                const fire = this.onRelease;
                this.onRelease = null;
                fire?.();
            }
        } else if (this.twangT > 0) {
            this.twangT -= dt;
            // 松手后弦往前多弹一点再来回抖
            pull = -Math.sin((1 - this.twangT / TWANG_TIME) * Math.PI * 3) * 0.25 * (this.twangT / TWANG_TIME);
        }
        const d = this.bowDir, r = this.def.radius;
        const bx = d * r * 0.95, h = r * 1.15, w = r * 0.45, y = 2;
        g.clear();
        // 弓身：一道弯弧，两头往后收
        const pts: [number, number][] = [];
        for (let i = 0; i <= 12; i++) {
            const a = -Math.PI / 2 + Math.PI * i / 12;
            pts.push([bx + d * Math.cos(a) * w, y + Math.sin(a) * h]);
        }
        g.strokeColor = EDGE;
        g.lineWidth = 6;
        pts.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py));
        g.stroke();
        g.strokeColor = BOW;
        g.lineWidth = 3;
        pts.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py));
        g.stroke();
        // 弓弦：从弓的上下两头连到拉弦的手
        const [tx, ty] = pts[0], [bx2, by2] = pts[12];
        const hx = bx - d * pull * r * 0.9;
        g.strokeColor = STRING;
        g.lineWidth = 1.5;
        g.moveTo(tx, ty);
        g.lineTo(hx, y);
        g.lineTo(bx2, by2);
        g.stroke();
        if (arrow) {
            // 搭在弦上的箭：箭尾在拉弦的手，箭头伸出弓外
            const head = bx + d * w + d * r * 0.5;
            g.strokeColor = EDGE;
            g.lineWidth = 4;
            g.moveTo(hx, y);
            g.lineTo(head, y);
            g.stroke();
            g.strokeColor = SHAFT;
            g.lineWidth = 2;
            g.moveTo(hx, y);
            g.lineTo(head, y);
            g.stroke();
            g.fillColor = STEEL;
            g.moveTo(head + d * 9, y);
            g.lineTo(head, y + 4);
            g.lineTo(head, y - 4);
            g.close();
            g.fill();
        }
    }

    /** 长枪：平时斜握在身前，出手时放平往前刺、再收回；返回伸出程度 0～1 */
    private updateSpear(dt: number): number {
        const n = this.spear;
        if (!n) return 0;
        let ext = 0;
        if (this.thrustT > 0) {
            this.thrustT -= dt;
            const p = 1 - Math.max(0, this.thrustT) / THRUST_TIME;
            ext = p < THRUST_OUT ? ease(p / THRUST_OUT) : 1 - ease((p - THRUST_OUT) / (1 - THRUST_OUT));
        }
        const d = this.lungeDir || this.side, r = this.def.radius;
        // 平时枪尖斜指前上方（偏 25°），刺出时转平（90°）
        const tilt = 25 + (90 - 25) * Math.min(1, ext * 1.6);
        n.angle = -d * tilt;
        n.setScale(d, 1);
        n.setPosition(d * (r * 0.75 + ext * (this.def.range + 10)), -r * 0.3);
        return ext;
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
    private readonly label: Label | null = null;
    private readonly base: Graphics;
    private readonly img: Node | null = null;
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
        if (def.img) {
            // 建筑图脚底放在地面上
            const path = side === 1 ? def.img.me : def.img.foe;
            this.img = createSprite('Img', this.node, path, { width: def.img.w, height: def.img.h, anchorY: 0 });
            this.img.setPosition(0, -this.radius * 0.45);
            this.drawShadow();
        } else {
            const size = kind === 'base' ? 92 : kind === 'barracks' ? 56 : kind === 'gate' ? 44 : 38;
            this.label = createLabel('Glyph', this.node, def.glyph, size, Color.WHITE);
            this.label.node.setPosition(0, this.radius * 0.55);
            this.label.enableOutline = true;
            this.label.outlineColor = new Color(20, 14, 10, 255);
            this.label.outlineWidth = 3;
            this.drawBase(SIDE_COLOR[side].fill, SIDE_COLOR[side].rim);
        }
        this.bar = createGraphics('Hp', this.node);
    }

    get alive() { return this.hp > 0; }
    get attacks() { return !!this.def.attack && this.alive; }

    hurt(d: number) {
        if (!this.alive) return;
        this.hp -= d;
        this.flash = 0.08;
        if (this.hp <= 0) {
            this.hp = 0;
            if (this.img) {
                // 被拆：灰掉、塌下去一点
                this.img.getComponent(Sprite)!.color = RUBBLE;
                this.img.setScale(0.9, 0.7);
            } else {
                this.label!.color = RUBBLE;
                this.drawBase(RUBBLE, new Color(80, 72, 64, 255));
            }
            this.bar.clear();
        }
    }

    sync(dt: number) {
        if (this.flash > 0) this.flash -= dt;
        const s = this.flash > 0 ? 1.06 : 1;
        if (this.alive) (this.img ?? this.label!.node).setScale(s, s);
        if (this.alive && this.hp !== this.shownHp) {
            this.shownHp = this.hp;
            // 血条画在台基下方：上路的塔靠近屏幕顶端，画在上面会被状态栏挡住
            drawBar(this.bar, this.side, this.hp / this.maxHp, this.radius * 2, -this.radius * 0.5 - 14);
        }
    }

    private drawShadow() {
        const g = this.base, r = this.radius;
        g.clear();
        g.fillColor = new Color(20, 14, 10, 70);
        g.ellipse(0, -r * 0.4, r * 1.2, r * 0.42);
        g.fill();
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
