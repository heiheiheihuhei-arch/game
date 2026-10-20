import { Color } from 'cc';

// ======================= 兵种 =======================
// 三角克制：枪克骑、骑克弓、弓克枪；投石车专拆建筑，打人很弱

export type UnitKind = 'qiang' | 'gong' | 'qi' | 'che' | 'wei';

export interface UnitDef {
    kind: UnitKind;
    /** 兵就是这个字 */
    glyph: string;
    name: string;
    hp: number;
    dmg: number;
    /** 出手间隔（秒） */
    cd: number;
    /** 攻击距离（圆牌边到边）：近战约 36，远程 190 以上 */
    range: number;
    speed: number;
    /** 打兵种 / 建筑时的伤害倍率；不写的按 1 */
    vs: Partial<Record<UnitKind | 'building', number>>;
    /** 远程兵的弹道：箭直飞，石头走抛物线 */
    shot?: 'arrow' | 'stone';
    /** 被杀时对方得到的金币 */
    bounty: number;
    /** 「加派」时每个兵的价钱 */
    cost: number;
    /** 需要先在科技里解锁 */
    locked?: boolean;
    radius: number;
    /** Q 版字的图（我方、敌方）和显示高度；没有图的兵种用普通文字 */
    img?: { me: string; foe: string; h: number };
    /** 手里的兵器图（竖着画、刃朝上）和显示高度 */
    weapon?: { path: string; h: number };
    /** 逐帧动画：目录下 f_0…f_N（朝右画、地面贴底边），显示高度，各动作用哪几帧 [起, 止) */
    anim?: UnitAnim;
    /** 敌方单独用的一套逐帧动画（帧数、节奏和我方不同时）；不写就用 anim 的 foe 目录 */
    animFoe?: UnitAnim;
}

export interface UnitAnim {
    /** 我方的图朝右画，敌方的图朝左画（字不能翻转，所以两边各画一套，播放时不翻转） */
    me: string;
    foe: string;
    h: number;
    /** 站着不动时循环播的帧（呼吸起伏） */
    idle: [number, number];
    /** 出手：draw 是蓄力（弓兵取箭拉弦、枪兵后拉、骑兵举戟），播 drawTime 秒，播完那一刻放箭 / 打中；after 是出手后收招，播 afterTime 秒 */
    draw: [number, number];
    after: [number, number];
    drawTime: number;
    afterTime: number;
    /** 走路循环的帧、每秒播几帧（骑兵的马小跑快一点） */
    walk: [number, number];
    walkFps: number;
    death: [number, number];
    /** 一局赢了，赢的一方全体播的欢呼（播完停在最后一帧） */
    win: [number, number];
}

/** 建筑动画的全部帧路径，开局预加载用 */
export function buildingFrames(a: BuildingAnim): string[] {
    return [a.me, a.foe].flatMap(dir => Array.from({ length: a.death[1] }, (_, i) => `${dir}/f_${i}`));
}

/** 某个兵种动画的全部帧路径，开局预加载用 */
export function animFrames(a: UnitAnim): string[] {
    const n = Math.max(a.idle[1], a.draw[1], a.after[1], a.death[1], a.walk[1], a.win[1]);
    return [a.me, a.foe].flatMap(dir => Array.from({ length: n }, (_, i) => `${dir}/f_${i}`));
}

