import { Color, Graphics, Label, Node } from 'cc';
import { createGraphics, createLabel } from '../core/Nodes';
import {
    BARRACKS_UPGRADE, BUILDINGS, GUARD, INCOME, INCOME_GROWTH, AI, MATCH_TIME, REINFORCE_CD, REINFORCE_SIZE, SPAWN_EVERY, SQUAD_BASE, START_GOLD,
    TECH_STEP, TECHS, TechKey, UNITS, UnitKind,
} from './Defs';
import { Building, Side, Unit } from './Entities';
import { BARRACKS_S, BASE_X, GATE_TOWERS, LANE_LEN, LANE_NAMES, LANE_TOWER, LANES, lanePoint, projectS } from './MapDef';
import { Particles } from './Particles';

export class SideState {
    gold = START_GOLD;
    tech: Record<TechKey, number> = { weapon: 0, armor: 0, unlock_qi: 0, unlock_che: 0 };
    laneKind: UnitKind[] = ['qiang', 'gong', 'qiang'];
    barracksLv = [0, 0, 0];
    kills = 0;
    /** 下次能买卫队 / 各路能加派的时刻 */
    guardReadyAt = 0;
    reinforceReadyAt = [0, 0, 0];
}

interface Proj {
    from: Side;
    target: Unit | Building;
    x: number; y: number;
    sx: number; sy: number; tx: number; ty: number;
    /** 石头走抛物线：总时长、已飞时间；箭为 0 表示直线追踪 */
    dur: number; t: number;
    dmg: number;
    stone: boolean;
}

interface Float { label: Label; t: number; }

const C = {
    spark: new Color(255, 230, 160, 255),
    blood: new Color(200, 60, 40, 220),
    dust: new Color(150, 120, 90, 160),
    fire: new Color(255, 150, 50, 230),
    smoke: new Color(90, 80, 70, 150),
    gold: new Color(255, 214, 110, 255),
    arrow: new Color(90, 62, 34, 255),
    stone: new Color(70, 64, 58, 255),
};

export class Battle {
    readonly sides: Record<number, SideState> = { 1: new SideState(), [-1]: new SideState() };
    units: Unit[] = [];
    readonly buildings: Building[] = [];
    time = 0;
    spawnT = 4;
    /** 胜方：1 我方，-1 敌方，0 平局；null 表示还在打 */
    winner: Side | 0 | null = null;
    private projs: Proj[] = [];
    private floats: Float[] = [];
    private readonly projG: Graphics;
    /** 广播给界面的战报，比如某座塔被拆 */
    onNotice: (text: string, side: Side) => void = () => { };

    constructor(private readonly actors: Node, overlay: Node, private readonly fx: Particles, private readonly texts: Node) {
        this.projG = createGraphics('Projectiles', overlay);
        for (const side of [1, -1] as Side[]) {
            const bx = side === 1 ? -BASE_X : BASE_X;
            // 大本营和门牙塔不属于哪一路：记下它们在每条路上对应的位置，三路的兵打到家门口都会碰上
            const shared = (kind: 'base' | 'gate', x: number, y: number) => {
                const b = new Building(actors, kind, BUILDINGS[kind], side, -1, 0, x, y);
                b.sOn = LANES.map((_, lane) => projectS(lane, x, y));
                this.buildings.push(b);
            };
            shared('base', bx, 0);
            for (const [dx, dy] of GATE_TOWERS) shared('gate', bx + side * dx, dy);
            LANES.forEach((_, lane) => {
                const bs = side === 1 ? BARRACKS_S : LANE_LEN[lane] - BARRACKS_S;
                const put = (kind: 'tower' | 'barracks', s: number, lat: number) => {
                    const [x, y] = lanePoint(lane, s, lat);
                    this.buildings.push(new Building(actors, kind, BUILDINGS[kind], side, lane, s, x, y));
                };
                put('barracks', bs, 0);
                put('tower', bs + side * LANE_TOWER[lane].ahead, LANE_TOWER[lane].lat);
            });
        }
    }

    // ---------- 查询 ----------

