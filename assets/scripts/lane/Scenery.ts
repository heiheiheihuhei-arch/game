import { Color, Graphics, Node, Sprite, UIOpacity } from 'cc';
import { createGraphics, createNode } from '../core/Nodes';
import { createSprite, readySprite } from '../core/Res';
import { LAYOUT, WORLD_H, WORLD_W } from './MapDef';

/**
 * 战场布景：地上的战斗痕迹、和兵一起按前后排序的摆件（树、石头、拒马、营地）、会动的东西（篝火、军旗、飞过的乌鸦、飘过的云影）。
 * 素材在 assets/art/bg（tools/art/build_bg.py 生成）；位置只写我方这半边，敌方左右镜像、军旗换成红色。
 */

/** 循环播放的逐帧摆件：目录、帧数、每秒几帧、显示高度 */
const LOOPS = {
    campfire: { dir: 'bg/campfire', n: 8, fps: 9, h: 46 },
    banner_blue: { dir: 'bg/banner_blue', n: 8, fps: 7, h: 92 },
    banner_red: { dir: 'bg/banner_red', n: 8, fps: 7, h: 92 },
    crow: { dir: 'bg/crow', n: 8, fps: 12, h: 26 },
};
type LoopKind = keyof typeof LOOPS;

/** 地上的痕迹（铺在地面层，不挡兵）：[图, x, y, 宽]；主要在中间交战区 */
const SCARS: [string, number, number, number][] = [
    ['scorch', -620, 40, 90], ['crater', -380, -30, 70], ['arrows', -250, 120, 44], ['tracks', -120, 300, 90],
    ['shield', -460, -150, 46], ['scorch', -160, -300, 80], ['arrows', -60, -110, 40], ['crater', -820, 290, 64],
    ['puddle', -300, -400, 70], ['tracks', -700, -300, 84], ['arrows', -560, 330, 40], ['shield', -90, 170, 42],
    ['scorch', -30, 20, 70], ['arrows', -940, -40, 38], ['crater', -1000, -280, 56],
];

/** 摆件（和兵一起按 y 排前后）：[图, x, y, 显示高度]；只放在路外的草地上 */
const PROPS: [string, number, number, number][] = [
    // 路与路之间的草地
    ['tree_round', -760, 130, 110], ['rocks', -560, 165, 40], ['bush', -420, 120, 40], ['tree_pine', -240, 140, 120],
    ['stump', -120, 175, 30], ['grass_tuft', -650, 110, 30], ['cart', -320, 155, 56],
    ['tree_pine', -820, -160, 118], ['bush', -660, -120, 40], ['grass_tuft', -520, -175, 30], ['rocks', -360, -130, 42],
    ['tree_round', -180, -165, 104], ['grass_tuft', -40, -120, 28],
    // 地图上下边
    ['tree_round', -1000, 425, 100], ['tree_pine', -700, 440, 110], ['bush', -540, 420, 36], ['tree_round', -360, 440, 96],
    ['rocks', -200, 415, 34], ['tree_pine', -60, 445, 104],
    ['tree_pine', -1050, -400, 110], ['tree_round', -760, -420, 100], ['stump', -600, -395, 28], ['tree_pine', -430, -425, 112],
    ['bush', -260, -400, 36], ['tree_round', -110, -430, 96],
    // 前线的拒马
    ['barricade', -880, 160, 40], ['barricade', -880, -150, 40],
    // 大本营角落的营地
    ['crates', -1470, 370, 42], ['rack', -1630, 330, 48], ['drum', -1380, 405, 44], ['palisade', -1680, -340, 44],
    ['crates', -1450, -395, 40], ['rack', -1340, -360, 46],
    ['tree_pine', -1700, 420, 110], ['tree_round', -1250, -440, 100],
];

/** 会动的摆件：[种类, x, y]，军旗写 banner，按阵营换色 */
const ANIMS: ['campfire' | 'banner', number, number][] = [
    ['campfire', -1560, 380], ['campfire', -1560, -365], ['banner', -1330, 280], ['banner', -1330, -255], ['banner', -1690, 0],
];

/** 敌方半边换一种树，避免和我方一模一样 */
const SWAP: Record<string, string> = { tree_round: 'tree_pine', tree_pine: 'tree_round', bush: 'grass_tuft', rocks: 'stump', cart: 'crates' };
/** 按坐标算的固定偏移（每局一样，-r ~ r） */
const jitter = (v: number, r: number) => (Math.sin(v * 12.9898) * 43758.5453 % 1) * r;

class Loop {
    readonly node: Node;
    private readonly sprite: Sprite;
    private t = Math.random() * 5;
    private shown = -1;

    constructor(parent: Node, private readonly kind: LoopKind, x: number, y: number) {
        const c = LOOPS[kind];
        this.node = createSprite(kind, parent, `${c.dir}/f_0`, { height: c.h, anchorY: 0 });
        this.node.setPosition(x, y);
        this.sprite = this.node.getComponent(Sprite)!;
    }

    update(dt: number) {
        const c = LOOPS[this.kind];
        this.t += dt;
        const f = Math.floor(this.t * c.fps) % c.n;
        if (f === this.shown) return;
        const sf = readySprite(`${c.dir}/f_${f}`);
        if (!sf) return;
        this.shown = f;
        this.sprite.spriteFrame = sf;
    }
}

