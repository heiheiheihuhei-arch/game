import { EventTouch, Node, UITransform, Vec3, view } from 'cc';
import { createNode } from '../core/Nodes';
import { Ai } from './Ai';
import { Battle } from './Battle';
import { CameraCtl, Minimap } from './Camera';
import { GUARD, MATCH_TIME, REINFORCE_SIZE, TECHS, UNIT_ORDER, UNITS } from './Defs';
import { BASE_X, drawMap, LANE_NAMES } from './MapDef';
import { Particles } from './Particles';
import { Hud, PanelModel } from './Ui';

const SPEEDS = [1, 2, 3];
/** 手指移动超过这个距离算拖地图，不算点击 */
const DRAG_SLOP = 10;

export class Game {
    readonly root: Node;
    private readonly actors: Node;
    private readonly battle: Battle;
    private readonly ai: Ai;
    private readonly cam: CameraCtl;
    private readonly minimap: Minimap;
    private readonly hud: Hud;
    private readonly fx: Particles;
    private speedIdx = 0;
    private moved = 0;
    private resultShown = false;
    private readonly restart: () => void;

    constructor(parent: Node, onRestart: () => void) {
        this.root = createNode('Game', parent);
        const world = createNode('World', this.root);
        drawMap(createNode('Map', world));
        this.actors = createNode('Actors', world);
        const overlay = createNode('Overlay', world);
        this.fx = new Particles(world);
        const texts = createNode('Texts', world);
        this.battle = new Battle(this.actors, overlay, this.fx, texts);
        this.ai = new Ai(this.battle);
        this.cam = new CameraCtl(world);
        this.cam.focus(-BASE_X + 500);

        const ui = createNode('UI', this.root);
        const vs = view.getVisibleSize();
        // 全屏点击层在界面最底下：拖动看地图，轻点选中兵营
        const input = createNode('Input', ui);
        input.getComponent(UITransform)!.setContentSize(vs.width, vs.height);
        input.on(Node.EventType.TOUCH_START, () => { this.moved = 0; });
        input.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
            const d = e.getUIDelta();
            this.moved += Math.abs(d.x) + Math.abs(d.y);
            if (this.moved > DRAG_SLOP) this.cam.pan(d.x);
        });
        input.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            if (this.moved > DRAG_SLOP) return;
            const loc = e.getUILocation();
            const p = input.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(loc.x, loc.y, 0));
            this.onTap(...this.cam.toWorld(p.x, p.y));
        });

        this.minimap = new Minimap(ui, this.cam, this.battle);
        this.hud = new Hud(ui, {
            onLane: lane => this.openBarracks(lane, true),
            onTech: () => this.openTech(true),
            onSpeed: () => {
                this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
                this.hud.speedBtn.text = `${SPEEDS[this.speedIdx]} 倍速`;
            },
        });
        this.battle.onNotice = text => this.hud.toast(text);
        this.hud.toast('拖动看地图；点「营」选兵种、加派，点「城」升级科技', 4);
        this.restart = onRestart;
    }

    private onTap(x: number, y: number) {
        const base = this.battle.base(1);
        if (Math.hypot(base.x - x, base.y - (y - 30)) < base.radius + 30) { this.openTech(false); return; }
        for (let lane = 0; lane < 3; lane++) {
            const b = this.battle.barracks(1, lane);
            if (Math.hypot(b.x - x, b.y - (y - 20)) < b.radius + 24) { this.openBarracks(lane, false); return; }
        }
        if (this.hud.panelOpen) this.hud.closePanel();
    }

    private openBarracks(lane: number, moveCam: boolean) {
        const bt = this.battle, b = bt.barracks(1, lane), st = bt.sides[1];
        if (moveCam) this.cam.focus(b.x + 250);
        const model: PanelModel = {
            title: () => !b.alive ? `${LANE_NAMES[lane]}兵营已被摧毁，这条路不再出兵`
                : `${LANE_NAMES[lane]}兵营 ${st.barracksLv[lane] + 1} 级　每队 ${bt.squadSize(1, lane)} 人　${Math.ceil(bt.spawnT)} 秒后出兵`,
            actions: [
                ...UNIT_ORDER.map(k => ({
                    label: () => `${UNITS[k].glyph} ${UNITS[k].name}\n${bt.unlocked(1, k) ? `血${UNITS[k].hp} 攻${UNITS[k].dmg}` : '科技解锁'}`,
                    enabled: () => b.alive && bt.unlocked(1, k),
                    selected: () => st.laneKind[lane] === k,
                    act: () => bt.setLaneKind(1, lane, k),
                    w: 112,
                })),
                {
                    label: () => { const c = bt.barracksCost(1, lane); return c === null ? '兵营\n已满级' : `升级兵营\n${c} 金`; },
                    enabled: () => { const c = bt.barracksCost(1, lane); return b.alive && c !== null && st.gold >= c; },
                    act: () => bt.upgradeBarracks(1, lane),
                    w: 120,
                },
                {
                    label: () => {
                        const cd = bt.reinforceCd(1, lane);
                        return `加派 ${REINFORCE_SIZE} 人\n${cd > 0 ? `冷却 ${Math.ceil(cd)} 秒` : `${bt.reinforceCost(1, lane)} 金`}`;
                    },
                    enabled: () => b.alive && st.gold >= bt.reinforceCost(1, lane) && bt.reinforceCd(1, lane) <= 0,
                    act: () => bt.reinforce(1, lane),
                    w: 120,
                },
            ],
        };
        this.hud.openPanel(model);
    }

    /** 科技在主城里：全军通用，三路都生效（对之后出的兵） */
    private openTech(moveCam: boolean) {
        const bt = this.battle, st = bt.sides[1];
        if (moveCam) this.cam.focus(bt.base(1).x + 500);
        this.hud.openPanel({
            title: () => '主城科技　三路通用，对之后出的兵生效',
            actions: [{
                label: () => {
                    const cd = bt.guardCd(1);
                    const note = bt.gatesLeft(1) > 0 ? '门牙塔全倒后可买' : cd > 0 ? `冷却 ${Math.ceil(cd)} 秒` : `${GUARD.cost} 金`;
                    return `购买卫队 ${GUARD.count} 人\n${note}`;
                },
                enabled: () => bt.base(1).alive && bt.gatesLeft(1) === 0 && st.gold >= GUARD.cost && bt.guardCd(1) <= 0,
                act: () => bt.buyGuard(1),
                w: 150,
            }, ...TECHS.map(t => ({
                label: () => {
                    const c = bt.techCost(1, t.key), lv = st.tech[t.key];
                    const head = t.costs.length > 1 ? `${t.name} ${lv}/${t.costs.length}` : t.name;
                    return c === null ? `${head}\n${t.costs.length > 1 ? '已满级' : '已解锁'}` : `${head}\n${c} 金`;
                },
                enabled: () => { const c = bt.techCost(1, t.key); return c !== null && st.gold >= c; },
                act: () => bt.buyTech(1, t.key),
                w: 130,
            }))],
        });
    }

    update(realDt: number) {
        const dt = realDt * SPEEDS[this.speedIdx];
        this.battle.update(dt);
        this.ai.update(dt);
        this.sortActors();
        this.minimap.update(realDt);
        const me = this.battle.base(1), foe = this.battle.base(-1);
        this.hud.setTop(this.battle.sides[1].gold, this.battle.income, Math.max(0, MATCH_TIME - this.battle.time), me.hp / me.maxHp, foe.hp / foe.maxHp);
        this.hud.update(realDt);
        if (this.battle.winner !== null && !this.resultShown) {
            this.resultShown = true;
            const w = this.battle.winner, t = this.battle.time, mm = Math.floor(t / 60), ss = Math.floor(t % 60);
            const timeout = this.battle.base(1).alive && this.battle.base(-1).alive;
            const line = `${timeout ? '时间到，按战况判定　' : ''}用时 ${mm} 分 ${ss} 秒　歼敌 ${this.battle.sides[1].kills}`;
            if (w === 1) this.hud.showResult('攻破敌营！', line, true, this.restart);
            else if (w === -1) this.hud.showResult('大本营失守', line, false, this.restart);
            else this.hud.showResult('平局', line, false, this.restart);
        }
    }

    /** 越靠下的越靠前画 */
    private sortActors() {
        const kids = this.actors.children.slice().sort((a, b) => b.position.y - a.position.y);
        kids.forEach((n, i) => { if (n.getSiblingIndex() !== i) n.setSiblingIndex(i); });
    }
}

