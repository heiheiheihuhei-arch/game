import { Color, EventTouch, Graphics, Label, Node, UITransform, view } from 'cc';
import { createGraphics, createLabel, createNode } from '../core/Nodes';

const PANEL = new Color(40, 30, 22, 225);
const PANEL_RIM = new Color(200, 160, 90, 255);
const BTN = new Color(92, 64, 38, 240);
const BTN_OFF = new Color(70, 62, 56, 200);
const BTN_ON = new Color(150, 104, 40, 255);
const TEXT = new Color(250, 236, 200, 255);
const TEXT_OFF = new Color(150, 140, 128, 255);
const GOLD = new Color(255, 214, 110, 255);
const ME = new Color(110, 170, 255, 255);
const FOE = new Color(255, 100, 80, 255);
const HP_BG = new Color(20, 14, 10, 200);

export function roundRect(g: Graphics, w: number, h: number, fill: Color, rim?: Color, rimW = 2) {
    g.clear();
    g.fillColor = fill;
    g.roundRect(-w / 2, -h / 2, w, h, Math.min(12, h / 3));
    g.fill();
    if (rim) {
        g.strokeColor = rim;
        g.lineWidth = rimW;
        g.roundRect(-w / 2, -h / 2, w, h, Math.min(12, h / 3));
        g.stroke();
    }
}

/** 拦住点击，不让它落到下面的地图上 */
function swallow(n: Node) {
    for (const t of [Node.EventType.TOUCH_START, Node.EventType.TOUCH_MOVE, Node.EventType.TOUCH_END]) {
        n.on(t, (e: EventTouch) => { e.propagationStopped = true; });
    }
}

export class Button {
    readonly node: Node;
    private readonly bg: Graphics;
    private readonly label: Label;
    private enabled = true;
    private selected = false;

    constructor(parent: Node, text: string, readonly w: number, readonly h: number, private readonly onClick: () => void, size = 24) {
        this.node = createNode('Btn', parent);
        this.node.getComponent(UITransform)!.setContentSize(w, h);
        this.bg = this.node.addComponent(Graphics);
        this.label = createLabel('Text', this.node, text, size, TEXT);
        this.label.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.node.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; });
        this.node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => { e.propagationStopped = true; });
        this.node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            if (this.enabled) this.onClick();
        });
        this.draw();
    }

    set text(t: string) { if (this.label.string !== t) this.label.string = t; }

    setState(enabled: boolean, selected = false) {
        if (enabled === this.enabled && selected === this.selected) return;
        this.enabled = enabled;
        this.selected = selected;
        this.draw();
    }

    private draw() {
        roundRect(this.bg, this.w, this.h, this.selected ? BTN_ON : this.enabled ? BTN : BTN_OFF,
            this.selected ? GOLD : this.enabled ? PANEL_RIM : undefined, this.selected ? 3 : 2);
        this.label.color = this.enabled || this.selected ? TEXT : TEXT_OFF;
    }
}

/** 面板里的一个按钮：文字、能不能点、是不是选中，每次刷新时现取 */
export interface PanelAction {
    label: () => string;
    enabled: () => boolean;
    selected?: () => boolean;
    act: () => void;
    w?: number;
}

export interface PanelModel {
    title: () => string;
    actions: PanelAction[];
}

export class Hud {
    readonly root: Node;
    private readonly gold: Label;
    private readonly timer: Label;
    private readonly hpG: Graphics;
    readonly speedBtn: Button;
    private panel: { node: Node; title: Label; model: PanelModel; buttons: Button[] } | null = null;
    private refreshT = 0;
    private readonly notice: Label;
    private noticeT = 0;

    constructor(parent: Node, cb: { onLane: (lane: number) => void; onTech: () => void; onSpeed: () => void }) {
        this.root = createNode('Hud', parent);
        const vs = view.getVisibleSize(), L = -vs.width / 2, T = vs.height / 2, R = vs.width / 2, B = -vs.height / 2;

        const bar = createGraphics('TopBar', this.root);
        bar.node.setPosition(0, T - 30);
        bar.node.getComponent(UITransform)!.setContentSize(780, 46);
        roundRect(bar, 780, 46, PANEL, PANEL_RIM);
        swallow(bar.node);
        this.gold = createLabel('Gold', bar.node, '', 22, GOLD);
        this.gold.node.setPosition(-250, 0);
        this.timer = createLabel('Timer', bar.node, '', 24, TEXT);
        this.timer.node.setPosition(-40, 0);
        this.hpG = createGraphics('BaseHp', bar.node);
        createLabel('Me', bar.node, '我', 20, ME).node.setPosition(30, 0);
        createLabel('Foe', bar.node, '敌', 20, FOE).node.setPosition(365, 0);

        this.speedBtn = new Button(this.root, '1 倍速', 100, 44, cb.onSpeed, 20);
        this.speedBtn.node.setPosition(R - 64, T - 30);
        const tech = new Button(this.root, '主城科技', 120, 44, cb.onTech, 20);
        tech.node.setPosition(L + 74, T - 30);

        // 三路兵营的快捷按钮排在最下面一行，不压住下路
        ['上路', '中路', '下路'].forEach((name, i) => {
            const b = new Button(this.root, `${name}兵营`, 130, 42, () => cb.onLane(i), 20);
            b.node.setPosition((i - 1) * 145 + 60, B + 26);
        });

        this.notice = createLabel('Notice', this.root, '', 28, GOLD);
        this.notice.node.setPosition(0, T - 90);
        this.notice.enableOutline = true;
        this.notice.outlineColor = new Color(40, 24, 10, 255);
        this.notice.outlineWidth = 3;
    }

