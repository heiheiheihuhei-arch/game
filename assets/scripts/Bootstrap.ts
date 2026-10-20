import { _decorator, Color, Component, ResolutionPolicy, view } from 'cc';
import { createLabel } from './core/Nodes';
import { AudioMgr } from './core/AudioMgr';
import { preloadSprites } from './core/Res';
import { animFrames, BUILDINGS, buildingFrames, UNITS } from './lane/Defs';
import { Game } from './lane/Game';

const { ccclass } = _decorator;

// 设计尺寸 1280×720：比 16:9 宽的屏幕固定高度，比 16:9 窄的窗口（比如竖着的浏览器）固定宽度
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;

/** 游戏入口：挂在场景的 Canvas 上，其余节点全部由代码创建 */
@ccclass('Bootstrap')
export class Bootstrap extends Component {
    private game: Game | null = null;

    onLoad() {
        const frame = view.getFrameSize();
        const wide = frame.width / frame.height >= DESIGN_WIDTH / DESIGN_HEIGHT;
        view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, wide ? ResolutionPolicy.FIXED_HEIGHT : ResolutionPolicy.FIXED_WIDTH);
        AudioMgr.init(this.node);
        // 兵是出兵时才创建的：动画帧和残破图全部载好再开局，不然网慢时兵出来是隐身的
        const loading = createLabel('Loading', this.node, '加载中…', 36, new Color(250, 236, 200, 255));
        preloadSprites(['q/map', 'q/rubble_small', 'q/rubble_big', 'q/tower_blue_broken', 'q/tower_red_broken', 'q/castle_blue_broken', 'q/castle_red_broken',
            ...Object.values(UNITS).flatMap(d => [d.anim, d.animFoe].flatMap(a => a ? animFrames(a) : [])),
            ...Object.values(BUILDINGS).flatMap(d => d.img.anim ? buildingFrames(d.img.anim) : [])])
            .then(() => { loading.node.destroy(); this.newGame(); });
    }

    private newGame() {
        this.game?.root.destroy();
        this.game = new Game(this.node, () => this.newGame());
    }

    update(dt: number) {
        // 切后台回来时 dt 会很大，截断避免一帧里走太远
        this.game?.update(Math.min(dt, 0.05));
    }
}
