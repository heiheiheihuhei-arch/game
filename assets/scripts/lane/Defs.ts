import { Color } from 'cc';

// ======================= 兵种 =======================
// 三角克制：枪克骑、骑克弓、弓克枪；投石车专拆建筑，打人很弱

export type UnitKind = 'qiang' | 'gong' | 'qi' | 'che';

export interface UnitDef {
    kind: UnitKind;
    /** 圆牌上的字 */
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
}

export const UNITS: Record<UnitKind, UnitDef> = {
    qiang: {
        kind: 'qiang', glyph: '枪', name: '枪兵', hp: 130, dmg: 11, cd: 1.0, range: 36, speed: 62,
        vs: { qi: 1.8, building: 1 }, bounty: 5, cost: 12, radius: 21,
    },
    gong: {
        kind: 'gong', glyph: '弓', name: '弓兵', hp: 75, dmg: 10, cd: 1.15, range: 190, speed: 58,
        vs: { qiang: 1.7, building: 0.8 }, shot: 'arrow', bounty: 5, cost: 14, radius: 20,
    },
    qi: {
        kind: 'qi', glyph: '骑', name: '骑兵', hp: 170, dmg: 15, cd: 1.1, range: 38, speed: 105,
        vs: { gong: 1.9, building: 0.9 }, bounty: 8, cost: 22, locked: true, radius: 24,
    },
    che: {
        kind: 'che', glyph: '车', name: '投石车', hp: 160, dmg: 46, cd: 3.2, range: 280, speed: 40,
        vs: { building: 3, qiang: 0.4, gong: 0.4, qi: 0.4, che: 0.4 }, shot: 'stone', bounty: 12, cost: 40, locked: true, radius: 26,
    },
};
export const UNIT_ORDER: UnitKind[] = ['qiang', 'gong', 'qi', 'che'];
/** 每个兵种被什么克：电脑看你出什么，就换成克制它的兵 */
export const COUNTER: Record<UnitKind, UnitKind> = { qiang: 'gong', gong: 'qi', qi: 'qiang', che: 'qi' };

// ======================= 建筑 =======================

export interface BuildingDef {
    name: string;
    glyph: string;
    hp: number;
    /** 会射箭的建筑：伤害、间隔、射程；兵营不攻击 */
    attack?: { dmg: number; cd: number; range: number };
    bounty: number;
}

export const BUILDINGS = {
    tower: { name: '箭塔', glyph: '塔', hp: 2000, attack: { dmg: 32, cd: 1.0, range: 260 }, bounty: 40 } as BuildingDef,
    barracks: { name: '兵营', glyph: '营', hp: 2200, bounty: 60 } as BuildingDef,
    /** 大本营门前的两座门牙塔：比路上的塔更硬、打得更疼 */
    gate: { name: '门牙塔', glyph: '塔', hp: 3000, attack: { dmg: 48, cd: 1.0, range: 270 }, bounty: 60 } as BuildingDef,
    base: { name: '大本营', glyph: '城', hp: 7000, attack: { dmg: 60, cd: 1.0, range: 300 }, bounty: 0 } as BuildingDef,
};

// ======================= 兵营出兵 =======================

/** 每条路的兵营同时出兵，间隔（秒） */
export const SPAWN_EVERY = 14;
/** 一队几个兵 = 基础数 + 兵营等级 */
export const SQUAD_BASE = 3;
/** 兵营升级价（升到 2、3、4 级） */
export const BARRACKS_UPGRADE = [90, 160, 260];
/** 加派一队：按当前兵种单价 × 人数 */
export const REINFORCE_SIZE = 3;

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
/** 每秒自动进账 */
export const INCOME = 4;
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