    get income() { return INCOME + Math.floor(this.time / 60) * INCOME_GROWTH; }

    base(side: Side) { return this.buildings.find(b => b.kind === 'base' && b.side === side)!; }
    barracks(side: Side, lane: number) { return this.buildings.find(b => b.kind === 'barracks' && b.side === side && b.lane === lane)!; }
    unlocked(side: Side, kind: UnitKind) {
        const t = this.sides[side].tech;
        return kind === 'qi' ? t.unlock_qi > 0 : kind === 'che' ? t.unlock_che > 0 : true;
    }
    techCost(side: Side, key: TechKey): number | null {
        const def = TECHS.find(t => t.key === key)!, lv = this.sides[side].tech[key];
        return lv < def.costs.length ? def.costs[lv] : null;
    }
    barracksCost(side: Side, lane: number): number | null {
        const lv = this.sides[side].barracksLv[lane];
        return lv < BARRACKS_UPGRADE.length ? BARRACKS_UPGRADE[lv] : null;
    }
    reinforceCost(side: Side, lane: number) { return UNITS[this.sides[side].laneKind[lane]].cost * REINFORCE_SIZE; }
    squadSize(side: Side, lane: number) { return SQUAD_BASE + this.sides[side].barracksLv[lane]; }
    reinforceCd(side: Side, lane: number) { return Math.max(0, this.sides[side].reinforceReadyAt[lane] - this.time); }
    guardCd(side: Side) { return Math.max(0, this.sides[side].guardReadyAt - this.time); }

    // ---------- 指令（玩家和电脑共用） ----------

    setLaneKind(side: Side, lane: number, kind: UnitKind) {
        if (this.unlocked(side, kind)) this.sides[side].laneKind[lane] = kind;
    }

    buyTech(side: Side, key: TechKey): boolean {
        const cost = this.techCost(side, key), st = this.sides[side];
        if (cost === null || st.gold < cost) return false;
        st.gold -= cost;
        st.tech[key]++;
        return true;
    }

    upgradeBarracks(side: Side, lane: number): boolean {
        const cost = this.barracksCost(side, lane), st = this.sides[side];
        if (cost === null || st.gold < cost || !this.barracks(side, lane).alive) return false;
        st.gold -= cost;
        st.barracksLv[lane]++;
        return true;
    }

    reinforce(side: Side, lane: number): boolean {
        const cost = this.reinforceCost(side, lane), st = this.sides[side], b = this.barracks(side, lane);
        if (st.gold < cost || !b.alive || this.reinforceCd(side, lane) > 0) return false;
        st.gold -= cost;
        st.reinforceReadyAt[lane] = this.time + REINFORCE_CD;
        this.spawnSquad(side, lane, REINFORCE_SIZE);
        return true;
    }

    /** 主城买一队卫兵，排在大本营门前 */
    buyGuard(side: Side): boolean {
        const st = this.sides[side], base = this.base(side);
        if (st.gold < GUARD.cost || this.guardCd(side) > 0 || !base.alive) return false;
        st.gold -= GUARD.cost;
        st.guardReadyAt = this.time + GUARD.cd;
        const def = UNITS.wei, dmgMul = 1 + st.tech.weapon * TECH_STEP, hpMul = 1 + st.tech.armor * TECH_STEP;
        for (let i = 0; i < GUARD.count; i++) {
            const u = new Unit(this.actors, def, side, -1, 0, 0, dmgMul, hpMul);
            u.post = [base.x + side * 150, (i - (GUARD.count - 1) / 2) * 80];
            [u.x, u.y] = [base.x + side * 60, u.post[1]];
            this.units.push(u);
        }
        this.fx.emit(base.x + side * 100, 20, 30, { color: C.gold, speed: 220, size: 5, life: 0.7, drag: 3 });
        return true;
    }

    // ---------- 主循环 ----------