/** 飞过战场的乌鸦：从一边飞到另一边，飞完歇一会儿再从随机高度飞回来 */
class Crow {
    readonly loop: Loop;
    private vx = 0;
    private wait: number;
    private y0 = 0;
    private t = 0;

    constructor(parent: Node) {
        this.loop = new Loop(parent, 'crow', -9999, 0);
        this.wait = 2 + Math.random() * 10;
    }

    update(dt: number) {
        const n = this.loop.node;
        if (this.wait > 0) {
            this.wait -= dt;
            n.active = false;
            if (this.wait <= 0) {
                const dir = Math.random() < 0.5 ? 1 : -1;
                this.vx = dir * (80 + Math.random() * 50);
                this.y0 = (Math.random() - 0.5) * WORLD_H * 0.8;
                n.setPosition(-dir * (WORLD_W / 2 + 40), this.y0);
                n.setScale(dir, 1);
                n.active = true;
                this.t = 0;
            }
            return;
        }
        this.t += dt;
        this.loop.update(dt);
        const x = n.position.x + this.vx * dt;
        n.setPosition(x, this.y0 + Math.sin(this.t * 1.7) * 18 + this.t * 6);
        if (Math.abs(x) > WORLD_W / 2 + 60) this.wait = 6 + Math.random() * 12;
    }
}

/** 一片云影：叠几层淡淡的椭圆假装柔边，慢慢往右飘，飘出地图就从左边回来 */
class CloudShadow {
    readonly node: Node;
    private readonly speed = 10 + Math.random() * 8;

    constructor(parent: Node, x: number, y: number) {
        const g = createGraphics('Cloud', parent);
        this.node = g.node;
        const rx = 220 + Math.random() * 160, ry = rx * (0.45 + Math.random() * 0.2);
        for (let i = 0; i < 6; i++) {
            const k = 1 - i * 0.13;
            g.fillColor = new Color(10, 20, 10, 9);
            g.ellipse(Math.sin(i) * 30, Math.cos(i * 2) * 14, rx * k, ry * k);
            g.fill();
        }
        this.node.setPosition(x, y);
    }

    update(dt: number) {
        let x = this.node.position.x + this.speed * dt;
        if (x > WORLD_W / 2 + 400) x = -WORLD_W / 2 - 400;
        this.node.setPosition(x, this.node.position.y);
    }
}

export class Scenery {
    private readonly loops: Loop[] = [];
    private readonly crows: Crow[] = [];
    private readonly clouds: CloudShadow[] = [];

    /** ground：地面层（地图图上面、兵下面）；actors：和兵一起排序的层；sky：所有东西上面 */
    constructor(ground: Node, actors: Node, sky: Node) {
        // 痕迹、摆件、营地是给老地图手放的；AI 画的关卡图自带这些，只留乌鸦和云影
        for (const side of LAYOUT.decor ? [1, -1] : []) {
            for (const [img, x, y, w] of SCARS) {
                const n = createSprite('Scar', ground, `bg/${img}`, { width: w });
                // 敌方半边不是严格镜像：错开一点、上下翻一下，避免中间看出对称
                n.setPosition(x * side + (side === -1 ? jitter(x, 90) : 0), side === -1 ? -y + jitter(y, 40) : y);
                n.setScale(side * (Math.random() < 0.5 ? 1 : -1), 1);
                n.addComponent(UIOpacity).opacity = 225;
            }
            for (const [img0, x, y, h] of PROPS) {
                const img = side === -1 ? (SWAP[img0] ?? img0) : img0;
                const n = createSprite('Prop', actors, `bg/${img}`, { height: h, anchorY: 0 });
                // 大本营营地、拒马按位置严格镜像；草地上的树石错开一点
                const camp = Math.abs(x) > 1250 || img0 === 'barricade';
                n.setPosition(x * side + (side === -1 && !camp ? jitter(x + y, 70) : 0), y);
                // 敌方那边左右翻过来；拒马要朝向敌人
                if (side === -1) n.setScale(-1, 1);
            }
            for (const [kind, x, y] of ANIMS) {
                const k: LoopKind = kind === 'banner' ? (side === 1 ? 'banner_blue' : 'banner_red') : 'campfire';
                const l = new Loop(actors, k, x * side, y);
                if (side === -1 && kind === 'banner') l.node.setScale(-1, 1);
                this.loops.push(l);
            }
        }
        for (let i = 0; i < 3; i++) this.crows.push(new Crow(sky));
        for (let i = 0; i < 4; i++) this.clouds.push(new CloudShadow(sky, -WORLD_W / 2 + i * WORLD_W / 4 + Math.random() * 300, (Math.random() - 0.5) * WORLD_H * 0.7));
    }

    update(dt: number) {
        for (const l of this.loops) l.update(dt);
        for (const c of this.crows) c.update(dt);
        for (const c of this.clouds) c.update(dt);
    }
}

/** 布景用到的全部图片，开局预加载 */
export function sceneryAssets(): string[] {
    const singles = new Set([...SCARS.map(s => s[0]), ...PROPS.map(p => p[0])]);
    return [...Array.from(singles).map(s => `bg/${s}`),
        ...Object.values(LOOPS).flatMap(c => Array.from({ length: c.n }, (_, i) => `${c.dir}/f_${i}`))];
}
