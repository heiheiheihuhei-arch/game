import { EventKeyboard, EventTouch, Input, KeyCode, input, view } from 'cc';

export interface TouchListener {
    /** 返回 true 表示这次触摸被消费，后续 move / end 都发给它 */
    onTouchStart(id: number, x: number, y: number): boolean;
    onTouchMove(id: number, x: number, y: number): void;
    onTouchEnd(id: number): void;
}

/** 键盘和触摸的统一入口；触摸坐标转换成以屏幕中心为原点、y 轴向上的 Canvas 局部坐标 */
export class GameInput {
    static readonly keys = new Set<KeyCode>();
    static touchListener: TouchListener | null = null;
    static onKeyPress: ((key: KeyCode) => void) | null = null;

    static init() {
        input.on(Input.EventType.KEY_DOWN, this.keyDown, this);
        input.on(Input.EventType.KEY_UP, this.keyUp, this);
        input.on(Input.EventType.TOUCH_START, this.touchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.touchMove, this);
        input.on(Input.EventType.TOUCH_END, this.touchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.touchEnd, this);
    }

    static dispose() {
        input.off(Input.EventType.KEY_DOWN, this.keyDown, this);
        input.off(Input.EventType.KEY_UP, this.keyUp, this);
        input.off(Input.EventType.TOUCH_START, this.touchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.touchMove, this);
        input.off(Input.EventType.TOUCH_END, this.touchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.touchEnd, this);
        this.keys.clear();
    }

    /** 键盘方向，已归一化 */
    static keyAxis(): [number, number] {
        const k = this.keys;
        let x = 0, y = 0;
        if (k.has(KeyCode.KEY_A) || k.has(KeyCode.ARROW_LEFT)) x -= 1;
        if (k.has(KeyCode.KEY_D) || k.has(KeyCode.ARROW_RIGHT)) x += 1;
        if (k.has(KeyCode.KEY_W) || k.has(KeyCode.ARROW_UP)) y += 1;
        if (k.has(KeyCode.KEY_S) || k.has(KeyCode.ARROW_DOWN)) y -= 1;
        const m = Math.hypot(x, y);
        return m > 0 ? [x / m, y / m] : [0, 0];
    }

    private static keyDown(e: EventKeyboard) {
        // 按住不放时系统会重复发 KEY_DOWN，技能只应该触发一次
        const repeat = this.keys.has(e.keyCode);
        this.keys.add(e.keyCode);
        if (!repeat && this.onKeyPress) this.onKeyPress(e.keyCode);
    }

    private static keyUp(e: EventKeyboard) {
        this.keys.delete(e.keyCode);
    }

    private static local(e: EventTouch): [number, number] {
        const p = e.getUILocation();
        const vs = view.getVisibleSize();
        return [p.x - vs.width / 2, p.y - vs.height / 2];
    }

    private static touchStart(e: EventTouch) {
        const [x, y] = this.local(e);
        this.touchListener?.onTouchStart(e.getID(), x, y);
    }

    private static touchMove(e: EventTouch) {
        const [x, y] = this.local(e);
        this.touchListener?.onTouchMove(e.getID(), x, y);
    }

    private static touchEnd(e: EventTouch) {
        this.touchListener?.onTouchEnd(e.getID());
    }
}