    update(dt: number) {
        if (this.winner !== null) { this.fx.update(dt); this.updateFloats(dt); return; }
        this.time += dt;
        this.sides[1].gold += this.income * dt;
        this.sides[-1].gold += this.income * AI.incomeMul * dt;

        this.spawnT -= dt;
        if (this.spawnT <= 0) {
            this.spawnT = SPAWN_EVERY;
            for (const side of [1, -1] as Side[]) for (let lane = 0; lane < LANES.length; lane++) {
                if (this.barracks(side, lane).alive) this.spawnSquad(side, lane, this.squadSize(side, lane));
            }
        }

        for (const u of this.units) this.updateUnit(u, dt);
        for (const b of this.buildings) this.updateBuilding(b, dt);
        this.updateProjs(dt);
        this.reap();

        const myBase = this.base(1), foeBase = this.base(-1);
        if (!foeBase.alive) this.winner = 1;
        else if (!myBase.alive) this.winner = -1;
        else if (this.time >= MATCH_TIME) {
            const a = this.score(1), b = this.score(-1);
            this.winner = a === b ? 0 : a > b ? 1 : -1;
        }
        this.fx.update(dt);
        this.updateFloats(dt);
    }

    /** 到时间没分出胜负：先比大本营血量，再比剩下几座建筑，最后比歼敌数 */
    score(side: Side) {
        const base = this.base(side);
        const standing = this.buildings.filter(b => b.side === side && b.alive).length;
        return Math.round(base.hp / base.maxHp * 100) * 10000 + standing * 1000 + this.sides[side].kills;
    }

    private spawnSquad(side: Side, lane: number, n: number) {
        const st = this.sides[side], def = UNITS[st.laneKind[lane]], b = this.barracks(side, lane);
        const dmgMul = 1 + st.tech.weapon * TECH_STEP, hpMul = 1 + st.tech.armor * TECH_STEP;
        for (let i = 0; i < n; i++) {
            // 从兵营门口排成一列走出去
            const s = b.s + side * (b.radius + 8) - side * i * 34;
            const u = new Unit(this.actors, def, side, lane, s, (Math.random() - 0.5) * 56, dmgMul, hpMul);
            [u.x, u.y] = lanePoint(lane, s, u.lat);
            this.units.push(u);
        }
    }

    private updateUnit(u: Unit, dt: number) {
        if (!u.alive) return;
        if (u.post) { this.updateGuard(u, dt); return; }
        const side = u.side, foe = -side as Side;
        // 找正前方、攻击距离内最近的敌人或敌方建筑
        let best: Unit | Building | null = null, bestFd = Infinity;
        for (const e of this.units) {
            if (e.side !== foe || !e.alive) continue;
            if (e.post) {
                // 卫兵不在路上，按实际距离算
                const d = Math.hypot(e.x - u.x, e.y - u.y) - e.radius - u.radius;
                if (d <= u.def.range && d < bestFd) { best = e; bestFd = d; }
                continue;
            }
            if (e.lane !== u.lane) continue;
            const fd = (e.s - u.s) * side;
            if (fd >= -10 && fd - e.radius <= u.def.range && fd < bestFd) { best = e; bestFd = fd; }
        }
        for (const b of this.buildings) {
            if (b.side !== foe || !b.alive || (b.lane !== u.lane && b.lane !== -1)) continue;
            const bs = b.lane === -1 ? b.sOn[u.lane] : b.s;
            const fd = (bs - u.s) * side;
            if (fd >= -b.radius && fd - b.radius <= u.def.range && fd < bestFd) { best = b; bestFd = fd; }
        }
        u.target = best;
        if (u.cdT > 0) u.cdT -= dt;
        let walking = false;
        if (best) {
            if (u.cdT <= 0) { u.cdT = u.def.cd; this.attack(u, best); }
        } else if (!this.blocked(u)) {
            u.s += side * u.def.speed * dt;
            walking = true;
        }
        [u.x, u.y] = lanePoint(u.lane, u.s, u.lat);
        u.sync(dt, walking);
    }

