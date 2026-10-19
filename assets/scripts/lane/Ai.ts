import { AI, COUNTER, UnitKind } from './Defs';
import { Battle } from './Battle';
import { Side } from './Entities';
import { LANE_LEN, LANES } from './MapDef';

/** 电脑对手：和玩家用同一套指令，每隔几秒想一次 */
export class Ai {
    private t = 1;

    constructor(private readonly b: Battle, private readonly side: Side = -1) { }

    update(dt: number) {
        this.t -= dt;
        if (this.t > 0 || this.b.winner !== null) return;
        this.t = AI.think;
        this.pickKinds();
        this.spend();
    }

    /** 看对面每条路出什么兵，大概率换成克制它的兵；解锁了投石车，偶尔派一路去拆塔 */
    private pickKinds() {
        const b = this.b, me = this.side, foe = -me as Side;
        for (let lane = 0; lane < LANES.length; lane++) {
            const theirs = b.sides[foe].laneKind[lane];
            let want: UnitKind = b.sides[me].laneKind[lane];
            if (Math.random() < AI.counterChance) want = COUNTER[theirs];
            if (b.unlocked(me, 'che') && Math.random() < 0.15) want = 'che';
            if (!b.unlocked(me, want)) want = theirs === 'gong' ? 'qiang' : 'gong';
            b.setLaneKind(me, lane, want);
        }
    }

    private spend() {
        const b = this.b, me = this.side, st = b.sides[me];
        if (b.time >= AI.unlockQiAt && b.buyTech(me, 'unlock_qi')) return;
        if (b.time >= AI.unlockCheAt && b.buyTech(me, 'unlock_che')) return;
        // 被压得最狠的那条路先加派
        const pressure = this.mostPressedLane();
        if (pressure.depth > 0.45 && st.gold > b.reinforceCost(me, pressure.lane) + 30 && b.reinforce(me, pressure.lane)) return;
        const r = Math.random();
        if (r < 0.4) {
            const key = Math.random() < 0.5 ? 'weapon' : 'armor';
            b.buyTech(me, key) || b.buyTech(me, key === 'weapon' ? 'armor' : 'weapon');
        } else if (r < 0.8) {
            let lane = 0;
            for (let i = 1; i < LANES.length; i++) if (st.barracksLv[i] < st.barracksLv[lane]) lane = i;
            b.upgradeBarracks(me, lane);
        } else if (st.gold > 200) {
            b.reinforce(me, Math.floor(Math.random() * LANES.length));
        }
    }

    /** 对面的兵在哪条路推得最深：0 表示还在对面家门口，1 表示打到我家门口 */
    private mostPressedLane() {
        const b = this.b, me = this.side;
        let lane = 0, depth = 0;
        for (const u of b.units) {
            if (u.side === me) continue;
            const d = me === -1 ? u.s / LANE_LEN[u.lane] : 1 - u.s / LANE_LEN[u.lane];
            if (d > depth) { depth = d; lane = u.lane; }
        }
        return { lane, depth };
    }
}
