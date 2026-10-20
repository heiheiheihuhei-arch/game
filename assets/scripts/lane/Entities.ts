import { Color, Graphics, Label, Node, Sprite, UIOpacity, UITransform } from 'cc';
import { createGraphics, createLabel, createNode } from '../core/Nodes';
import { createSprite, readySprite } from '../core/Res';
import { BuildingDef, DAMAGE_SMOKE, SIDE_COLOR, UnitDef } from './Defs';

export type Side = 1 | -1;

const HP_BG = new Color(30, 22, 18, 170);
const HP_FG: Record<number, Color> = { 1: new Color(90, 200, 110), [-1]: new Color(220, 70, 50) };
const BURNT = new Color(170, 150, 130, 255);
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
/** 逐帧动画：阵亡播多久，最后这一段慢慢变透明；闲置、胜利的播放速度 */
const IDLE_FPS = 6;
const WIN_TIME = 1.2;
const DEATH_FADE = 0.4;
export const DEATH_TIME = 0.9;

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
    /** 逐帧动画的兵：整张图一帧一帧换，代码只管选哪一帧 */
    private readonly anim: Sprite | null = null;
    private animDir = '';
    private shownFrame = '';
    private deathT = -1;
    private winT = -1;
    private idleT = Math.random() * 10;
    private readonly shadow: Graphics;

    constructor(parent: Node, readonly def: UnitDef, readonly side: Side, readonly lane: number, public s: number,
        public lat: number, readonly dmgMul: number, hpMul: number) {
        this.maxHp = this.hp = Math.round(def.hp * hpMul);
        this.node = createNode(def.name, parent);
        const shadow = this.shadow = createGraphics('Shadow', this.node);
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
        if (def.anim) {
            const a = this.animDef!;
            this.animDir = side === 1 ? a.me : a.foe;
            const n = createSprite('Anim', this.body, `${this.animDir}/f_0`, { height: a.h, anchorY: 0 });
            n.setPosition(0, -def.radius * 0.9);
            this.anim = n.getComponent(Sprite);
            this.anim!.trim = false;
        } else if (def.img) {
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
        this.bow = def.kind === 'gong' && !def.anim ? createGraphics('Bow', this.body) : null;
        this.bar = createGraphics('Hp', this.node);
    }

    get alive() { return this.hp > 0; }
    get radius() { return this.def.radius; }
    /** 这个兵用的逐帧动画：敌方有单独的一套就用它 */
    get animDef() { return this.side === -1 && this.def.animFoe ? this.def.animFoe : this.def.anim; }

    /** 被打中：不播受击动作，只闪一下红 */
    hurt(d: number) { this.hp -= d; this.flash = 0.1; }

    /** 有阵亡动画的兵死后留在原地播完再删；返回 false 表示没有动画，可以直接删 */
    startDeath(): boolean {
        if (!this.anim) return false;
        this.deathT = 0;
        this.bar.clear();
        this.node.addComponent(UIOpacity);
        return true;
    }

    /** 播阵亡动画，播完返回 false */
    updateDeath(dt: number): boolean {
        this.deathT += dt;
        const a = this.animDef!, k = Math.min(1, this.deathT / DEATH_TIME);
        this.setFrame(a.death[0] + Math.min(a.death[1] - a.death[0] - 1, Math.floor(k * (a.death[1] - a.death[0]))));
        this.anim!.color = Color.WHITE;
        this.body.setScale(1, 1);
        this.body.angle = 0;
        this.shadow.node.setScale(1 - k, 1 - k);
        this.node.getComponent(UIOpacity)!.opacity = 255 * Math.min(1, (1 - k) / DEATH_FADE);
        return this.deathT < DEATH_TIME;
    }

    private setFrame(i: number) {
        const path = `${this.animDir}/f_${i}`;
        if (path === this.shownFrame) return;
        const sf = readySprite(path);
        if (!sf) return;
        this.shownFrame = path;
        this.anim!.spriteFrame = sf;
    }

    /** 一局赢了：播欢呼，播完停在最后一帧 */
    celebrate() { if (this.winT < 0) this.winT = Math.random() * 0.3; }

    /** 逐帧动画选帧：胜利 > 出手 > 走路 > 站着（被打中不换帧，只闪红）。图不翻转：敌我两边各有一套朝向对的图 */
    private updateAnim(dt: number, walking: boolean) {
        const a = this.animDef!;
        const pick = ([from, to]: [number, number], k: number) => from + Math.min(to - from - 1, Math.floor(k * (to - from)));
        this.idleT += dt;
        let f = a.idle[0] + Math.floor(this.idleT * IDLE_FPS) % (a.idle[1] - a.idle[0]);
        if (this.winT >= 0) {
            this.winT += dt;
            this.setFrame(pick(a.win, this.winT / WIN_TIME));
            this.anim!.color = Color.WHITE;
            return;
        }
        if (this.drawT >= 0) {
            f = pick(a.draw, this.drawT / a.drawTime);
        } else if (this.twangT > 0) {
            f = pick(a.after, 1 - this.twangT / a.afterTime);
        }
        // 走路：播走路循环帧（walkT 每秒涨 10）
        if (walking && this.drawT < 0 && this.twangT <= 0) f = a.walk[0] + Math.floor(this.walkT / 10 * a.walkFps) % (a.walk[1] - a.walk[0]);
        this.setFrame(f);
        this.anim!.color = this.flash > 0 ? HURT_TINT : Color.WHITE;
    }

    /** 有蓄力的出手（弓兵搭箭拉弦、逐帧动画兵的蓄力）：蓄满那一刻调用 release 放箭 / 打中 */
    windup(towardX: number, release: () => void) {
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
        // 走路：一颠一颠、左右轻晃；逐帧动画的兵自己会蹦，不用代码颠
        const hop = walking && !this.anim ? Math.abs(Math.sin(this.walkT)) * 5 : 0;
        const sway = walking && !this.anim ? Math.sin(this.walkT) * 5 : 0;
        const ext = this.updateSpear(dt);
        this.updateBow(dt);
        if (this.anim) this.updateAnim(dt, walking);
        this.body.setPosition(this.lungeDir * Math.sin(this.lunge * Math.PI) * (this.spear ? 4 : 10), hop);
        // 刺枪时字往前探
        this.body.angle = sway - this.lungeDir * ext * 10;
        const sq = this.flash > 0 && !this.anim ? 1.12 : 1;
        this.body.setScale(sq, 2 - sq);
        if (this.glyph) this.glyph.color = this.flash > 0 ? HURT : SIDE_COLOR[this.side].rim;
        if (this.glyphImg) this.glyphImg.color = this.flash > 0 ? HURT_TINT : Color.WHITE;
        if (this.hp !== this.shownHp) {
            this.shownHp = this.hp;
            // 逐帧动画的图比字高，血条放到图的头顶上
            const top = this.animDef ? this.animDef.h * 0.8 - this.def.radius * 0.9 : this.def.radius + 10;
            if (this.hp < this.maxHp) drawBar(this.bar, this.side, this.hp / this.maxHp, this.def.radius * 2.2, top);
        }
    }

    /** 画弓：平时松弦；出手时搭箭往后拉满，放箭后弦弹回抖几下 */
    private updateBow(dt: number) {
        const g = this.bow;
        if ((!g && !this.anim) || !this.alive) return;
        let pull = 0, arrow = false;
        if (this.drawT >= 0) {
            this.drawT += dt;
            const drawTime = this.animDef?.drawTime ?? DRAW_TIME;
            pull = Math.min(1, this.drawT / drawTime);
            arrow = true;
            if (this.drawT >= drawTime) {
                this.drawT = -1;
                this.twangT = this.animDef?.afterTime ?? TWANG_TIME;
                const fire = this.onRelease;
                this.onRelease = null;
                fire?.();
            }
        } else if (this.twangT > 0) {
            this.twangT -= dt;
            // 松手后弦往前多弹一点再来回抖
            pull = -Math.sin((1 - this.twangT / TWANG_TIME) * Math.PI * 3) * 0.25 * (this.twangT / TWANG_TIME);
        }
        if (!g) return;
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

/** 箭塔、兵营、大本营：完好 → 残破（冒烟、着火由 Battle 放粒子）→ 只剩废墟地基 */
export class Building {
    readonly node: Node;
    readonly maxHp: number;
    hp: number;
    cdT = 0;
    readonly radius: number;
    /** 建筑图大概有多高：冒烟、着火从这一带冒出来 */
    readonly height: number;
    private readonly bar: Graphics;
    private readonly whole: Node;
    private readonly broken: Node | null;
    private readonly rubble: Node;
    private readonly shadow: Graphics;
    private flash = 0;
    private shownHp = -1;
    /** 不属于某一路的建筑（大本营、门牙塔）在每条路上对应的位置 */
    sOn: number[] = [];

    /** s：所在那条路上的位置；大本营、门牙塔 lane 为 -1，用 sOn */
    constructor(parent: Node, readonly kind: BuildingKind, readonly def: BuildingDef, readonly side: Side,
        readonly lane: number, readonly s: number, readonly x: number, readonly y: number) {
        this.maxHp = this.hp = def.hp;
        this.radius = kind === 'base' ? 84 : kind === 'barracks' ? 46 : kind === 'gate' ? 30 : 26;
        this.node = createNode(def.name, parent);
        this.node.setPosition(x, y);
        this.shadow = createGraphics('Shadow', this.node);
        const art = def.img, me = side === 1;
        const foot = -this.radius * 0.45;
        // 建筑图脚底放在地面上
        const put = (name: string, path: string, w?: number, h?: number) => {
            const n = createSprite(name, this.node, path, { width: w, height: h, anchorY: 0 });
            n.setPosition(0, foot);
            return n;
        };
        this.rubble = put('Rubble', art.rubble, art.rubbleW);
        this.rubble.active = false;
        const broken = me ? art.meBroken : art.foeBroken;
        this.broken = broken ? put('Broken', broken, art.w, art.h) : null;
        if (this.broken) this.broken.active = false;
        this.whole = put('Whole', me ? art.me : art.foe, art.w, art.h);
        this.height = art.h ?? (art.w ?? 100) * 0.9;
        this.shadow.fillColor = new Color(20, 14, 10, 70);
        this.shadow.ellipse(0, foot + 4, this.radius * 1.2, this.radius * 0.42);
        this.shadow.fill();
        this.bar = createGraphics('Hp', this.node);
    }

    get alive() { return this.hp > 0; }
    get attacks() { return !!this.def.attack && this.alive; }
    get ratio() { return this.hp / this.maxHp; }

    hurt(d: number) {
        if (!this.alive) return;
        this.hp -= d;
        this.flash = 0.08;
        if (this.hp <= 0) {
            // 被拆：只剩一小块地基
            this.hp = 0;
            this.whole.active = false;
            if (this.broken) this.broken.active = false;
            this.rubble.active = true;
            this.shadow.clear();
            this.bar.clear();
        }
    }

    sync(dt: number) {
        if (this.flash > 0) this.flash -= dt;
        if (!this.alive) return;
        // 血量过半多就换残破图；没有残破图的（帐篷）压暗一些
        const hurt = this.ratio < DAMAGE_SMOKE;
        if (this.broken) {
            this.broken.active = hurt;
            this.whole.active = !hurt;
        } else {
            this.whole.getComponent(Sprite)!.color = hurt ? BURNT : Color.WHITE;
        }
        const s = this.flash > 0 ? 1.05 : 1;
        (this.broken?.active ? this.broken : this.whole).setScale(s, s);
        if (this.hp !== this.shownHp) {
            this.shownHp = this.hp;
            // 血条画在脚下：上路的塔靠近屏幕顶端，画在上面会被状态栏挡住
            drawBar(this.bar, this.side, this.ratio, Math.max(56, this.radius * 2), -this.radius * 0.45 - 12);
        }
    }
}