export const UNITS: Record<UnitKind, UnitDef> = {
    qiang: {
        kind: 'qiang', glyph: '枪', name: '枪兵', hp: 195, dmg: 16, cd: 1.0, range: 70, speed: 62,
        vs: { qi: 1.8, building: 1 }, bounty: 8, cost: 18, radius: 16,
        anim: { me: 'q/u8_qiang_blue', foe: 'q/u8_qiang_red', h: 87, idle: [0, 10], walk: [10, 20], draw: [20, 25], after: [25, 34], drawTime: 0.3, afterTime: 0.45, death: [34, 46], win: [46, 58], walkFps: 12 },
    },
    gong: {
        kind: 'gong', glyph: '弓', name: '弓兵', hp: 112, dmg: 15, cd: 1.15, range: 190, speed: 58,
        vs: { qiang: 1.7, building: 0.8 }, shot: 'arrow', bounty: 8, cost: 21, radius: 15,
        anim: { me: 'q/u6_gong_blue', foe: 'q/u6_gong_red', h: 62, idle: [0, 10], walk: [10, 20], draw: [20, 28], after: [28, 34], drawTime: 0.45, afterTime: 0.35, death: [34, 46], win: [46, 58], walkFps: 12 },
    },
    qi: {
        kind: 'qi', glyph: '骑', name: '骑兵', hp: 255, dmg: 22, cd: 1.1, range: 38, speed: 105,
        vs: { gong: 1.9, building: 0.9 }, bounty: 12, cost: 33, locked: true, radius: 18,
        anim: { me: 'q/u6_qi_blue', foe: 'q/u6_qi_red', h: 103, idle: [0, 10], walk: [10, 20], draw: [20, 25], after: [25, 34], drawTime: 0.3, afterTime: 0.4, death: [34, 46], win: [46, 58], walkFps: 14 },
    },
    che: {
        kind: 'che', glyph: '车', name: '投石车', hp: 240, dmg: 69, cd: 3.2, range: 280, speed: 40,
        vs: { building: 3, qiang: 0.4, gong: 0.4, qi: 0.4, che: 0.4 }, shot: 'stone', bounty: 18, cost: 60, locked: true, radius: 20,
    },
    /** 主城卫队：只能在主城花大价钱买，守在大本营附近，不出去推线 */
    wei: {
        kind: 'wei', glyph: '卫', name: '卫兵', hp: 1350, dmg: 60, cd: 0.9, range: 40, speed: 95,
        vs: {}, bounty: 45, cost: 0, radius: 20,
    },
};
export const UNIT_ORDER: UnitKind[] = ['qiang', 'gong', 'qi', 'che'];
/** 每个兵种被什么克：电脑看你出什么，就换成克制它的兵 */
export const COUNTER: Record<UnitKind, UnitKind> = { qiang: 'gong', gong: 'qi', qi: 'qiang', che: 'qi', wei: 'gong' };

// ======================= 建筑 =======================

export interface BuildingDef {
    name: string;
    glyph: string;
    hp: number;
    /** 会射箭的建筑：伤害、间隔、射程；兵营不攻击 */
    attack?: { dmg: number; cd: number; range: number };
    bounty: number;
    /** 建筑动画（闲置、射箭、倒塌） */
    img: BuildingArt;
}

export interface BuildingArt {
    anim: BuildingAnim;
}

/** 建筑逐帧动画（tools/art/build_buildings.py 生成）：三种血量各一段闲置循环、会射箭的三种血量各一段攻击、一段倒塌（停在最后一帧的废墟） */
export interface BuildingAnim {
    me: string;
    foe: string;
    /** 画面里地基显示多宽（像素）：按它缩放整张图 */
    foot: number;
    /** 两方各自的画布尺寸和地基位置（脚本打印的 canvasW/canvasH/footW/footBottom/footCx） */
    meBox: AnimBox;
    foeBox: AnimBox;
    idle: [number, number][];
    attack?: [number, number][];
    death: [number, number];
}
export interface AnimBox { canvasW: number; canvasH: number; footW: number; footBottom: number; footCx: number }
/** 血量低于这个比例换残破图并冒烟，低于 DAMAGE_FIRE 再着火 */
export const DAMAGE_SMOKE = 0.6;
export const DAMAGE_FIRE = 0.3;