    /** 卫兵：敌人进了大本营附近就迎上去打，没有敌人就回岗位；永远不离开大本营太远 */
    private updateGuard(u: Unit, dt: number) {
        const base = this.base(u.side), post = u.post!;
        let best: Unit | null = null, bd = Infinity;
        for (const e of this.units) {
            if (e.side === u.side || !e.alive || Math.hypot(e.x - base.x, e.y - base.y) > GUARD.leash + 80) continue;
            const d = Math.hypot(e.x - u.x, e.y - u.y);
            if (d < bd) { bd = d; best = e; }
        }
        u.target = best;
        if (u.cdT > 0) u.cdT -= dt;
        let tx = post[0], ty = post[1], walking = false;
        if (best) {
            if (bd - best.radius - u.radius <= u.def.range) {
                if (u.cdT <= 0) { u.cdT = u.def.cd; this.attack(u, best); }
                tx = u.x; ty = u.y;
            } else { tx = best.x; ty = best.y; }
        }
        const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
        if (d > 3) {
            const step = Math.min(d, u.def.speed * dt);
            let nx = u.x + dx / d * step, ny = u.y + dy / d * step;
            const fromBase = Math.hypot(nx - base.x, ny - base.y);
            if (fromBase > GUARD.leash) { nx = base.x + (nx - base.x) / fromBase * GUARD.leash; ny = base.y + (ny - base.y) / fromBase * GUARD.leash; }
            u.x = nx;
            u.y = ny;
            walking = true;
        }
        u.sync(dt, walking);
    }

    /** 近战兵前面有自己的近战兵正在肉搏，就排队等着；远程兵、投石车站在后面放箭砸石，不挡路 */
    private blocked(u: Unit) {
        if (u.def.range > 60) return false;
        for (const a of this.units) {
            if (a === u || a.side !== u.side || a.lane !== u.lane || !a.alive || !a.target || a.def.range > 60) continue;
            const fd = (a.s - u.s) * u.side;
            if (fd > 0 && fd < u.radius + a.radius + 4) return true;
        }
        return false;
    }

    private dmgOf(u: Unit, t: Unit | Building) {
        const mul = t instanceof Unit ? u.def.vs[t.def.kind] ?? 1 : u.def.vs.building ?? 1;
        return u.def.dmg * u.dmgMul * mul;
    }

    private attack(u: Unit, t: Unit | Building) {
        const dmg = this.dmgOf(u, t);
        if (!u.def.shot) {
            u.strike(t.x);
            this.hit(t, dmg, u.side);
            this.fx.emit((u.x + t.x) / 2, (u.y + t.y) / 2 + 6, 4, { color: C.spark, speed: 120, size: 2.5, life: 0.25 });
            return;
        }
        this.shoot(u.side, u.x, u.y + 10, t, dmg, u.def.shot === 'stone');
    }

    private shoot(from: Side, x: number, y: number, t: Unit | Building, dmg: number, stone: boolean) {
        const p: Proj = { from, target: t, x, y, sx: x, sy: y, tx: t.x, ty: t.y + 10, dur: 0, t: 0, dmg, stone };
        if (stone) p.dur = Math.max(0.6, Math.hypot(t.x - x, t.y - y) / 300);
        this.projs.push(p);
    }

    private updateBuilding(b: Building, dt: number) {
        b.sync(dt);
        if (!b.attacks) return;
        if (b.cdT > 0) { b.cdT -= dt; return; }
        const atk = b.def.attack!;
        let best: Unit | null = null, bd = atk.range;
        for (const u of this.units) {
            if (u.side === b.side || !u.alive) continue;
            const d = Math.hypot(u.x - b.x, u.y - b.y);
            if (d < bd) { bd = d; best = u; }
        }
        if (!best) return;
        b.cdT = atk.cd;
        this.shoot(b.side, b.x, b.y + b.radius, best, atk.dmg, false);
    }