    /** myHp / foeHp：双方大本营剩余血量比例 */
    setTop(gold: number, income: number, time: number, myHp: number, foeHp: number) {
        this.gold.string = `金币 ${Math.floor(gold)}（+${income}/秒）`;
        const m = Math.floor(time / 60), s = Math.floor(time % 60);
        this.timer.string = `${m}:${s < 10 ? '0' : ''}${s}`;
        const g = this.hpG, w = 140;
        g.clear();
        const bar = (x: number, p: number, c: Color) => {
            g.fillColor = HP_BG;
            g.rect(x, -6, w, 12);
            g.fill();
            g.fillColor = c;
            g.rect(x, -6, w * Math.max(0, p), 12);
            g.fill();
        };
        bar(48, myHp, ME);
        bar(205, foeHp, FOE);
    }

    toast(text: string, dur = 2.2) {
        this.notice.string = text;
        this.noticeT = dur;
    }

    get panelOpen() { return !!this.panel; }

    closePanel() {
        this.panel?.node.destroy();
        this.panel = null;
    }

    /** 底部面板：标题 + 一排按钮；兵营和科技共用 */
    openPanel(model: PanelModel) {
        this.closePanel();
        const vs = view.getVisibleSize(), gap = 10, h = 92;
        const widths = model.actions.map(a => a.w ?? 110);
        const w = widths.reduce((a, b) => a + b + gap, -gap) + 40;
        const n = createNode('Panel', this.root);
        n.setPosition(0, -vs.height / 2 + 140);
        n.getComponent(UITransform)!.setContentSize(w, 170);
        swallow(n);
        roundRect(n.addComponent(Graphics), w, 170, PANEL, PANEL_RIM);
        const title = createLabel('Title', n, '', 22, GOLD);
        title.node.setPosition(-10, 58);
        const close = new Button(n, '×', 40, 40, () => this.closePanel(), 26);
        close.node.setPosition(w / 2 - 26, 58);
        let x = -w / 2 + 20;
        const buttons = model.actions.map((a, i) => {
            const b = new Button(n, '', widths[i], h, () => { a.act(); this.refresh(true); }, 19);
            b.node.setPosition(x + widths[i] / 2, -20);
            x += widths[i] + gap;
            return b;
        });
        this.panel = { node: n, title, model, buttons };
        this.refresh(true);
    }

    showResult(title: string, line: string, good: boolean, onRestart: () => void) {
        this.closePanel();
        const vs = view.getVisibleSize();
        const r = createNode('Result', this.root);
        r.getComponent(UITransform)!.setContentSize(vs.width, vs.height);
        swallow(r);
        const dim = r.addComponent(Graphics);
        dim.fillColor = new Color(0, 0, 0, 150);
        dim.rect(-vs.width / 2, -vs.height / 2, vs.width, vs.height);
        dim.fill();
        const p = createGraphics('Panel', r);
        roundRect(p, 540, 280, PANEL, PANEL_RIM);
        createLabel('Title', p.node, title, 56, good ? GOLD : FOE).node.setPosition(0, 70);
        createLabel('Sub', p.node, line, 22, TEXT).node.setPosition(0, 0);
        const again = new Button(p.node, '再来一局', 180, 56, () => { r.destroy(); onRestart(); }, 26);
        again.node.setPosition(0, -85);
    }

    update(dt: number) {
        if (this.noticeT > 0) { this.noticeT -= dt; if (this.noticeT <= 0) this.notice.string = ''; }
        this.refreshT -= dt;
        if (this.refreshT <= 0) this.refresh(true);
    }

    private refresh(now: boolean) {
        if (!now) return;
        this.refreshT = 0.2;
        const p = this.panel;
        if (!p) return;
        p.title.string = p.model.title();
        p.model.actions.forEach((a, i) => {
            p.buttons[i].text = a.label();
            p.buttons[i].setState(a.enabled(), a.selected?.() ?? false);
        });
    }
}