export const BUILDINGS = {
    tower: {
        name: '箭塔', glyph: '塔', hp: 2000, attack: { dmg: 32, cd: 1.0, range: 260 }, bounty: 40,
        img: {
            anim: { me: 'q/b1_tower_blue', foe: 'q/b1_tower_red', foot: 64, meBox: { canvasW: 160, canvasH: 160, footW: 102, footBottom: 12, footCx: 82 }, foeBox: { canvasW: 160, canvasH: 160, footW: 112, footBottom: 4, footCx: 78 }, idle: [[0, 8], [8, 16], [16, 24]], attack: [[24, 32], [32, 40], [40, 48]], death: [48, 60] } },
    } as BuildingDef,
    barracks: {
        name: '兵营', glyph: '营', hp: 2200, bounty: 60,
        img: {
            anim: { me: 'q/b1_barracks_blue', foe: 'q/b1_barracks_red', foot: 112, meBox: { canvasW: 167, canvasH: 160, footW: 132, footBottom: 20, footCx: 85 }, foeBox: { canvasW: 166, canvasH: 160, footW: 132, footBottom: 15, footCx: 82 }, idle: [[0, 8], [8, 16], [16, 24]], death: [24, 36] } },
    } as BuildingDef,
    /** 大本营门前的两座门牙塔：比路上的塔更硬、打得更疼 */
    gate: {
        name: '门牙塔', glyph: '塔', hp: 3000, attack: { dmg: 48, cd: 1.0, range: 270 }, bounty: 60,
        img: {
            anim: { me: 'q/b1_tower_blue', foe: 'q/b1_tower_red', foot: 74, meBox: { canvasW: 160, canvasH: 160, footW: 102, footBottom: 12, footCx: 82 }, foeBox: { canvasW: 160, canvasH: 160, footW: 112, footBottom: 4, footCx: 78 }, idle: [[0, 8], [8, 16], [16, 24]], attack: [[24, 32], [32, 40], [40, 48]], death: [48, 60] } },
    } as BuildingDef,
    base: {
        name: '大本营', glyph: '城', hp: 7000, attack: { dmg: 60, cd: 1.0, range: 300 }, bounty: 0,
        img: {
            anim: { me: 'q/b1_base_blue', foe: 'q/b1_base_red', foot: 200, meBox: { canvasW: 167, canvasH: 160, footW: 135, footBottom: 10, footCx: 85 }, foeBox: { canvasW: 160, canvasH: 160, footW: 129, footBottom: 17, footCx: 78 }, idle: [[0, 8], [8, 16], [16, 24]], death: [24, 36] } },
    } as BuildingDef,
};

// ======================= 兵营出兵 =======================

/** 每条路的兵营同时出兵，间隔（秒） */
export const SPAWN_EVERY = 14;
/** 一队几个兵 = 基础数 + 兵营等级 */
export const SQUAD_BASE = 2;
/** 兵营升级价（升到 2、3、4 级） */
export const BARRACKS_UPGRADE = [90, 160, 260];
/** 加派一队：按当前兵种单价 × 人数；每条路的兵营加派完要等一会儿才能再派 */
export const REINFORCE_SIZE = 2;
export const REINFORCE_CD = 20;

// ======================= 主城卫队 =======================
// 被打到家门口的最后手段：兵营不能重建；两座门牙塔都倒了之后，主城才能买一队很能打的卫兵守家

export const GUARD = {
    count: 3,
    cost: 320,
    /** 买完要等多久才能再买（秒） */
    cd: 75,
    /** 卫兵离大本营最远走多远，敌人进了这个圈才迎上去：只守大本营和门牙塔，管不到兵营 */
    leash: 300,
};

// ======================= 科技 =======================

export type TechKey = 'weapon' | 'armor' | 'unlock_qi' | 'unlock_che';

export interface TechDef { key: TechKey; name: string; costs: number[]; desc: string; }

export const TECHS: TechDef[] = [
    { key: 'weapon', name: '兵器', costs: [110, 190, 300], desc: '全军攻击 +15%' },
    { key: 'armor', name: '甲胄', costs: [110, 190, 300], desc: '全军血量 +15%' },
    { key: 'unlock_qi', name: '骑兵', costs: [150], desc: '解锁骑兵' },
    { key: 'unlock_che', name: '投石车', costs: [220], desc: '解锁投石车' },
];
export const TECH_STEP = 0.15;

// ======================= 经济 =======================

export const START_GOLD = 150;
/** 每秒自动进账，开局 4，每过一分钟多 0.5：越到后期钱越多、攻势越猛，对局不至于拖满 10 分钟 */
export const INCOME = 4;
export const INCOME_GROWTH = 0.5;
/** 一局最长 10 分钟，到时按大本营血量、剩余建筑、歼敌数判胜负 */
export const MATCH_TIME = 600;

// ======================= 电脑 =======================

export const AI = {
    /** 多久想一次 */
    think: 3,
    /** 换成克制兵种的概率 */
    counterChance: 0.7,
    /** 电脑解锁骑兵、投石车的最早时间（秒）：前期别太凶 */
    unlockQiAt: 70,
    unlockCheAt: 200,
    /** 收入倍率，用来调难度 */
    incomeMul: 1,
};

// ======================= 阵营外观 =======================

export const SIDE_COLOR = {
    1: { fill: new Color(52, 104, 178), rim: new Color(170, 210, 255), name: '我方' },
    [-1]: { fill: new Color(176, 52, 40), rim: new Color(255, 190, 160), name: '敌方' },
} as Record<number, { fill: Color; rim: Color; name: string }>;