    private updateProjs(dt: number) {
        const g = this.projG;
        g.clear();
        for (let i = this.projs.length - 1; i >= 0; i--) {
            const p = this.projs[i];
            let done = false;
            if (p.stone) {
                p.t += dt;
                const k = Math.min(1, p.t / p.dur);
                p.x = p.sx + (p.tx - p.sx) * k;
                p.y = p.sy + (p.ty - p.sy) * k;
                const h = 140 * 4 * k * (1 - k);
                g.fillColor = new Color(20, 14, 10, 50);
                g.ellipse(p.x, p.y - 10, 6, 2.5);
                g.fill();
                g.fillColor = C.stone;
                g.circle(p.x, p.y + h, 7);
                g.fill();
                done = k >= 1;
            } else {
                if (p.target.alive) { p.tx = p.target.x; p.ty = p.target.y + 8; }
                const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), step = 700 * dt;
                const ux = dx / (d || 1), uy = dy / (d || 1);
                if (d <= step + 4) { p.x = p.tx; p.y = p.ty; done = true; }
                else { p.x += ux * step; p.y += uy * step; }
                g.strokeColor = C.arrow;
                g.lineWidth = 2.5;
                g.moveTo(p.x - ux * 16, p.y - uy * 16);
                g.lineTo(p.x, p.y);
                g.stroke();
            }
            if (done) {
                if (p.target.alive) this.hit(p.target, p.dmg, p.from);
                if (p.stone) {
                    this.fx.emit(p.x, p.y, 16, { color: C.dust, speed: 160, size: 6, life: 0.5, drag: 4 });
                    this.fx.emit(p.x, p.y, 8, { color: C.smoke, speed: 50, size: 9, life: 0.8, lift: 40 });
                }
                this.projs.splice(i, 1);
            }
        }
    }

    private hit(t: Unit | Building, dmg: number, from: Side) {
        if (!t.alive) return;
        const wasAlive = t.alive;
        t.hurt(dmg);
        if (wasAlive && !t.alive && t instanceof Building) this.razed(t, from);
    }

    private razed(b: Building, by: Side) {
        this.sides[by].gold += b.def.bounty;
        this.fx.emit(b.x, b.y + 20, 40, { color: C.fire, speed: 260, size: 7, life: 0.6, drag: 3 });
        this.fx.emit(b.x, b.y + 20, 24, { color: C.smoke, speed: 90, size: 14, life: 1.4, lift: 50, jitter: 20 });
        const where = b.lane === -1 ? '' : LANE_NAMES[b.lane];
        this.onNotice(`${b.side === 1 ? '我方' : '敌方'}${where}${b.def.name}被摧毁`, b.side);
        if (b.def.bounty && by === 1) this.floatText(b.x, b.y + 80, `+${b.def.bounty}`, C.gold, 30);
    }

    /** 清掉阵亡的兵，发赏金 */
    private reap() {
        for (let i = this.units.length - 1; i >= 0; i--) {
            const u = this.units[i];
            if (u.alive) continue;
            const by = -u.side as Side;
            this.sides[by].gold += u.def.bounty;
            this.sides[by].kills++;
            this.fx.emit(u.x, u.y + 6, 8, { color: C.blood, speed: 140, size: 3, life: 0.4, lift: -200 });
            this.fx.emit(u.x, u.y, 4, { color: C.dust, speed: 50, size: 6, life: 0.6, lift: 30 });
            if (by === 1) this.floatText(u.x, u.y + 26, `+${u.def.bounty}`, C.gold, 18);
            u.node.destroy();
            this.units.splice(i, 1);
        }
    }

    private floatText(x: number, y: number, text: string, color: Color, size: number) {
        const l = createLabel('Float', this.texts, text, size, color);
        l.enableOutline = true;
        l.outlineColor = new Color(30, 20, 10, 255);
        l.outlineWidth = 2;
        l.node.setPosition(x, y);
        this.floats.push({ label: l, t: 0.8 });
    }

    private updateFloats(dt: number) {
        for (let i = this.floats.length - 1; i >= 0; i--) {
            const f = this.floats[i];
            f.t -= dt;
            const p = f.label.node.position;
            f.label.node.setPosition(p.x, p.y + 40 * dt);
            if (f.t <= 0) { f.label.node.destroy(); this.floats.splice(i, 1); }
        }
    }

    dispose() {
        for (const u of this.units) u.node.destroy();
        for (const b of this.buildings) b.node.destroy();
        for (const f of this.floats) f.label.node.destroy();
        this.projG.node.destroy();
    }
}
