import { AssetManager, assetManager, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { createNode } from './Nodes';

// 美术资源放在独立的 art 包里：在小游戏平台上它是分包，不占 4MB 首包
const ART_BUNDLE = 'art';
let artBundle: Promise<AssetManager.Bundle | null> | null = null;
const cache = new Map<string, Promise<SpriteFrame | null>>();
// 已经加载好的图片：特效每次播放都要新建图片节点，直接同步取用，避免第一帧是空的
const ready = new Map<string, SpriteFrame>();

function loadArtBundle(): Promise<AssetManager.Bundle | null> {
    if (!artBundle) {
        artBundle = new Promise(resolve => {
            assetManager.loadBundle(ART_BUNDLE, (err, bundle) => {
                if (err) { console.warn(`[Res] 分包加载失败 ${ART_BUNDLE}`, err); resolve(null); return; }
                resolve(bundle);
            });
        });
    }
    return artBundle;
}

/** 已经载好的图片，没载好返回 null：逐帧动画切帧时用，不能等异步 */
export function readySprite(path: string): SpriteFrame | null {
    return ready.get(path) ?? null;
}

/** 预先加载一批图片（比如某个神将的全部特效），之后播放时第一帧就有图 */
export function preloadSprites(paths: string[]): Promise<void> {
    return Promise.all(paths.map(loadSprite)).then(() => undefined);
}

/** 按路径加载 art 包里的图片（不带扩展名），同一张图只加载一次；失败返回 null，不让一张图缺失拖垮整个场景 */
export function loadSprite(path: string): Promise<SpriteFrame | null> {
    let p = cache.get(path);
    if (!p) {
        p = loadArtBundle().then(bundle => new Promise<SpriteFrame | null>(resolve => {
            if (!bundle) { resolve(null); return; }
            bundle.load(`${path}/spriteFrame`, SpriteFrame, (err, sf) => {
                if (err) { console.warn(`[Res] 图片加载失败 ${path}`, err); resolve(null); return; }
                ready.set(path, sf);
                resolve(sf);
            });
        }));
        cache.set(path, p);
    }
    return p;
}

/**
 * 创建一个图片节点，图片异步加载完成后自动显示。
 * 指定 width 或 height 其中一个时，另一个按图片比例算；anchorY 设成 0 可以让物件"站"在坐标点上。
 */
export function createSprite(name: string, parent: Node, path: string, opts: { width?: number; height?: number; anchorY?: number; tiled?: boolean } = {}): Node {
    const n = createNode(name, parent);
    const sprite = n.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    // 平铺：按图片原尺寸重复铺满节点，用于地面
    if (opts.tiled) sprite.type = Sprite.Type.TILED;
    const ui = n.getComponent(UITransform)!;
    ui.setAnchorPoint(0.5, opts.anchorY ?? 0.5);
    if (opts.tiled && opts.width && opts.height) ui.setContentSize(opts.width, opts.height);
    const apply = (sf: SpriteFrame | null) => {
        if (!sf || !n.isValid) return;
        sprite.spriteFrame = sf;
        if (opts.tiled) return;
        const r = sf.originalSize.width / sf.originalSize.height;
        const w = opts.width ?? (opts.height ? opts.height * r : sf.originalSize.width);
        const h = opts.height ?? w / r;
        ui.setContentSize(w, h);
    };
    const cached = ready.get(path);
    if (cached) apply(cached);
    else loadSprite(path).then(apply);
    return n;
}
